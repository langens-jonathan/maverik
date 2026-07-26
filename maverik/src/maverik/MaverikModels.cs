using McpHost.Agents;

namespace McpHost.Maverik;

// One unit of work for the MAVERIK runner: execute a suite against a set of agents, N
// repetitions per (agent, question) pair. The 1↔2-style seam between the POST endpoint and
// the runner, mirroring ChatJob.
public sealed record RunRequest(
    string RunId,
    string SuiteId,
    IReadOnlyList<string> AgentIds,
    int Repetitions,
    IReadOnlyList<string> JudgedMetrics);

// The metrics for one case: (agent, question, repetition). Everything MAVERIK measures lives
// here — this is the row in summary.csv.
public sealed record QuestionRunResult
{
    public required string AgentId { get; init; }
    public required string QuestionId { get; init; }
    public required int Repetition { get; init; }

    // Wall clock for the whole turn: LLM round-trips AND MCP tool time.
    public long DurationMs { get; init; }

    // Summed across every LLM call of the turn; null = provider reported no usage (≠ 0).
    public long? InputTokens { get; init; }
    public long? OutputTokens { get; init; }

    public int Iterations { get; init; }
    public int ToolCallCount { get; init; }
    public IReadOnlyList<string> ToolNames { get; init; } = [];
    public bool HitIterationLimit { get; init; }

    // Largest single LLM round-trip's (input+output) tokens within this case — not summed across
    // iterations like InputTokens/OutputTokens above. Signals how close the case came to the
    // model's real context limit. Null under the same "no usage reported" convention.
    public long? PeakContextTokens { get; init; }

    public string FinalAnswer { get; init; } = "";

    public bool Passed { get; init; }
    public string? EvaluationDetail { get; init; }

    // Judge cost — tracked separately, never added to the agent's token numbers.
    public long? JudgeInputTokens { get; init; }
    public long? JudgeOutputTokens { get; init; }

    // Set when the case blew up (LLM error, evaluator error, ...). An errored case is not
    // counted as evaluated; the run continues past it.
    public string? Error { get; init; }
}

// The full state of one run. Immutable: the runner publishes updated snapshots into the
// store with `with { ... }`, so readers (the poll endpoints) always see a consistent state
// without locking — same single-writer spirit as the rest of the host.
public sealed record RunStatus(
    string RunId,
    string SuiteId,
    IReadOnlyList<string> AgentIds,
    int Repetitions,
    string State,                       // queued | running | completed | failed
    int TotalCases,
    int CompletedCases,
    DateTimeOffset CreatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? FinishedAt,
    IReadOnlyList<QuestionRunResult> Results,
    IReadOnlyList<string> JudgedMetrics);

// The canonical set of metrics a run can be judged on — validated against by POST
// /api/maverik/runs (StartRunRequest.Metrics). Purely informational: every metric is always
// computed regardless of selection; this just records which ones the run was actually about, for
// a future comparison UI to default to.
public static class MaverikMetrics
{
    public const string Correctness = "correctness";
    public const string Duration = "duration";
    public const string InputTokens = "inputTokens";
    public const string OutputTokens = "outputTokens";
    public const string ToolCalls = "toolCalls";
    public const string ContextWindow = "contextWindow";
    public const string TokenCost = "tokenCost";
    public const string ToolCost = "toolCost";
    public const string OverallCost = "overallCost";

    public static readonly IReadOnlyList<string> All =
    [
        Correctness, Duration, InputTokens, OutputTokens, ToolCalls, ContextWindow, TokenCost, ToolCost, OverallCost
    ];
}

// A single (suite, agent, point in time) benchmark result, persisted standalone (independent of
// the batch run.json it came from) so it can be compared against other such records later —
// results/suite-runs/{suiteId}--{agentId}--{timestamp}.json (see MaverikResultsWriter).
public sealed record SuiteRunRecord(
    string SuiteId,
    string AgentId,
    AgentConfig AgentSnapshot,           // frozen copy of the config actually used, since
                                          // AgentRegistry is hot-reloadable and the same agentId
                                          // can mean a different prompt tomorrow
    DateTimeOffset Timestamp,
    string SourceRunId,                        // the batch runId, to drill into full per-case results/run.json
    IReadOnlyList<string> JudgedMetrics,
    AgentSummary Summary,
    // This agent's slice of the batch's per-case results, copied in at write time so a
    // per-question visualization has everything it needs directly from `data` — no `fetch` back
    // to run.json required, preserving the container-only visualization contract (see
    // config/reporting/README.md). Defaults to [] so records written before this field existed
    // still deserialize.
    IReadOnlyList<QuestionRunResult> Results = null!)
{
    public IReadOnlyList<QuestionRunResult> Results { get; init; } = Results ?? [];
}
