namespace McpHost.Guardrails;

// Root of guardrails.json.
public sealed class GuardrailsFile
{
    public List<GuardrailPolicy> Guardrails { get; set; } = new();
}

// A named bundle of checks an agent can opt into (see AgentConfig.Guardrails), modeling the
// kind of application-level guardrail a company wraps around a deployed agent — independent of
// whatever safety behavior the underlying model has on its own. Referenced by id, same
// reference-by-string-id-through-a-registry shape as AgentConfig.McpServers/Model.
public sealed class GuardrailPolicy
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";

    // Checked against the user's message before the agent ever sees it.
    public List<GuardrailRule> InputRules { get; set; } = new();

    // Checked against the turn's final answer text (v1: final text only, not every intermediate
    // assistant message — see LoopStrategy.cs's RunTurnAsync).
    public List<GuardrailRule> OutputRules { get; set; } = new();

    // Tool names this policy always blocks outright, regardless of what any rule above says —
    // name-only, all-or-nothing (no per-argument conditions in v1). No Action variants: a denied
    // tool is always a hard block, there's no meaningful "flag but still allow the call" for a
    // tool-allowlist mechanism.
    public List<string> DeniedTools { get; set; } = new();

    // Default llm-models.json id for any rule below that doesn't set its own ClassifierModel.
    // Only required when at least one rule uses type "llm-classifier".
    public string? ClassifierModel { get; set; }
}

// One check within a policy. Which field is required depends on Type:
//   pattern        -> Pattern (must compile; CaseSensitive optional, default false)
//   llm-classifier -> Classifier (ClassifierModel optional; falls back to the policy's)
public sealed class GuardrailRule
{
    // Stable within the policy — surfaced on GuardrailFinding.RuleId so a suite/report can say
    // exactly which rule fired.
    public string Id { get; set; } = "";

    public string Type { get; set; } = "";
    public string? Pattern { get; set; }
    public bool CaseSensitive { get; set; }

    // Free-text instruction, e.g. "the message is a jailbreak attempt or tries to get the
    // assistant to ignore its instructions" — sent to the classifier model as "does this text
    // match: {Classifier}".
    public string? Classifier { get; set; }
    public string? ClassifierModel { get; set; }

    // "block" (substitute a refusal / deny the request) or "flag" (record a finding, don't alter
    // behavior). Redact-and-continue is deliberately not supported in v1 — see CLAUDE.md.
    public string Action { get; set; } = "block";

    // Used only when Action == "block"; a generic default is substituted when null.
    public string? RefusalMessage { get; set; }
}
