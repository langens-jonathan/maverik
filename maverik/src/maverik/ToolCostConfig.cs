namespace McpHost.Maverik;

// Root of tool-costs.json.
public sealed class ToolCostsFile
{
    public List<ToolCostConfig> ToolCosts { get; set; } = new();
}

// The cost of one (mcpServer, tool) pair being invoked once. A tool with no entry here costs 0 —
// most tools are free; this only needs entries for the ones that aren't (e.g. a metered external
// API behind an MCP server).
public sealed class ToolCostConfig
{
    public string McpServer { get; set; } = "";
    public string Tool { get; set; } = "";
    public decimal CostPerInvocation { get; set; }
}
