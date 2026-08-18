using System.Diagnostics;
using Microsoft.Extensions.AI;
using McpHost.Agents;
using McpHost.Config;
using McpHost.Guardrails;
using McpHost.LlmModel;
using McpHost.Loop;
using McpHost.Mcp;

namespace McpHost.Maverik;

// The MAVERIK benchmark worker: pulls run requests off its queue and executes every case —
// (agent × question × repetition) — SEQUENTIALLY, so timing numbers stay clean. Each case is
// a completely fresh conversation (system prompt + question, no sessions, no shared history)
// driven through the same ILoopStrategy code path as interactive chat.
//
// Deliberately a separate worker from ChatWorker so a long benchmark never blocks chat — but
// note: chatting WHILE a run executes makes the run's timing metrics noisier, since both
// compete for CPU/network. Prefer benchmarking on an idle host.
public sealed class MaverikRunner(
    MaverikRunQueue queue,
    MaverikRunStore store,
    MaverikSuiteRegistry suites,
    AgentRegistry agents,
    LLMModelRegistry models,
    LoopStrategyRegistry loops,
    McpServerRegistry mcp,
    GuardrailRegistry guardrails,
    ToolCostRegistry toolCosts,
    CapabilityOverrideRegistry capabilityOverrides,
    CriterionEvaluator evaluator,
    UserSimulator userSimulator,
    MaverikResultsWriter writer,
    ConfigFileService configFiles,
    ILogger<MaverikRunner> log) : BackgroundService
{
    // MaverikQuestion.MaxUserTurns' default when unset — see that field's doc comment for why
    // this is smaller than AgentConfig.MaxIterations' default of 8.
    internal const int DefaultMaxUserTurns = 4;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var request in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                await ProcessRunAsync(request, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                throw; // host shutdown mid-run; the run stays in its last published state
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Run '{RunId}' failed.", request.RunId);
                if (store.Get(request.RunId) is { } status)
                    store.Set(status with { State = "failed", FinishedAt = DateTimeOffset.UtcNow });
            }
        }
    }

    private async Task ProcessRunAsync(RunRequest request, CancellationToken ct)
    {
        // Route wire logs (MCPHOST_LLM_DEBUG) for the whole run — agent and judge traffic
        // alike — to logs/{runId}.log.
        LlmLogContext.SessionId = request.RunId;

        var suite = suites.Resolve(request.SuiteId);
        var results = new List<QuestionRunResult>();

        var status = store.Get(request.RunId)!
            with { State = "running", StartedAt = DateTimeOffset.UtcNow };
        store.Set(status);

        log.LogInformation("Run '{RunId}' started: suite '{Suite}', {Agents} agent(s), {Questions} question(s), {Reps} repetition(s).",
            request.RunId, suite.Id, request.AgentSelections.Count, suite.Questions.Count, request.Repetitions);

        var bundles = new Dictionary<AgentSelection, CapabilityBundle>();

        foreach (var selection in request.AgentSelections)
        {
            // Resolve everything the agent's cases share once. A bad agent/version/model/loop id
            // fails the whole run loudly (caught in ExecuteAsync) — it would invalidate the
            // comparison anyway. Version == null resolves the live/current config, unchanged from
            // before agent versioning existed; a pinned version goes through the frozen snapshot.
            var agent = AgentVersionResolver.Resolve(selection.AgentId, selection.Version, agents, configFiles);
            var chat = models.Resolve(agent.Model);
            var strategy = loops.Resolve(agent.LoopType);
            var tools = mcp.ToolsForServers(agent.McpServers);

            // Resolved once per agent selection (not per case) — the same per-case cost math
            // MaverikSummaryBuilder's aggregate uses (EstimateCost/EstimateToolCost), so
            // QuestionRunResult.EstCost/EstToolCost need only the inputs that vary per case.
            var pricing = models.ResolveConfig(agent.Model);
            var toolServerByName = MaverikSummaryBuilder.BuildToolServerByName(agent, mcp);

            // Resolved once per agent selection (not per case), same as chat/tools/pricing above.
            var (guardrailPolicies, classifierClients) = guardrails.ResolveForAgent(agent.Guardrails, models);
            var supportsTools = pricing?.SupportsTools ?? true;

            // Capture the effective (post-override) catalog snapshot before running any case —
            // see CapabilityBundle. Published incrementally so it's visible mid-run, same as
            // CompletedCases/Results below. Keyed by the whole selection so two versions of the
            // same agent in one batch get distinct bundles.
            var orderedTools = mcp.ToolsForServersWithOwner(agent.McpServers);
            var overridesForAgent = capabilityOverrides.OverridesFor(agent.Id);
            bundles[selection] = CapabilityBundleBuilder.Build(
                agent.Id, orderedTools.Select(t => (t.Server, (AIFunction)t.Tool)).ToList(), overridesForAgent);
            status = status with { CapabilityBundles = bundles };
            store.Set(status);

            // Only built when this agent actually has an override — the common case (no
            // overrides) sends Tools as-is, unchanged from before this feature existed.
            IReadOnlyList<AITool>? presentationTools = overridesForAgent.Count > 0
                ? CapabilityOverrideApplier.Apply(
                    orderedTools.Select(t => (t.Server, (AIFunction)t.Tool)).ToList(), overridesForAgent)
                : null;

            foreach (var question in suite.Questions)
            {
                for (var repetition = 1; repetition <= request.Repetitions; repetition++)
                {
                    var result = await RunCaseAsync(agent, selection.Version, chat, strategy, tools, presentationTools,
                        guardrailPolicies, classifierClients, supportsTools, pricing, toolServerByName, suite, question, repetition, ct);
                    results.Add(result);

                    // Publish progress after every case so polls see the run advance.
                    status = status with { CompletedCases = results.Count, Results = results.ToArray() };
                    store.Set(status);
                }
            }
        }

        status = status with { State = "completed", FinishedAt = DateTimeOffset.UtcNow };
        store.Set(status);

        var summary = MaverikSummaryBuilder.Build(status, suites, agents, models, mcp, toolCosts, configFiles);
        await writer.WriteAsync(status, summary, ct);
        await writer.WriteSuiteRunRecordsAsync(status, summary, agents, ct);

        log.LogInformation("Run '{RunId}' completed: {Passed}/{Evaluated} passed, {Errors} error(s).",
            request.RunId,
            results.Count(r => r.Error is null && r.Passed),
            results.Count(r => r.Error is null),
            results.Count(r => r.Error is not null));
    }

    private async Task<QuestionRunResult> RunCaseAsync(
        AgentConfig agent, int? version, IChatClient chat, ILoopStrategy strategy,
        IReadOnlyList<ModelContextProtocol.Client.McpClientTool> tools,
        IReadOnlyList<AITool>? presentationTools,
        IReadOnlyList<GuardrailPolicy> guardrailPolicies, IReadOnlyDictionary<string, IChatClient> classifierClients, bool supportsTools,
        LLMModelConfig? pricing, IReadOnlyDictionary<string, string> toolServerByName,
        MaverikSuite suite, MaverikQuestion question, int repetition, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            // Isolation is the point: every case starts from a clean two-message history.
            // Cache control (see AnthropicCacheControl) is opt-in per agent — an agent that
            // doesn't set PromptCaching gets the plain system message, unchanged.
            List<ChatMessage> history =
            [
                agent.PromptCaching
                    ? AnthropicCacheControl.BuildSystemMessage(agent.SystemPrompt!, AnthropicCacheControl.ParseTtl(agent.PromptCachingTtl))
                    : new(ChatRole.System, agent.SystemPrompt!),
                new(ChatRole.User, question.Text),
            ];

            // Context-size management (see ContextCutoff). effectiveMaxContextTokens is resolved
            // once per case; lastKnownContextTokens carries forward BETWEEN loop iterations below
            // (new — before Multiturn existed, a case only ever called RunTurnAsync once, so
            // there was nothing to carry). A non-multiturn case still runs the loop body exactly
            // once and never gains a second ChatRole.User message, so its behavior (including
            // ContextCutoff's "never drop the only/live exchange unit" floor) is unchanged.
            var contextStrategy = ContextManagementStrategyParser.Parse(agent.ContextManagementStrategy);
            var effectiveMaxContextTokens = agent.SimulatedMaxContextTokens ?? pricing?.ContextWindowTokens;
            long? lastKnownContextTokens = null;

            var transcript = question.Multiturn ? new List<TranscriptMessage> { new("user", question.Text) } : null;
            var maxUserTurns = question.MaxUserTurns ?? DefaultMaxUserTurns;
            var scriptedQueue = question.Multiturn && string.Equals(question.UserTurnMode, "scripted", StringComparison.OrdinalIgnoreCase)
                ? new Queue<string>(question.ScriptedUserTurns!)
                : null;
            var simulatorModel = question.UserSimulatorModel ?? suite.UserSimulatorModel;

            // Accumulated across every RunTurnAsync call this case makes — for a non-multiturn
            // case that's exactly one call, so these totals are identical to reading straight off
            // `turn` as before. PeakContextTokens/ContextWindowExceeded/ContextTrimEvents must
            // aggregate across ALL calls (not just the last), since any one of them could be the
            // call that actually crossed the ceiling or triggered a trim.
            long? totalInputTokens = null, totalOutputTokens = null, totalCacheRead = null, totalCacheCreation = null;
            long? maxPeakContextTokens = null;
            var totalIterations = 0;
            var totalToolCalls = 0;
            var toolNames = new List<string>();
            var contextTrimEvents = 0;
            var contextWindowExceeded = false;
            var guardrailFindings = new List<GuardrailFinding>();
            var userTurnsUsed = 0;
            long simInputTokens = 0, simOutputTokens = 0;
            var sawSimulatorUsage = false;

            TurnResult turn;
            while (true)
            {
                turn = await strategy.RunTurnAsync(
                    new TurnRequest(chat, history, tools, agent.MaxIterations, Progress: null, presentationTools,
                        ContextStrategy: contextStrategy, EffectiveMaxContextTokens: effectiveMaxContextTokens,
                        LastKnownContextTokens: lastKnownContextTokens,
                        Guardrails: guardrailPolicies, GuardrailClassifierClients: classifierClients,
                        SupportsTools: supportsTools), ct);
                transcript?.Add(new("assistant", turn.FinalText));
                lastKnownContextTokens = turn.PeakContextTokens;
                guardrailFindings.AddRange(turn.GuardrailFindings);

                totalInputTokens = Accumulate(totalInputTokens, turn.InputTokens);
                totalOutputTokens = Accumulate(totalOutputTokens, turn.OutputTokens);
                totalCacheRead = Accumulate(totalCacheRead, turn.CacheReadInputTokens);
                totalCacheCreation = Accumulate(totalCacheCreation, turn.CacheCreationInputTokens);
                if (turn.PeakContextTokens is { } thisPeak)
                    maxPeakContextTokens = maxPeakContextTokens is null ? thisPeak : Math.Max(maxPeakContextTokens.Value, thisPeak);
                totalIterations += turn.Iterations;
                totalToolCalls += turn.ToolCallCount;
                toolNames.AddRange(turn.ToolNames);
                contextTrimEvents += turn.ContextTrimCount;
                // Independent of contextStrategy — true whenever any call's real peak exceeded
                // the configured ceiling, even if no management strategy was enabled to do
                // anything about it. This is the signal that was missing: contextWindowTokens/
                // simulatedMaxContextTokens alone never made a case fail or even show up as
                // different in any way before this field existed.
                if (turn.PeakContextTokens is { } peak && effectiveMaxContextTokens is { } max && peak > max)
                    contextWindowExceeded = true;

                if (!question.Multiturn || turn.HitIterationLimit || turn.MalformedResponseError is not null || userTurnsUsed >= maxUserTurns)
                    break;

                string? nextMessage;
                if (scriptedQueue is not null)
                {
                    if (scriptedQueue.Count == 0) break;
                    nextMessage = scriptedQueue.Dequeue();
                }
                else
                {
                    var sim = await userSimulator.GetNextTurnAsync(question, simulatorModel!, history, ct);
                    sawSimulatorUsage = true;
                    simInputTokens += sim.InputTokens ?? 0;
                    simOutputTokens += sim.OutputTokens ?? 0;
                    if (!sim.Continue) break;
                    nextMessage = sim.Message;
                }

                userTurnsUsed++;
                history.Add(new ChatMessage(ChatRole.User, nextMessage!));
                transcript?.Add(new("user", nextMessage!));
            }
            sw.Stop();

            // A turn that hit the iteration cap has no final answer — that's a fail on its
            // own; don't spend judge tokens on an empty string. Always evaluates the LAST turn's
            // FinalText, multi-turn or not — the criterion never needs to know how many
            // exchanges it took to get there.
            var evaluation =
                turn.MalformedResponseError is not null
                    ? new EvaluationResult(false, $"tool-calling/response failure: {turn.MalformedResponseError}", null, null)
                : turn.HitIterationLimit
                    ? new EvaluationResult(false, "no final answer: hit the tool-iteration limit", null, null)
                    : await evaluator.EvaluateAsync(question, turn.FinalText, suite.JudgeModel, ct);

            return new QuestionRunResult
            {
                AgentId = agent.Id,
                Version = version,
                QuestionId = question.Id,
                Repetition = repetition,
                DurationMs = sw.ElapsedMilliseconds,
                InputTokens = totalInputTokens,
                OutputTokens = totalOutputTokens,
                PeakContextTokens = maxPeakContextTokens,
                CacheReadInputTokens = totalCacheRead,
                CacheCreationInputTokens = totalCacheCreation,
                ContextTrimEvents = contextTrimEvents,
                ContextWindowExceeded = contextWindowExceeded,
                GuardrailFindings = guardrailFindings,
                GuardrailBlocked = guardrailFindings.Any(f => f.Action == "block"),
                ToolCallingFailure = turn.MalformedResponseError,
                ToolsSentToModel = supportsTools,
                Iterations = totalIterations,
                ToolCallCount = totalToolCalls,
                ToolNames = toolNames,
                HitIterationLimit = turn.HitIterationLimit,
                FinalAnswer = turn.FinalText,
                Passed = evaluation.Passed,
                EvaluationDetail = evaluation.Detail,
                JudgeInputTokens = evaluation.JudgeInputTokens,
                JudgeOutputTokens = evaluation.JudgeOutputTokens,
                UserTurnsUsed = userTurnsUsed,
                SimulatorInputTokens = sawSimulatorUsage ? simInputTokens : null,
                SimulatorOutputTokens = sawSimulatorUsage ? simOutputTokens : null,
                Transcript = transcript ?? [],
                EstCost = MaverikSummaryBuilder.EstimateCost(
                    totalInputTokens, totalOutputTokens, totalCacheRead, totalCacheCreation, pricing),
                EstToolCost = MaverikSummaryBuilder.EstimateToolCost(toolNames, toolServerByName, toolCosts),
            };
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw; // shutdown, not a case failure
        }
        catch (Exception ex)
        {
            sw.Stop();
            log.LogError(ex, "Case failed: run agent '{Agent}', question '{Question}', repetition {Rep}.",
                agent.Id, question.Id, repetition);

            // One bad case must not kill the run — record the error and continue.
            return new QuestionRunResult
            {
                AgentId = agent.Id,
                Version = version,
                QuestionId = question.Id,
                Repetition = repetition,
                DurationMs = sw.ElapsedMilliseconds,
                Error = ex.Message,
            };
        }
    }

    // Sums two "null means unknown, never 0" totals — same convention LoopStrategyBase.Accumulate
    // uses within a single RunTurnAsync call, applied here across the (possibly several)
    // RunTurnAsync calls one Multiturn case makes.
    private static long? Accumulate(long? total, long? amount) =>
        amount is null ? total : (total ?? 0) + amount.Value;
}
