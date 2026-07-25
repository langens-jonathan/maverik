using System.Text.Json;
using System.Text.RegularExpressions;
using McpHost.Agents;
using McpHost.LlmModel;

namespace McpHost.Maverik;

// Loads every MAVERIK test suite from maverik-suites/*.json and makes them resolvable by id.
// Like AgentRegistry this is a plain singleton with nothing to connect to — but unlike the
// MCP/LLM registries a broken suite file FAILS STARTUP: a suite that silently loaded wrong
// would produce misleading benchmark results, which is worse than not starting.
//
// A missing or empty maverik-suites/ folder is fine (zero suites, logged) — the host is still
// useful as a plain chat host without MAVERIK.
//
// Supports Reload() (same rollback-on-throw pattern as AgentRegistry — see
// src/agents/AgentRegistry.cs): the whole suite set is rebuilt from disk and swapped in by a
// single reference assignment, atomic in .NET, so a concurrent Resolve()/Suites read sees either
// the fully-old or fully-new set, never a mix. If rebuilding throws (a bad suite file), the field
// is left untouched — a bad edit can't take the host down, it just fails to apply until fixed.
public sealed class MaverikSuiteRegistry
{
    private static readonly string[] CriterionTypes = ["exact", "contains", "regex", "llm-judge"];

    private readonly string _configDir;
    private readonly AgentRegistry _agents;
    private readonly LLMModelRegistry _models;
    private readonly ILogger<MaverikSuiteRegistry> _log;
    private IReadOnlyDictionary<string, MaverikSuite> _suites;

    public MaverikSuiteRegistry(
        string configDir,
        AgentRegistry agents,
        LLMModelRegistry models,
        ILogger<MaverikSuiteRegistry> log)
    {
        _configDir = configDir;
        _agents = agents;
        _models = models;
        _log = log;
        _suites = Build();
    }

    public IReadOnlyCollection<MaverikSuite> Suites => (IReadOnlyCollection<MaverikSuite>)_suites.Values;

    // Unknown id throws — same fail-loudly convention as the other registries.
    public MaverikSuite Resolve(string id)
    {
        if (_suites.TryGetValue(id, out var suite))
            return suite;

        throw new InvalidOperationException(
            $"No suite with id '{id}' — available: {(_suites.Count == 0 ? "(none)" : string.Join(", ", _suites.Keys))}.");
    }

    public void Reload() => _suites = Build();

    private IReadOnlyDictionary<string, MaverikSuite> Build()
    {
        var suites = new Dictionary<string, MaverikSuite>();

        var dir = Path.Combine(_configDir, "maverik-suites");
        if (!Directory.Exists(dir))
        {
            _log.LogInformation("No maverik-suites directory at '{Dir}'; 0 suites loaded.", dir);
            return suites;
        }

        var jsonOptions = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

        foreach (var path in Directory.GetFiles(dir, "*.json").OrderBy(p => p, StringComparer.OrdinalIgnoreCase))
        {
            var file = Path.GetFileName(path);

            MaverikSuite? suite;
            try
            {
                suite = JsonSerializer.Deserialize<MaverikSuite>(File.ReadAllText(path), jsonOptions);
            }
            catch (JsonException ex)
            {
                throw new InvalidOperationException($"Suite file '{file}' is not valid JSON: {ex.Message}", ex);
            }

            if (suite is null)
                throw new InvalidOperationException($"Suite file '{file}' deserialized to null.");

            Validate(suite, file, _agents, _models);

            if (!suites.TryAdd(suite.Id, suite))
                throw new InvalidOperationException(
                    $"Suite file '{file}' has id '{suite.Id}', which another suite file already uses.");

            _log.LogInformation("Loaded suite '{Id}' ({Questions} question(s), {Agents} agent(s)) from {File}.",
                suite.Id, suite.Questions.Count, suite.Agents.Count, file);
        }

        _log.LogInformation("MAVERIK suites ready: {Count} suite(s).", suites.Count);
        return suites;
    }

    // All the ways a suite file can be wrong, each with a message that names the file and the
    // offending question so the fix is obvious.
    private static void Validate(MaverikSuite suite, string file, AgentRegistry agents, LLMModelRegistry models)
    {
        if (string.IsNullOrWhiteSpace(suite.Id))
            throw Bad(file, "has no 'id'.");
        if (suite.Questions.Count == 0)
            throw Bad(file, "has no questions.");

        foreach (var agentId in suite.Agents)
        {
            try { agents.Resolve(agentId); }
            catch (Exception ex) { throw Bad(file, $"references unknown agent '{agentId}': {ex.Message}"); }
        }

        var questionIds = new HashSet<string>();
        foreach (var question in suite.Questions)
        {
            if (string.IsNullOrWhiteSpace(question.Id))
                throw Bad(file, "has a question without an 'id'.");
            if (!questionIds.Add(question.Id))
                throw Bad(file, $"has duplicate question id '{question.Id}'.");
            if (string.IsNullOrWhiteSpace(question.Text))
                throw Bad(file, $"question '{question.Id}' has no 'text'.");

            var criterion = question.Criterion
                ?? throw Bad(file, $"question '{question.Id}' has no 'criterion'.");

            if (!CriterionTypes.Contains(criterion.Type, StringComparer.OrdinalIgnoreCase))
                throw Bad(file, $"question '{question.Id}' has unknown criterion type '{criterion.Type}' " +
                                $"(expected one of: {string.Join(", ", CriterionTypes)}).");

            switch (criterion.Type.ToLowerInvariant())
            {
                case "exact":
                case "contains":
                    if (string.IsNullOrEmpty(criterion.Expected))
                        throw Bad(file, $"question '{question.Id}' criterion '{criterion.Type}' needs 'expected'.");
                    break;

                case "regex":
                    if (string.IsNullOrEmpty(criterion.Pattern))
                        throw Bad(file, $"question '{question.Id}' criterion 'regex' needs 'pattern'.");
                    try { _ = new Regex(criterion.Pattern); }
                    catch (ArgumentException ex)
                    {
                        throw Bad(file, $"question '{question.Id}' has invalid regex pattern: {ex.Message}");
                    }
                    break;

                case "llm-judge":
                    if (string.IsNullOrWhiteSpace(criterion.Rubric))
                        throw Bad(file, $"question '{question.Id}' criterion 'llm-judge' needs 'rubric'.");

                    var judgeModel = criterion.JudgeModel ?? suite.JudgeModel;
                    if (string.IsNullOrWhiteSpace(judgeModel))
                        throw Bad(file, $"question '{question.Id}' uses llm-judge but neither the criterion " +
                                        "nor the suite sets a 'judgeModel'.");
                    try { models.Resolve(judgeModel); }
                    catch (Exception ex)
                    {
                        throw Bad(file, $"question '{question.Id}' judge model '{judgeModel}' does not resolve: {ex.Message}");
                    }
                    break;
            }
        }

        static InvalidOperationException Bad(string file, string problem) =>
            new($"Suite file '{file}' {problem}");
    }
}
