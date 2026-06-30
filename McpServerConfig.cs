namespace McpHost;

// Root of mcp-servers.json.
public sealed class McpServersFile
{
    public List<McpServerConfig> Servers { get; set; } = new();
}

// One MCP server entry. Only the HTTP transport is supported: Endpoint is required and
// Headers are sent on every request. Header values may contain ${ENV_VAR} placeholders,
// expanded at connect time so secrets stay out of the committed config.
public sealed class McpServerConfig
{
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public string Transport { get; set; } = "http";

    public string? Endpoint { get; set; }
    public Dictionary<string, string> Headers { get; set; } = new();
}
