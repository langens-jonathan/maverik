namespace McpHost;

// Root of mcp-servers.json.
public sealed class McpServersFile
{
    public List<McpServerConfig> Servers { get; set; } = new();
}

// One server entry. The 'transport' field is the discriminator:
//   "http"  -> Endpoint + Headers are used (e.g. GitHub).
//   "stdio" -> Command + Args + Env are used (e.g. Spotify; wired in step 5).
// Modelled as one class with optional fields per transport rather than a polymorphic
// hierarchy — simpler to bind from JSON, and the factory validates per transport.
public sealed class McpServerConfig
{
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public string Transport { get; set; } = "http";

    // http transport
    public string? Endpoint { get; set; }
    public Dictionary<string, string> Headers { get; set; } = new();

    // stdio transport (step 5)
    public string? Command { get; set; }
    public List<string> Args { get; set; } = new();
    public Dictionary<string, string> Env { get; set; } = new();
}
