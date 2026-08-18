using System.ClientModel;
using System.Text.Json;
using McpHost.Guardrails;
using McpHost.LlmModel;
using Microsoft.Extensions.AI;
using ModelContextProtocol.Client;

namespace McpHost.Loop;

// The seam between "who wants a turn run" (ChatWorker today, the MAVERIK runner later) and
// "how the tool loop is driven". Both paths must execute the same loop code — that is what
// makes benchmark results predictive of chat behavior.

// The agents.json contextManagementStrategy value, resolved to a real enum. None is the default
// (does nothing — unchanged from before this feature existed). Compaction is currently
// unimplemented for every provider and falls back to Cutoff's mechanism (see ContextCutoff and
// RunTurnAsync below), reported distinctly so it's visibly a fallback rather than silently
// identical.
public enum ContextManagementStrategy { None, Cutoff, Compaction }

public static class ContextManagementStrategyParser
{
    // Same null-is-valid, unknown-value-throws convention as AnthropicCacheControl.ParseTtl.
    public static ContextManagementStrategy Parse(string? value) => value switch
    {
        null or "" or "none" => ContextManagementStrategy.None,
        "cutoff" => ContextManagementStrategy.Cutoff,
        "compaction" => ContextManagementStrategy.Compaction,
        _ => throw new ArgumentException($"Unknown contextManagementStrategy '{value}'; expected \"cutoff\" or \"compaction\"."),
    };
}

// Everything a loop needs to run one full turn, decoupled from sessions/outboxes.
public sealed record TurnRequest(
    IChatClient Chat,
    List<ChatMessage> History,          // already holds system prompt + user message; the loop appends to it
    IReadOnlyList<McpClientTool> Tools, // the agent's ALLOWED subset — names resolve against this list only; ALWAYS what InvokeToolAsync dispatches against
    int MaxIterations,
    IProgress<string>? Progress,        // chat passes outbox lines; the benchmark runner passes null
    // What actually gets sent to the model, when it needs to differ from Tools — e.g. a
    // capability-override experiment that edits a tool's description or a cache-control
    // breakpoint on the last tool. Null (the default) means "send Tools as-is", so every
    // existing call site is unaffected. Never used for dispatch — see InvokeToolAsync — because
    // an overridden entry is a wire-only wrapper with no InvokeAsync.
    IReadOnlyList<AITool>? PresentationTools = null,
    // Context-size management (see ContextCutoff). EffectiveMaxContextTokens is the resolved
    // ceiling (AgentConfig.SimulatedMaxContextTokens ?? LLMModelConfig.ContextWindowTokens);
    // null means "unknown," under which the strategy silently no-ops regardless of its value.
    // LastKnownContextTokens is the caller's best prior real measurement — e.g. a chat session's
    // usage from its previous turn — used only to decide whether to trim before this call's very
    // first iteration, since no response has come back yet to measure this call's own usage.
    // Null (a fresh session/case) means there's nothing to compare against yet, so iteration 1
    // never trims; later iterations within the same call use their own running usage instead.
    ContextManagementStrategy ContextStrategy = ContextManagementStrategy.None,
    int? EffectiveMaxContextTokens = null,
    long? LastKnownContextTokens = null,
    // Guardrail policies attached to this agent (already resolved via GuardrailRegistry.
    // ResolveForAgent — see AgentConfig.Guardrails) and the classifier IChatClients any of their
    // llm-classifier rules need. Empty list / empty dict (the defaults) mean "no guardrails,"
    // unchanged from before this feature existed.
    IReadOnlyList<GuardrailPolicy> Guardrails = null!,
    IReadOnlyDictionary<string, IChatClient> GuardrailClassifierClients = null!,
    // Resolved once per agent selection/chat job from LLMModelConfig.SupportsTools (default true
    // when unset/unresolvable). When false, Tools/PresentationTools are never attached to the
    // outgoing ChatOptions at all — the model is never even offered tool-calling, rather than
    // offered it and expected to decline.
    bool SupportsTools = true)
{
    public IReadOnlyList<GuardrailPolicy> Guardrails { get; init; } = Guardrails ?? [];
    public IReadOnlyDictionary<string, IChatClient> GuardrailClassifierClients { get; init; } = GuardrailClassifierClients ?? new Dictionary<string, IChatClient>();
}

