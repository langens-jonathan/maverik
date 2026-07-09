namespace McpHost;

// One unit of work for the MAVERIK runner: execute a suite against a set of agents, N
// repetitions per (agent, question) pair. The 1↔2-style seam between the POST endpoint and
// the runner, mirroring ChatJob.
public sealed record RunRequest(
    string RunId,
    string SuiteId,
    IReadOnlyList<string> AgentIds,
    int Repetitions);

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
    IReadOnlyList<QuestionRunResult> Results);
