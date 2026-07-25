namespace McpHost.Agents;

// Loads the agents from agents.json and makes them resolvable by id. Unlike McpServerRegistry
// there is nothing to connect to, so this is a plain singleton — no async, no hosted service.
//
// At construction it also resolves each agent's effective system prompt: an inline `systemPrompt`
// wins; otherwise the text is read from prompts/agent/<id>.md. The resolved text is written back
// onto AgentConfig.SystemPrompt, so callers just read that property without caring about the source.
public sealed class AgentRegistry
{
    private readonly Dictionary<string, AgentConfig> _agents = new();
    private readonly string _defaultAgent;

    public AgentRegistry(AgentsFile file, string contentRootPath, ILogger<AgentRegistry> log)
    {
        _defaultAgent = file.DefaultAgent;

        foreach (var agent in file.Agents)
        {
            ResolveSystemPrompt(agent, contentRootPath);
            _agents[agent.Id] = agent;
        }

        log.LogInformation("Loaded {Count} agent(s); default '{Default}'.", _agents.Count, _defaultAgent);
    }

    public string DefaultAgent => _defaultAgent;
    public IReadOnlyCollection<AgentConfig> Agents => _agents.Values;

    // Return the agent for an id, or the default when id is null/empty. An unknown id throws —
    // like LLMModelRegistry.Resolve, a bad id should fail loudly rather than silently fall back.
    public AgentConfig Resolve(string? id)
    {
        var key = string.IsNullOrEmpty(id) ? _defaultAgent : id;

        if (_agents.TryGetValue(key, out var agent))
            return agent;

        throw new InvalidOperationException(
            $"No agent with id '{key}' — check agents.json (defaultAgent / agents[].id).");
    }

    // Inline systemPrompt wins; otherwise load prompts/agent/<id>.md. Having neither is a config
    // error (an agent must get its prompt from somewhere), surfaced with a clear message.
    private static void ResolveSystemPrompt(AgentConfig agent, string contentRootPath)
    {
        if (!string.IsNullOrWhiteSpace(agent.SystemPrompt))
            return;

        var path = Path.Combine(contentRootPath, "prompts", "agent", agent.Id + ".md");
        if (!File.Exists(path))
            throw new InvalidOperationException(
                $"Agent '{agent.Id}' has no inline systemPrompt and no prompt file at '{path}'.");

        agent.SystemPrompt = File.ReadAllText(path);
    }
}