// What a turn produced, plus the metrics MAVERIK records per case.
public sealed record TurnResult(
    string FinalText,
    int Iterations,
    int ToolCallCount,
    IReadOnlyList<string> ToolNames,
    long? InputTokens,                  // null = no response this turn reported usage (distinct from 0)
    long? OutputTokens,
    bool HitIterationLimit,
    long? PeakContextTokens,            // largest single round-trip's (input+output), not summed — see RunTurnAsync
    long? CacheReadInputTokens = null,      // Anthropic prompt-caching: tokens served from cache (already counted within InputTokens)
    long? CacheCreationInputTokens = null,  // Anthropic prompt-caching: tokens spent writing a new cache entry (NOT counted within InputTokens)
    int ContextTrimCount = 0,               // how many times ContextCutoff actually trimmed history during this turn
    IReadOnlyList<GuardrailFinding>? GuardrailFindings = null, // findings from every guardrail check this turn ran; empty when no guardrails are attached
    // Set when this turn's GetResponseAsync call itself threw a provider/parsing-shaped
    // exception — e.g. a small local model emitted malformed tool-call syntax the client library
    // couldn't parse. DISTINCT from a guardrail block (enforcement working as designed) and
    // distinct from anything that reaches the caller's own outer generic catch (MCP tool infra
    // failures, judge failures, network errors). Null = no such failure this turn.
    string? MalformedResponseError = null)
{
    public IReadOnlyList<GuardrailFinding> GuardrailFindings { get; init; } = GuardrailFindings ?? [];
}

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
    // return one result per call (in the original call order), plus any guardrail findings from
    // tool-gate denials along the way.
    protected abstract Task<(IReadOnlyList<FunctionResultContent> Results, IReadOnlyList<GuardrailFinding> Findings)> ExecuteCallsAsync(
        IReadOnlyList<FunctionCallContent> calls, TurnRequest request, CancellationToken ct);

    public async Task<TurnResult> RunTurnAsync(TurnRequest request, CancellationToken ct)
    {
        // McpClientTool : AIFunction, so the agent's subset goes straight into ChatOptions.
        // PresentationTools (when set) overrides what's actually sent — see TurnRequest. When
        // SupportsTools is false, Tools is omitted entirely rather than sent-and-hoped-ignored —
        // the model is never even offered tool-calling. With no tools offered, `calls` below is
        // always empty and the turn naturally ends after iteration 1 with FinalText populated,
        // going through the same output-stage guardrail check as any other final answer.
        var options = new ChatOptions
        {
            Tools = request.SupportsTools ? [.. (IEnumerable<AITool>?)request.PresentationTools ?? request.Tools] : null
        };

        long? inputTokens = null, outputTokens = null, peakContextTokens = null;
        long? cacheReadTokens = null, cacheCreationTokens = null;
        var toolNames = new List<string>();
        var contextTrimCount = 0;
        var guardrailFindings = new List<GuardrailFinding>();

        // Input-stage guardrail check — once per RunTurnAsync call (not per iteration), against
        // the user message the agent hasn't seen yet. Both callers always append the new
        // ChatRole.User message to request.History before calling RunTurnAsync, so "the last User
        // message in History" is always exactly that message — one hook point that's naturally
        // correct for both single-turn and multiturn cases.
        if (request.Guardrails.Count > 0)
        {
            var lastUserText = request.History.LastOrDefault(m => m.Role == ChatRole.User)?.Text ?? "";
            var (findings, refusal) = await GuardrailEnforcer.CheckInputAsync(
                request.Guardrails, lastUserText, request.GuardrailClassifierClients, ct);
            guardrailFindings.AddRange(findings);
            foreach (var f in findings)
                request.Progress?.Report($"(guardrail: {f.Action} input — policy '{f.PolicyId}' rule '{f.RuleId}')");
            if (refusal is not null)
                return new TurnResult(refusal, 0, 0, [], null, null, HitIterationLimit: false, null,
                    GuardrailFindings: guardrailFindings);
        }

        for (var iteration = 1; iteration <= request.MaxIterations; iteration++)
        {
            // Check before sending, not after: this is the last point where trimming can still
            // change what's about to go over the wire. Iteration 1 has no usage measured yet in
            // THIS call, so it falls back to the caller's last known figure (e.g. a chat
            // session's previous turn) — later iterations use their own running peakContextTokens
            // instead, which is always more current than anything the caller passed in.
            if (request.ContextStrategy != ContextManagementStrategy.None)
            {
                var currentEstimate = iteration == 1 ? request.LastKnownContextTokens : peakContextTokens;
                if (ContextCutoff.TrimIfNeeded(request.History, currentEstimate, request.EffectiveMaxContextTokens))
                {
                    contextTrimCount++;
                    request.Progress?.Report(request.ContextStrategy == ContextManagementStrategy.Compaction
                        ? "(context: compaction not yet implemented for this provider, trimmed oldest messages instead)"
                        : "(context: trimmed oldest messages to stay under the context limit)");
                }
            }

            ChatResponse response;
            try
            {
                response = await request.Chat.GetResponseAsync(request.History, options, ct);
            }
            catch (Exception ex) when (ex is ClientResultException or JsonException)
            {
                // The provider/client library could not parse what came back — e.g. a small
                // local model emitted malformed tool-call syntax. Distinct from a guardrail block
                // (enforcement working as designed) and from anything reaching the caller's own
                // outer generic catch. End the turn immediately rather than continuing with a
                // possibly-inconsistent History; not a retry framework — one failure ends the
                // turn.
                return new TurnResult("", iteration, toolNames.Count, toolNames, inputTokens, outputTokens,
                    HitIterationLimit: false, peakContextTokens, cacheReadTokens, cacheCreationTokens,
                    contextTrimCount, GuardrailFindings: guardrailFindings, MalformedResponseError: ex.Message);
            }

            // Sum usage across every round-trip of the turn. Totals stay null when no response
            // reported usage (some OpenAI-compatible servers omit it) — null means "unknown",
            // never 0.
            Accumulate(response.Usage?.InputTokenCount, ref inputTokens);
            Accumulate(response.Usage?.OutputTokenCount, ref outputTokens);

            // Anthropic prompt-caching (see AnthropicCacheControl) — no-op (both stay null) for
            // agents that don't opt in, since nothing ever sets a cache breakpoint for them.
            // CachedInputTokenCount is already counted within InputTokenCount (don't double-price
            // it); AdditionalCounts is the general provider-specific-count extensibility point.
            Accumulate(response.Usage?.CachedInputTokenCount, ref cacheReadTokens);
            Accumulate(
                response.Usage?.AdditionalCounts?.GetValueOrDefault(AnthropicCacheControl.CacheCreationInputTokensKey),
                ref cacheCreationTokens);

            // Unlike the totals above, this is NOT accumulated — it's the size of the single
            // largest round-trip (this call's own input+output), which is what actually matters
            // for "how close did we get to the model's context limit". Because history only
            // grows across iterations, this is normally the last round-trip, but it's tracked as
            // a running max rather than assumed, in case a provider ever reports otherwise.
            if (response.Usage is not null)
            {
                var thisCallTotal = (response.Usage.InputTokenCount ?? 0) + (response.Usage.OutputTokenCount ?? 0);
                peakContextTokens = peakContextTokens is null ? thisCallTotal : Math.Max(peakContextTokens.Value, thisCallTotal);
            }

            // Persist whatever the model produced this round (text and/or tool-call requests)
            // so the next call sees a coherent history. For the chat path this list IS the
            // session's stored conversation.
            request.History.AddRange(response.Messages);

            var calls = response.Messages
                .SelectMany(m => m.Contents)
                .OfType<FunctionCallContent>()
                .ToList();

            if (calls.Count == 0)
            {
                // Output-stage guardrail check — final-answer text only (v1), matching what
                // CriterionEvaluator.EvaluateAsync already ever sees; avoids a classifier call on
                // every iteration of a tool-heavy turn.
                var finalText = response.Text;
                if (request.Guardrails.Count > 0)
                {
                    var (findings, refusal) = await GuardrailEnforcer.CheckOutputAsync(
                        request.Guardrails, finalText, request.GuardrailClassifierClients, ct);
                    guardrailFindings.AddRange(findings);
                    foreach (var f in findings)
                        request.Progress?.Report($"(guardrail: {f.Action} output — policy '{f.PolicyId}' rule '{f.RuleId}')");
                    if (refusal is not null) finalText = refusal;
                }

                return new TurnResult(finalText, iteration, toolNames.Count, toolNames,
                                      inputTokens, outputTokens, HitIterationLimit: false, peakContextTokens,
                                      cacheReadTokens, cacheCreationTokens, contextTrimCount,
                                      GuardrailFindings: guardrailFindings);
            }

            toolNames.AddRange(calls.Select(c => c.Name));

            var (results, callFindings) = await ExecuteCallsAsync(calls, request, ct);
            guardrailFindings.AddRange(callFindings);

            // Feed results back as a tool-role message, then loop so the model can use them —
            // or call more tools.
            request.History.Add(new ChatMessage(ChatRole.Tool, [.. results]));
        }

        return new TurnResult("", request.MaxIterations, toolNames.Count, toolNames,
                              inputTokens, outputTokens, HitIterationLimit: true, peakContextTokens,
                              cacheReadTokens, cacheCreationTokens, contextTrimCount,
                              GuardrailFindings: guardrailFindings);
    }

    // Dispatch one call to the owning MCP client. Names resolve against the agent's allowed
    // subset (request.Tools) — never the global catalog — so an agent cannot reach tools
    // outside its servers, and a same-name tool on another server cannot shadow its own.
    // Returns the finding a guardrail tool-gate denial produced, if any — a tuple rather than a
    // shared mutable accumulator, so ParallelToolsLoopStrategy's Task.WhenAll never has
    // concurrent writers to worry about.
    protected static async Task<(FunctionResultContent Result, GuardrailFinding? Finding)> InvokeToolAsync(
        FunctionCallContent call, TurnRequest request, CancellationToken ct)
    {
        var tool = request.Tools.FirstOrDefault(t => t.Name == call.Name);
        if (tool is null)
            return (new FunctionResultContent(call.CallId, $"Error: no tool named '{call.Name}'."), null);

        if (GuardrailEnforcer.TryGetDenyingPolicy(request.Guardrails, call.Name, out var policyId))
        {
            request.Progress?.Report($"(guardrail: block tool '{call.Name}' — policy '{policyId}')");
            return (new FunctionResultContent(call.CallId, $"Error: tool '{call.Name}' is blocked by guardrail policy '{policyId}'."),
                    new GuardrailFinding("tool", policyId!, call.Name, "block", call.Name));
        }

        try
        {
            var args = new AIFunctionArguments();
            if (call.Arguments is not null)
                foreach (var kv in call.Arguments) args[kv.Key] = kv.Value;

            var result = await tool.InvokeAsync(args, ct);
            return (new FunctionResultContent(call.CallId, result), null);
        }
        catch (Exception ex)
        {
            // Hand the failure back to the model as the result; it can retry or explain.
            return (new FunctionResultContent(call.CallId, $"Error: {ex.Message}"), null);
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
