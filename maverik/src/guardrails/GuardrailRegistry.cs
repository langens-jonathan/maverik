using System.Text.RegularExpressions;
using McpHost.LlmModel;
using Microsoft.Extensions.AI;

namespace McpHost.Guardrails;

// Loads guardrails.json and makes policies resolvable by id. Structurally mirrors AgentRegistry
// (single immutable Snapshot, swapped by reference on Reload — atomic in .NET, so a concurrent
// Resolve() sees either the fully-old or fully-new snapshot, never a torn mix, no locking needed
// on the read side). Like AgentRegistry/MaverikSuiteRegistry (and unlike ToolCostRegistry/
// CapabilityOverrideRegistry, which are pure data), Build can genuinely fail — a rule can
// reference an unresolvable classifier model — so a bad Reload throws and leaves the previous
// snapshot serving; the field is only assigned after Build succeeds.
public sealed class GuardrailRegistry
{
    private sealed class Snapshot
    {
        public required IReadOnlyDictionary<string, GuardrailPolicy> Policies { get; init; }
    }

    private readonly LLMModelRegistry _models;
    private readonly ILogger<GuardrailRegistry> _log;
    private Snapshot _snapshot;

    public GuardrailRegistry(GuardrailsFile file, LLMModelRegistry models, ILogger<GuardrailRegistry> log)
    {
        _models = models;
        _log = log;
        _snapshot = Build(file, models, log);
    }

    public IReadOnlyCollection<GuardrailPolicy> Policies => (IReadOnlyCollection<GuardrailPolicy>)_snapshot.Policies.Values;

    // Unknown id throws — same fail-loudly convention as AgentRegistry.Resolve.
    public GuardrailPolicy Resolve(string id)
    {
        var snap = _snapshot;
        if (snap.Policies.TryGetValue(id, out var policy))
            return policy;

        throw new InvalidOperationException(
            $"No guardrail with id '{id}' — check guardrails.json.");
    }

    public void Reload(GuardrailsFile file) => _snapshot = Build(file, _models, _log);

    // Resolves an agent's zero-or-more guardrail ids to policies, plus a ready IChatClient for
    // every DISTINCT llm-classifier model any of those policies' rules reference — resolved once
    // per agent selection/chat job, mirroring how MaverikRunner/ChatWorker already resolve
    // chat/tools once up front rather than per-turn. Unknown guardrail id throws (same
    // lazy-fail-loud convention as agent.Model/agent.McpServers).
    public (IReadOnlyList<GuardrailPolicy> Policies, IReadOnlyDictionary<string, IChatClient> ClassifierClients)
        ResolveForAgent(IReadOnlyList<string> guardrailIds, LLMModelRegistry models)
    {
        if (guardrailIds.Count == 0)
            return ([], new Dictionary<string, IChatClient>());

        var policies = guardrailIds.Select(Resolve).ToList();

        var classifierModelIds = policies
            .SelectMany(p => p.InputRules.Concat(p.OutputRules)
                .Where(r => string.Equals(r.Type, "llm-classifier", StringComparison.OrdinalIgnoreCase))
                .Select(r => r.ClassifierModel ?? p.ClassifierModel))
            .Where(id => id is not null)
            .Distinct(StringComparer.Ordinal)
            .ToList();

        var clients = classifierModelIds.ToDictionary(id => id!, id => models.Resolve(id));
        return (policies, clients);
    }

    private static Snapshot Build(GuardrailsFile file, LLMModelRegistry models, ILogger log)
    {
        var policies = new Dictionary<string, GuardrailPolicy>();

        foreach (var policy in file.Guardrails)
        {
            Validate(policy, models);

            if (!policies.TryAdd(policy.Id, policy))
                throw Bad($"has duplicate policy id '{policy.Id}'.");
        }

        log.LogInformation("Loaded {Count} guardrail polic{Suffix}.", policies.Count, policies.Count == 1 ? "y" : "ies");
        return new Snapshot { Policies = policies };
    }

    // internal (not private) so tests can exercise validation directly, without needing a
    // filesystem-backed registry — same reasoning MaverikSuiteRegistry.Validate is internal for.
    internal static void Validate(GuardrailPolicy policy, LLMModelRegistry models)
    {
        if (string.IsNullOrWhiteSpace(policy.Id))
            throw Bad("has a policy without an 'id'.");

        var ruleIds = new HashSet<string>();
        foreach (var rule in policy.InputRules.Concat(policy.OutputRules))
        {
            if (string.IsNullOrWhiteSpace(rule.Id))
                throw Bad($"policy '{policy.Id}' has a rule without an 'id'.");
            if (!ruleIds.Add(rule.Id))
                throw Bad($"policy '{policy.Id}' has duplicate rule id '{rule.Id}'.");

            if (!string.Equals(rule.Action, "block", StringComparison.OrdinalIgnoreCase) &&
                !string.Equals(rule.Action, "flag", StringComparison.OrdinalIgnoreCase))
                throw Bad($"policy '{policy.Id}' rule '{rule.Id}' has unknown action '{rule.Action}' (expected 'block' or 'flag').");

            switch (rule.Type.ToLowerInvariant())
            {
                case "pattern":
                    if (string.IsNullOrEmpty(rule.Pattern))
                        throw Bad($"policy '{policy.Id}' rule '{rule.Id}' is type 'pattern' but has no 'pattern'.");
                    try { _ = new Regex(rule.Pattern); }
                    catch (ArgumentException ex)
                    {
                        throw Bad($"policy '{policy.Id}' rule '{rule.Id}' has invalid regex pattern: {ex.Message}");
                    }
                    break;

                case "llm-classifier":
                    if (string.IsNullOrWhiteSpace(rule.Classifier))
                        throw Bad($"policy '{policy.Id}' rule '{rule.Id}' is type 'llm-classifier' but has no 'classifier'.");

                    var classifierModel = rule.ClassifierModel ?? policy.ClassifierModel;
                    if (string.IsNullOrWhiteSpace(classifierModel))
                        throw Bad($"policy '{policy.Id}' rule '{rule.Id}' uses llm-classifier but neither the rule " +
                                  "nor the policy sets a 'classifierModel'.");
                    try { models.Resolve(classifierModel); }
                    catch (Exception ex)
                    {
                        throw Bad($"policy '{policy.Id}' rule '{rule.Id}' classifier model '{classifierModel}' does not resolve: {ex.Message}");
                    }
                    break;

                default:
                    throw Bad($"policy '{policy.Id}' rule '{rule.Id}' has unknown type '{rule.Type}' (expected 'pattern' or 'llm-classifier').");
            }
        }

        foreach (var tool in policy.DeniedTools)
        {
            if (string.IsNullOrWhiteSpace(tool))
                throw Bad($"policy '{policy.Id}' has an empty entry in 'deniedTools'.");
        }
    }

    private static InvalidOperationException Bad(string problem) =>
        new($"guardrails.json {problem}");
}
