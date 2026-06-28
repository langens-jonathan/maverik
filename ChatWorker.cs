using Microsoft.Extensions.AI;

namespace McpHost;

// The host loop. Pulls jobs off the queue, drives the LLM, and — this is the step-4
// change — when the model asks to call tools, dispatches them to the owning MCP client,
// feeds the results back, and repeats until the model produces a final answer.
// Pushes progress + the answer over the WebSocket.
//
// Note: the chat client is registered WITHOUT .UseFunctionInvocation(), so the model
// hands us raw FunctionCallContent and we drive the loop ourselves (the whole point of
// the exercise). Put that middleware back and this loop collapses to a single call.
public sealed class ChatWorker(
    ChatJobQueue queue,
    ConversationStore conversations,
    ChatConnectionRegistry registry,
    McpServerRegistry mcp,
    IChatClient chat,
    ILogger<ChatWorker> log) : BackgroundService
{
    private const int MaxIterations = 8;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var job in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                await ProcessAsync(job, stoppingToken);
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Failed to process job for session {SessionId}", job.SessionId);
                await registry.SendAsync(job.SessionId, "(error) something went wrong handling that.");
            }
        }
    }

    private async Task ProcessAsync(ChatJob job, CancellationToken ct)
    {
        var history = conversations.GetOrCreate(job.SessionId);
        history.Add(new ChatMessage(ChatRole.User, job.Message));

        // Hand the whole aggregated catalog to the model. McpClientTool : AIFunction,
        // so these go straight in with no conversion.
        var options = new ChatOptions { Tools = [.. mcp.Tools] };

        for (var iteration = 0; iteration < MaxIterations; iteration++)
        {
            var response = await chat.GetResponseAsync(history, options, ct);

            // Persist whatever the model produced this round (text and/or tool-call
            // requests) so the next call sees a coherent history.
            history.AddRange(response.Messages);

            // Did it ask to call any tools? Inspecting content is provider-agnostic;
            // more robust than trusting FinishReason.
            var calls = response.Messages
                .SelectMany(m => m.Contents)
                .OfType<FunctionCallContent>()
                .ToList();

            if (calls.Count == 0)
            {
                await registry.SendAsync(job.SessionId, response.Text);   // final answer
                return;
            }

            // Execute each requested call (a turn may request several), collect results.
            var results = new List<AIContent>();
            foreach (var call in calls)
            {
                await registry.SendAsync(job.SessionId, $"(calling {call.Name}...)");
                results.Add(await InvokeToolAsync(call, ct));
            }

            // Feed results back as a tool-role message, then loop so the model can use
            // them — or call more tools.
            history.Add(new ChatMessage(ChatRole.Tool, results));
        }

        await registry.SendAsync(job.SessionId, "(stopped: hit the tool-iteration limit.)");
    }

    private async Task<FunctionResultContent> InvokeToolAsync(FunctionCallContent call, CancellationToken ct)
    {
        // Routing: find which aggregated tool owns this name. Each McpClientTool is bound
        // to its owning MCP client, so invoking it issues CallToolAsync to the *right*
        // server under the hood. (One server = no name clashes yet; step 5 adds
        // namespacing for when two servers can share a tool name.)
        var tool = mcp.Tools.FirstOrDefault(t => t.Name == call.Name);
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
}
