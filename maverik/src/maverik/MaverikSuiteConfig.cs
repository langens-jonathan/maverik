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

    // The llm-models.json id used by Multiturn questions with UserTurnMode "simulated" that
    // don't set their own UserSimulatorModel. Only required when at least one question uses
    // simulated multi-turn. Mirrors JudgeModel's suite-default/per-question-override shape.
    public string? UserSimulatorModel { get; set; }

    public List<MaverikQuestion> Questions { get; set; } = new();
}

// One question: Text is sent verbatim as the FIRST user message of a fresh, isolated
// conversation. When Multiturn is set, the conversation continues past that first exchange —
// see UserTurnMode below. Multiturn defaults false, so every suite written before this field
// existed keeps behaving exactly as it does today.
public sealed class MaverikQuestion
{
    public string Id { get; set; } = "";
    public string Text { get; set; } = "";

    // Nullable so a missing criterion is a clear validation error rather than a silent
    // default; a loaded suite always has one on every question.
    public MaverikCriterion? Criterion { get; set; }

    // Opt-in: when true, MaverikRunner keeps the conversation going past the agent's first
    // response instead of evaluating it immediately — see UserTurnMode for how the next user
    // message gets produced.
    public bool Multiturn { get; set; }

    // "scripted" (send ScriptedUserTurns in order, regardless of what the agent says — a fixed,
    // deterministic, zero-extra-cost input sequence) or "simulated" (a UserSimulatorModel reacts
    // to the agent's actual response and either ends the conversation or generates the next
    // message — realistic, but non-deterministic and has its own token cost). Required iff
    // Multiturn is true; validated by MaverikSuiteRegistry.
    public string? UserTurnMode { get; set; }

    // Ordered follow-up messages for UserTurnMode "scripted". Required (non-empty) iff that mode
    // is selected. Sent one per exchange until exhausted or MaxUserTurns is reached, whichever
    // comes first — the agent's own responses never affect whether the next one gets sent.
    public List<string>? ScriptedUserTurns { get; set; }

    // Extra grounding only the simulated user "knows" (e.g. account details, a specific repo
    // name) that it can reveal when the agent asks — folded into UserSimulator's system prompt
    // alongside Text. Optional; UserTurnMode "simulated" works without it, just with less to draw
    // on when improvising a follow-up.
    public string? UserContext { get; set; }

    // Per-question override for UserTurnMode "simulated"; falls back to the suite's
    // UserSimulatorModel — same override shape as MaverikCriterion.JudgeModel.
    public string? UserSimulatorModel { get; set; }

    // Safety ceiling on how many user-turn exchanges Multiturn will run, for EITHER mode — for
    // "scripted" this is a backstop against an accidentally huge ScriptedUserTurns list, for
    // "simulated" it's what stops a simulator that never says it's done. Null defaults to 4
    // (MaverikRunner.DefaultMaxUserTurns) — deliberately smaller than MaxIterations' default of
    // 8, since a user-turn exchange is coarser and more expensive than one tool-call iteration.
    public int? MaxUserTurns { get; set; }
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
