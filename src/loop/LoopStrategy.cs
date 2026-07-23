using System.Text.Json;
using Microsoft.Extensions.AI;
using ModelContextProtocol.Client;

namespace McpHost.Loop;

// The seam between "who wants a turn run" (ChatWorker today, the MAVERIK runner later) and
// "how the tool loop is driven". Both paths must execute the same loop code — that is what
// makes benchmark results predictive of chat behavior.

// Everything a loop needs to run one full turn, decoupled from sessions/outboxes.
public sealed record TurnRequest(
    IChatClient Chat,
    List<ChatMessage> History,          // already holds system prompt + user message; the loop appends to it
    IReadOnlyList<McpClientTool> Tools, // the agent's ALLOWED subset — names resolve against this list only
    int MaxIterations,
    IProgress<string>? Progress);       // chat passes outbox lines; the benchmark runner passes null

// What a turn produced, plus the metrics MAVERIK records per case.
public sealed record TurnResult(
    string FinalText,
    int Iterations,
    int ToolCallCount,
    IReadOnlyList<string> ToolNames,
    long? InputTokens,                  // null = no response this turn reported usage (distinct from 0)
    long? OutputTokens,
    bool HitIterationLimit);

public interface ILoopStrategy
{
    // The agents.json loopType value that selects this strategy: "manual", "parallel-tools", ...
    string Name { get; }

    Task<TurnResult> RunTurnAsync(TurnRequest request, CancellationToken ct);
}

// IProgress<T> that runs the callback synchronously on the reporting thread. The BCL's
// Progress<T> posts callbacks to the captured SynchronizationContext — none exists in a
// BackgroundService, so they land on the thread pool and progress lines could reorder.
public sealed class SyncProgress<T>(Action<T> onReport) : IProgress<T>
{
    public void Report(T value) => onReport(value);
}

// Shared skeleton of the host loop: send the history to the model, persist its messages,
// detect tool calls by inspecting content (provider-agnostic — more robust than trusting
// FinishReason), execute them (HOW is the strategy-specific part), feed results back as a
// tool-role message, and repeat until a final answer or the iteration cap.
//
// The chat client is registered WITHOUT .UseFunctionInvocation(), so raw FunctionCallContent
// lands here and this class drives the loop itself — keep it that way.
public abstract class LoopStrategyBase : ILoopStrategy
{
    public abstract string Name { get; }

    // The strategy-specific step: execute the calls the model requested this iteration and
    // return one result per call, in the original call order.
    protected abstract Task<IReadOnlyList<FunctionResultContent>> ExecuteCallsAsync(
        IReadOnlyList<FunctionCallContent> calls, TurnRequest request, CancellationToken ct);

    public async Task<TurnResult> RunTurnAsync(TurnRequest request, CancellationToken ct)
    {
        // McpClientTool : AIFunction, so the agent's subset goes straight into ChatOptions.
        var options = new ChatOptions { Tools = [.. request.Tools] };

        long? inputTokens = null, outputTokens = null;
        var toolNames = new List<string>();

        for (var iteration = 1; iteration <= request.MaxIterations; iteration++)
        {
            var response = await request.Chat.GetResponseAsync(request.History, options, ct);

            // Sum usage across every round-trip of the turn. Totals stay null when no response
            // reported usage (some OpenAI-compatible servers omit it) — null means "unknown",
            // never 0.
            Accumulate(response.Usage?.InputTokenCount, ref inputTokens);
            Accumulate(response.Usage?.OutputTokenCount, ref outputTokens);

            // Persist whatever the model produced this round (text and/or tool-call requests)
            // so the next call sees a coherent history. For the chat path this list IS the
            // session's stored conversation.
            request.History.AddRange(response.Messages);

            var calls = response.Messages
                .SelectMany(m => m.Contents)
                .OfType<FunctionCallContent>()
                .ToList();

            if (calls.Count == 0)
                return new TurnResult(response.Text, iteration, toolNames.Count, toolNames,
                                      inputTokens, outputTokens, HitIterationLimit: false);

            toolNames.AddRange(calls.Select(c => c.Name));

            var results = await ExecuteCallsAsync(calls, request, ct);

            // Feed results back as a tool-role message, then loop so the model can use them —
            // or call more tools.
            request.History.Add(new ChatMessage(ChatRole.Tool, [.. results]));
        }

        return new TurnResult("", request.MaxIterations, toolNames.Count, toolNames,
                              inputTokens, outputTokens, HitIterationLimit: true);
    }

    // Dispatch one call to the owning MCP client. Names resolve against the agent's allowed
    // subset (request.Tools) — never the global catalog — so an agent cannot reach tools
    // outside its servers, and a same-name tool on another server cannot shadow its own.
    protected static async Task<FunctionResultContent> InvokeToolAsync(
        FunctionCallContent call, TurnRequest request, CancellationToken ct)
    {
        var tool = request.Tools.FirstOrDefault(t => t.Name == call.Name);
        if (tool is null)
            return new FunctionResultContent(call.CallId, $"Error: no tool named '{call.Name}'.");

        try
        {
            var args = new AIFunctionArguments();
            if (call.Arguments is not null)
                foreach (var kv in call.Arguments) args[kv.Key] = kv.Value;

            var result = await tool.InvokeAsync(args, ct);
            return new FunctionResultContent(call.CallId, result);
        }
        catch (Exception ex)
        {
            // Hand the failure back to the model as the result; it can retry or explain.
            return new FunctionResultContent(call.CallId, $"Error: {ex.Message}");
        }
    }

    // The "(calling <tool> ...)" progress line, shared so every strategy announces calls the
    // same way.
    protected static void ReportCall(FunctionCallContent call, TurnRequest request)
    {
        if (request.Progress is null)
            return;

        var arguments = call.Arguments is null
            ? "no arguments"
            : JsonSerializer.Serialize(call.Arguments);
        request.Progress.Report($"(calling {call.Name} with arguments {arguments})");
    }

    private static void Accumulate(long? amount, ref long? total)
    {
        if (amount is not null) total = (total ?? 0) + amount.Value;
    }
}
