namespace McpHost.Maverik;

// One MAVERIK test suite, bound from a maverik-suites/*.json file (one file per suite).
// Loaded and validated at startup by MaverikSuiteRegistry.
public sealed class MaverikSuite
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";

    // The default set of agent ids (from agents.json) this suite runs against; a run request
    // may override it. Validated against AgentRegistry at load time.
    public List<string> Agents { get; set; } = new();

    // The llm-models.json id used by llm-judge criteria that don't set their own judgeModel.
    // Only required when at least one question uses llm-judge.
    public string? JudgeModel { get; set; }

    public List<MaverikQuestion> Questions { get; set; } = new();
}

// One question: sent verbatim as the user message of a fresh, isolated conversation.
public sealed class MaverikQuestion
{
    public string Id { get; set; } = "";
    public string Text { get; set; } = "";

    // Nullable so a missing criterion is a clear validation error rather than a silent
    // default; a loaded suite always has one on every question.
    public MaverikCriterion? Criterion { get; set; }
}

// How to decide whether an answer is correct. One flat class with optional per-type fields —
// simpler than polymorphic JSON. Which field is required depends on Type:
//   exact / contains → Expected (CaseSensitive optional, default false)
//   regex            → Pattern (must compile)
//   llm-judge        → Rubric (JudgeModel optional; falls back to the suite's)
public sealed class MaverikCriterion
{
    public string Type { get; set; } = "";
    public string? Expected { get; set; }
    public bool CaseSensitive { get; set; }
    public string? Pattern { get; set; }
    public string? Rubric { get; set; }
    public string? JudgeModel { get; set; }
}
