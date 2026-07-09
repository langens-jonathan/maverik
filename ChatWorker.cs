using Microsoft.Extensions.AI;

namespace McpHost;

// The host-loop driver for interactive chat. Pulls jobs off the queue, assembles everything
// the turn needs from the agent (model, prompt, allowed tools, loop strategy), runs the turn
// through the shared loop strategy, and writes progress lines + the final answer to the
// session's outbox, where the client picks them up by polling.
//
// The tool loop itself lives in the ILoopStrategy implementations (see LoopStrategy.cs) so
// the MAVERIK benchmark runner executes the exact same code path. The chat client is still
// registered WITHOUT .UseFunctionInvocation() — the strategies drive the loop by hand.
public sealed class ChatWorker(
    ChatJobQueue queue,
    ConversationStore conversations,
    ChatOutbox outbox,
    McpServerRegistry mcp,
    LLMModelRegistry models,
    AgentRegistry agents,
    LoopStrategyRegistry loops,
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

        // Everything the turn needs comes from the agent: model, prompt, allowed tools, loop
        // strategy, iteration cap. Resolve throws on an unknown id — caught by ExecuteAsync's
        // try/catch.
        var agent = agents.Resolve(job.AgentId);
        var chat = models.Resolve(agent.Model);
        var strategy = loops.Resolve(agent.LoopType);

        var history = conversations.GetOrCreate(job.SessionId, agent.SystemPrompt!);
        history.Add(new ChatMessage(ChatRole.User, job.Message));

        var result = await strategy.RunTurnAsync(new TurnRequest(
            chat,
            history,
            mcp.ToolsForServers(agent.McpServers),
            agent.MaxIterations,
            // SyncProgress keeps progress lines in emit order (see LoopStrategy.cs).
            new SyncProgress<string>(line => outbox.Add(job.SessionId, line))), ct);

        outbox.Add(job.SessionId, result.HitIterationLimit
            ? "(stopped: hit the tool-iteration limit.)"
            : result.FinalText);
    }
}
