using System.Text.Json;
using Microsoft.Extensions.AI;

namespace McpHost;

// The host loop. Pulls jobs off the queue, drives the LLM, and when the model asks to call
// tools, dispatches them to the owning MCP client, feeds the results back, and repeats until
// the model produces a final answer. Progress lines and the final answer are written to the
// session's outbox, where the client picks them up by polling.
//
// The chat client is registered WITHOUT .UseFunctionInvocation(), so the model hands us raw
// FunctionCallContent and we drive the tool loop ourselves. Adding that middleware back would
// collapse this loop to a single call.
public sealed class ChatWorker(
    ChatJobQueue queue,
    ConversationStore conversations,
    ChatOutbox outbox,
    McpServerRegistry mcp,
    LLMModelRegistry models,
    AgentRegistry agents,
    ILogger<ChatWorker> log) : BackgroundService
{
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
                outbox.Add(job.SessionId, "(error) something went wrong handling that.");
            }
        }
    }

    private async Task ProcessAsync(ChatJob job, CancellationToken ct)
    {
        // Tag every raw HTTP call this turn makes to the LLM with the owning session, so the
        // wire-logging handler can route it to logs/{sessionId}.log.
        LlmLogContext.SessionId = job.SessionId;

        // Everything the turn needs comes from the agent: model, prompt, allowed tools, loop cap.
        // Resolve throws on an unknown agent/model id — caught by ExecuteAsync's try/catch.
        var agent = agents.Resolve(job.AgentId);
        var chat = models.Resolve(agent.Model);

        var history = conversations.GetOrCreate(job.SessionId, agent.SystemPrompt!);
        history.Add(new ChatMessage(ChatRole.User, job.Message));

        // Hand the model only the tools from the servers this agent may use (filtered from the
        // already-connected catalog). McpClientTool : AIFunction, so these go straight in.
        var options = new ChatOptions { Tools = [.. mcp.ToolsForServers(agent.McpServers)] };

        for (var iteration = 0; iteration < agent.MaxIterations; iteration++)
        {
            var response = await chat.GetResponseAsync(history, options, ct);

            // Persist whatever the model produced this round (text and/or tool-call requests)
            // so the next call sees a coherent history.
            history.AddRange(response.Messages);

            // Did it ask to call any tools? Inspecting content is provider-agnostic — more
            // robust than trusting FinishReason.
            var calls = response.Messages
                .SelectMany(m => m.Contents)
                .OfType<FunctionCallContent>()
                .ToList();

            if (calls.Count == 0)
            {
                outbox.Add(job.SessionId, response.Text);   // final answer
                return;
            }

            // Execute each requested call (a turn may request several), collect results.
            var results = new List<AIContent>();
            foreach (var call in calls)
            {
                var arguments = call.Arguments is null
                    ? "no arguments"
                    : JsonSerializer.Serialize(call.Arguments);
                outbox.Add(job.SessionId, $"(calling {call.Name} with arguments {arguments})");
                results.Add(await InvokeToolAsync(call, ct));
            }

            // Feed results back as a tool-role message, then loop so the model can use them —
            // or call more tools.
            history.Add(new ChatMessage(ChatRole.Tool, results));
        }

        outbox.Add(job.SessionId, "(stopped: hit the tool-iteration limit.)");
    }

    private async Task<FunctionResultContent> InvokeToolAsync(FunctionCallContent call, CancellationToken ct)
    {
        // Find which aggregated tool owns this name. Each McpClientTool is bound to its owning
        // MCP client, so invoking it issues CallToolAsync to the right server.
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
