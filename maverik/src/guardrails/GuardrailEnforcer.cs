using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.AI;

namespace McpHost.Guardrails;

// The actual check logic — stateless static, deliberately DI-free (LoopStrategyBase itself has
// no DI dependencies; anything the loop needs must arrive already-resolved through TurnRequest,
// never pulled from a registry inside the loop — same reasoning ContextCutoff follows).
public static class GuardrailEnforcer
{
    private const string DefaultRefusal = "I can't help with that.";

    // Checked once per RunTurnAsync call, against the user's message the agent hasn't seen yet.
    public static Task<(IReadOnlyList<GuardrailFinding> Findings, string? RefusalText)> CheckInputAsync(
        IReadOnlyList<GuardrailPolicy> policies, string text,
        IReadOnlyDictionary<string, IChatClient> classifierClients, CancellationToken ct) =>
        CheckAsync("input", policies, p => p.InputRules, text, classifierClients, ct);

    // Checked once per RunTurnAsync call, against the turn's final answer text only (v1 —
    // intermediate assistant messages within a tool-heavy turn aren't checked, to avoid a
    // classifier call on every iteration).
    public static Task<(IReadOnlyList<GuardrailFinding> Findings, string? RefusalText)> CheckOutputAsync(
        IReadOnlyList<GuardrailPolicy> policies, string text,
        IReadOnlyDictionary<string, IChatClient> classifierClients, CancellationToken ct) =>
        CheckAsync("output", policies, p => p.OutputRules, text, classifierClients, ct);

    private static async Task<(IReadOnlyList<GuardrailFinding> Findings, string? RefusalText)> CheckAsync(
        string stage, IReadOnlyList<GuardrailPolicy> policies, Func<GuardrailPolicy, List<GuardrailRule>> rulesOf,
        string text, IReadOnlyDictionary<string, IChatClient> classifierClients, CancellationToken ct)
    {
        var findings = new List<GuardrailFinding>();

        foreach (var policy in policies)
        {
            foreach (var rule in rulesOf(policy))
            {
                var (matched, detail) = await EvaluateRuleAsync(policy, rule, text, classifierClients, ct);
                if (!matched)
                    continue;

                findings.Add(new GuardrailFinding(stage, policy.Id, rule.Id, rule.Action, detail));

                // Nothing to gain from finding a second violation once the turn is already
                // being blocked; a "flag" rule firing doesn't stop the scan, since multiple
                // non-blocking findings can all be worth recording.
                if (string.Equals(rule.Action, "block", StringComparison.OrdinalIgnoreCase))
                    return (findings, rule.RefusalMessage ?? DefaultRefusal);
            }
        }

        return (findings, null);
    }

    // Does ANY policy's DeniedTools contain this name. Returns the first matching policy id.
    public static bool TryGetDenyingPolicy(IReadOnlyList<GuardrailPolicy> policies, string toolName, out string? policyId)
    {
        foreach (var policy in policies)
        {
            if (policy.DeniedTools.Contains(toolName, StringComparer.Ordinal))
            {
                policyId = policy.Id;
                return true;
            }
        }
        policyId = null;
        return false;
    }

    private static async Task<(bool Matched, string? Detail)> EvaluateRuleAsync(
        GuardrailPolicy policy, GuardrailRule rule, string text,
        IReadOnlyDictionary<string, IChatClient> classifierClients, CancellationToken ct)
    {
        switch (rule.Type.ToLowerInvariant())
        {
            case "pattern":
            {
                var options = rule.CaseSensitive ? RegexOptions.None : RegexOptions.IgnoreCase;
                var matched = Regex.IsMatch(text, rule.Pattern!, options);
                return (matched, matched ? "pattern matched" : null);
            }

            case "llm-classifier":
            {
                var modelId = rule.ClassifierModel ?? policy.ClassifierModel;
                var client = classifierClients[modelId!];

                List<ChatMessage> messages =
                [
                    new(ChatRole.System,
                        "You are a content classifier for an application guardrail. Judge ONLY whether the " +
                        $"text matches this rule: {rule.Classifier}\n\n" +
                        "Reply with ONLY this JSON and nothing else: " +
                        "{\"match\": true or false, \"reasoning\": \"one short sentence\"}"),
                    new(ChatRole.User, text),
                ];

                var response = await client.GetResponseAsync(messages, new ChatOptions { Temperature = 0 }, ct);
                return ParseClassifierReply(response.Text);
            }

            default:
                // Unreachable for guardrails that came through GuardrailRegistry validation.
                throw new InvalidOperationException($"Guardrail rule '{rule.Id}' has unknown type '{rule.Type}'.");
        }
    }

    // Same tolerant outermost-{...}-span parse CriterionEvaluator.ParseVerdict/UserSimulator.
    // ParseTurn already use — models sometimes wrap JSON in prose or code fences. An unparseable
    // reply fails open (no match) rather than throwing or blocking, same "one flaky reply must
    // not kill a run" stance those two take — see CLAUDE.md for why this default deserves a
    // second look specifically for a safety feature.
    internal static (bool Matched, string? Detail) ParseClassifierReply(string text)
    {
        var start = text.IndexOf('{');
        var end = text.LastIndexOf('}');
        if (start < 0 || end <= start)
            return (false, null);

        try
        {
            using var doc = JsonDocument.Parse(text[start..(end + 1)]);

            if (!doc.RootElement.TryGetProperty("match", out var match) || match.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                return (false, null);

            var reasoning = doc.RootElement.TryGetProperty("reasoning", out var r) && r.ValueKind == JsonValueKind.String
                ? r.GetString()
                : null;

            return (match.GetBoolean(), match.GetBoolean() ? reasoning ?? "classifier matched" : null);
        }
        catch (JsonException)
        {
            return (false, null);
        }
    }
}
