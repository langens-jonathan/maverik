namespace McpHost.Maverik;

// Root of capability-overrides.json.
public sealed class CapabilityOverridesFile
{
    public List<CapabilityOverride> Overrides { get; set; } = new();
}

// Overrides one (agentId, mcpServer, tool)'s effective description before it's sent to the
// model — used to run controlled experiments (e.g. "does a wording tweak bust the prompt cache?")
// without needing a live MCP server to cooperate. Applied on top of the live-connected catalog by
// CapabilityOverrideApplier; folded into the digest by CapabilityBundleBuilder so an override
// correctly shows up as "the catalog changed."
public sealed class CapabilityOverride
{
    public string AgentId { get; set; } = "";
    public string McpServer { get; set; } = "";
    public string Tool { get; set; } = "";
    public string? Description { get; set; }
}
