namespace McpHost.Guardrails;

// One guardrail check that actually fired (matched), whether or not it altered behavior.
// Referenced by both TurnResult (McpHost.Loop) and QuestionRunResult (McpHost.Maverik) — this
// type lives in its own namespace so neither has to depend on the other for it.
public sealed record GuardrailFinding(
    string Stage,     // "input" | "output" | "tool"
    string PolicyId,
    // For Stage == "tool" this is the literal denied tool name — DeniedTools entries have no
    // per-entry rule id of their own (see GuardrailPolicy.DeniedTools).
    string RuleId,
    string Action,    // "block" | "flag"
    string? Detail);  // e.g. "pattern matched", the classifier's reasoning, or the denied tool name
