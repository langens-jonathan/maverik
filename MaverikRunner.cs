using System.Diagnostics;
using Microsoft.Extensions.AI;

namespace McpHost;

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
    CriterionEvaluator evaluator,
    MaverikResultsWriter writer,
    ILogger<MaverikRunner> log) : BackgroundService
{
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
            request.RunId, suite.Id, request.AgentIds.Count, suite.Questions.Count, request.Repetitions);

        foreach (var agentId in request.AgentIds)
        {
            // Resolve everything the agent's cases share once. A bad agent/model/loop id
            // fails the whole run loudly (caught in ExecuteAsync) — it would invalidate the
            // comparison anyway.
            var agent = agents.Resolve(agentId);
            var chat = models.Resolve(agent.Model);
            var strategy = loops.Resolve(agent.LoopType);
            var tools = mcp.ToolsForServers(agent.McpServers);

            foreach (var question in suite.Questions)
            {
                for (var repetition = 1; repetition <= request.Repetitions; repetition++)
                {
                    var result = await RunCaseAsync(agent, chat, strategy, tools, suite, question, repetition, ct);
                    results.Add(result);

                    // Publish progress after every case so polls see the run advance.
                    status = status with { CompletedCases = results.Count, Results = results.ToArray() };
                    store.Set(status);
                }
            }
        }

        status = status with { State = "completed", FinishedAt = DateTimeOffset.UtcNow };
        store.Set(status);

        await writer.WriteAsync(status, ct);

        log.LogInformation("Run '{RunId}' completed: {Passed}/{Evaluated} passed, {Errors} error(s).",
            request.RunId,
            results.Count(r => r.Error is null && r.Passed),
            results.Count(r => r.Error is null),
            results.Count(r => r.Error is not null));
    }

    private async Task<QuestionRunResult> RunCaseAsync(
        AgentConfig agent, IChatClient chat, ILoopStrategy strategy,
        IReadOnlyList<ModelContextProtocol.Client.McpClientTool> tools,
        MaverikSuite suite, MaverikQuestion question, int repetition, CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        try
        {
            // Isolation is the point: every case starts from a clean two-message history.
            List<ChatMessage> history =
            [
                new(ChatRole.System, agent.SystemPrompt!),
                new(ChatRole.User, question.Text),
            ];

            var turn = await strategy.RunTurnAsync(
                new TurnRequest(chat, history, tools, agent.MaxIterations, Progress: null), ct);
            sw.Stop();

            // A turn that hit the iteration cap has no final answer — that's a fail on its
            // own; don't spend judge tokens on an empty string.
            var evaluation = turn.HitIterationLimit
                ? new EvaluationResult(false, "no final answer: hit the tool-iteration limit", null, null)
                : await evaluator.EvaluateAsync(question, turn.FinalText, suite.JudgeModel, ct);

            return new QuestionRunResult
            {
                AgentId = agent.Id,
                QuestionId = question.Id,
                Repetition = repetition,
                DurationMs = sw.ElapsedMilliseconds,
                InputTokens = turn.InputTokens,
                OutputTokens = turn.OutputTokens,
                Iterations = turn.Iterations,
                ToolCallCount = turn.ToolCallCount,
                ToolNames = turn.ToolNames,
                HitIterationLimit = turn.HitIterationLimit,
                FinalAnswer = turn.FinalText,
                Passed = evaluation.Passed,
                EvaluationDetail = evaluation.Detail,
                JudgeInputTokens = evaluation.JudgeInputTokens,
                JudgeOutputTokens = evaluation.JudgeOutputTokens,
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
                QuestionId = question.Id,
                Repetition = repetition,
                DurationMs = sw.ElapsedMilliseconds,
                Error = ex.Message,
            };
        }
    }
}
