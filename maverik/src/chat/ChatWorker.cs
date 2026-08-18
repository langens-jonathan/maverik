using Microsoft.Extensions.AI;
using McpHost.Agents;
using McpHost.Guardrails;
using McpHost.LlmModel;
using McpHost.Loop;
using McpHost.Mcp;

namespace McpHost.Chat;

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
    GuardrailRegistry guardrails,
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

        // Cache control (see AnthropicCacheControl) is opt-in per agent, same as MaverikRunner.
        var history = agent.PromptCaching
            ? conversations.GetOrCreate(job.SessionId,
                AnthropicCacheControl.BuildSystemMessage(agent.SystemPrompt!, AnthropicCacheControl.ParseTtl(agent.PromptCachingTtl)))
            : conversations.GetOrCreate(job.SessionId, agent.SystemPrompt!);
        history.Add(new ChatMessage(ChatRole.User, job.Message));

        // Context-size management (see ContextCutoff). ResolveConfig, unlike Resolve, returns
        // null for an unknown/misconfigured model rather than throwing — a chat turn shouldn't
        // fail just because pricing/context-window metadata is missing.
        var modelConfig = models.ResolveConfig(agent.Model);
        var contextStrategy = ContextManagementStrategyParser.Parse(agent.ContextManagementStrategy);
        var effectiveMaxContextTokens = agent.SimulatedMaxContextTokens ?? modelConfig?.ContextWindowTokens;
        var (guardrailPolicies, classifierClients) = guardrails.ResolveForAgent(agent.Guardrails, models);

        var result = await strategy.RunTurnAsync(new TurnRequest(
            chat,
            history,
            mcp.ToolsForServers(agent.McpServers),
            agent.MaxIterations,
            // SyncProgress keeps progress lines in emit order (see LoopStrategy.cs).
            new SyncProgress<string>(line => outbox.Add(job.SessionId, line)),
            ContextStrategy: contextStrategy,
            EffectiveMaxContextTokens: effectiveMaxContextTokens,
            LastKnownContextTokens: conversations.GetLastKnownContextTokens(job.SessionId),
            Guardrails: guardrailPolicies,
            GuardrailClassifierClients: classifierClients,
            SupportsTools: modelConfig?.SupportsTools ?? true), ct);

        // Carry this turn's real usage forward so the next turn's very first call (before it has
        // any usage of its own) has something to check against — see ConversationStore.
        conversations.SetLastKnownContextTokens(job.SessionId, result.PeakContextTokens);

        // Same signal MaverikRunner now surfaces on QuestionRunResult: warn whenever the real
        // peak exceeded the ceiling, independent of contextStrategy — a chat turn under
        // "none" got zero indication of this before. Skipped when a trim already fired this
        // turn (ContextTrimCount > 0), since that already reported its own note and this turn's
        // peak was measured AFTER trimming, so it's no longer meaningfully "exceeded."
        if (result.ContextTrimCount == 0 && result.PeakContextTokens is { } peak
            && effectiveMaxContextTokens is { } max && peak > max)
        {
            outbox.Add(job.SessionId, "(warning: context window exceeded)");
        }

        outbox.Add(job.SessionId, result.MalformedResponseError is not null
            ? $"(error) the model's response could not be parsed — {result.MalformedResponseError}"
            : result.HitIterationLimit
                ? "(stopped: hit the tool-iteration limit.)"
                : result.FinalText);
    }
}
