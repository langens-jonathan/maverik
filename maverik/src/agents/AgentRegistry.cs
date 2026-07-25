namespace McpHost.Agents;

// Loads the agents from agents.json and makes them resolvable by id. Unlike McpServerRegistry
// there is nothing to connect to, so this is a plain singleton — no async, no hosted service.
//
// At construction (and on Reload) it also resolves each agent's effective system prompt: an
// inline `systemPrompt` wins; otherwise the text is read from prompts/agent/<id>.md. The
// resolved text is written back onto AgentConfig.SystemPrompt, so callers just read that
// property without caring about the source.
//
// State lives in a single immutable Snapshot, swapped by reference on Reload(). Reference
// assignment is atomic in .NET, so a Resolve() running concurrently with a Reload() sees either
// the fully-old or fully-new snapshot, never a torn mix — no locking needed on the read side.
public sealed class AgentRegistry
{
    private sealed class Snapshot
    {
        public required string DefaultAgent { get; init; }
        public required IReadOnlyDictionary<string, AgentConfig> Agents { get; init; }
    }

    private readonly string _configDir;
    private readonly ILogger<AgentRegistry> _log;
    private Snapshot _snapshot;

    public AgentRegistry(AgentsFile file, string configDir, ILogger<AgentRegistry> log)
    {
        _configDir = configDir;
        _log = log;
        _snapshot = Build(file, configDir, log);
    }

    public string DefaultAgent => _snapshot.DefaultAgent;
    public IReadOnlyCollection<AgentConfig> Agents => (IReadOnlyCollection<AgentConfig>)_snapshot.Agents.Values;

    // Return the agent for an id, or the default when id is null/empty. An unknown id throws —
    // like LLMModelRegistry.Resolve, a bad id should fail loudly rather than silently fall back.
    public AgentConfig Resolve(string? id)
    {
        var snap = _snapshot;
        var key = string.IsNullOrEmpty(id) ? snap.DefaultAgent : id;

        if (snap.Agents.TryGetValue(key, out var agent))
            return agent;

        throw new InvalidOperationException(
            $"No agent with id '{key}' — check agents.json (defaultAgent / agents[].id).");
    }

    // Rebuilds the agent set (re-reading each agent's prompt file) from a freshly edited
    // agents.json — or from the current one, to pick up a prompt-file-only edit — and atomically
    // swaps it in. If building the new snapshot throws (e.g. a new agent references a missing
    // prompt file), the field is left untouched and the previous snapshot keeps serving: a bad
    // edit can't take the host down, it just fails to apply until fixed.
    public void Reload(AgentsFile file)
    {
        _snapshot = Build(file, _configDir, _log);
    }

    private static Snapshot Build(AgentsFile file, string configDir, ILogger log)
    {
        var agents = new Dictionary<string, AgentConfig>();

        foreach (var agent in file.Agents)
        {
            ResolveSystemPrompt(agent, configDir);
            agents[agent.Id] = agent;
        }

        log.LogInformation("Loaded {Count} agent(s); default '{Default}'.", agents.Count, file.DefaultAgent);
        return new Snapshot { DefaultAgent = file.DefaultAgent, Agents = agents };
    }

    // Inline systemPrompt wins; otherwise load prompts/agent/<id>.md. Having neither is a config
    // error (an agent must get its prompt from somewhere), surfaced with a clear message.
    private static void ResolveSystemPrompt(AgentConfig agent, string configDir)
    {
        if (!string.IsNullOrWhiteSpace(agent.SystemPrompt))
            return;

        var path = Path.Combine(configDir, "prompts", "agent", agent.Id + ".md");
        if (!File.Exists(path))
            throw new InvalidOperationException(
                $"Agent '{agent.Id}' has no inline systemPrompt and no prompt file at '{path}'.");

        agent.SystemPrompt = File.ReadAllText(path);
    }
}
