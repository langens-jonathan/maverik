namespace McpHost;

// Root of agents.json.
public sealed class AgentsFile
{
    public string DefaultAgent { get; set; } = "";
    public List<AgentConfig> Agents { get; set; } = new();
}

// One agent: a named bundle of the things that used to be hardcoded across the host — the model,
// the priming prompt, which MCP servers it may use, and its loop settings. Defined in agents.json
// and resolved at startup (no UI / runtime editing yet).
public sealed class AgentConfig
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";

    // A model id from llm-models.json (resolved via LLMModelRegistry.Resolve).
    public string Model { get; set; } = "";

    // Optional priming prompt. When null/empty, AgentRegistry loads it from prompts/agent/<id>.md
    // instead — inline wins when present. AgentRegistry assigns the resolved text back here at load
    // time, so downstream code just reads SystemPrompt without caring where it came from.
    public string? SystemPrompt { get; set; }

    // Server names that must match `name` values in mcp-servers.json. The agent is only handed the
    // tools from these servers (filtered from the already-connected catalog).
    public List<string> McpServers { get; set; } = new();

    public int MaxIterations { get; set; } = 8;
}
