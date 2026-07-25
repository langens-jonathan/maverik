namespace McpHost.Maverik;

// Lookup table for what a single invocation of a given (mcpServer, tool) pair costs, used by
// MaverikSummaryBuilder to compute tool cost / overall cost alongside token cost. Same
// snapshot-swap pattern as AgentRegistry/LLMModelRegistry (see src/agents/AgentRegistry.cs) —
// reference assignment is atomic, so a concurrent read sees either the fully-old or fully-new
// snapshot. Simpler than either of those: pure data, no file I/O or client construction inside
// Build, so Reload can't meaningfully fail — no rollback-on-throw needed.
public sealed class ToolCostRegistry
{
    private IReadOnlyDictionary<(string Server, string Tool), decimal> _costs;

    public ToolCostRegistry(ToolCostsFile file)
    {
        _costs = Build(file);
    }

    // Cost of one invocation of (server, tool); 0 if not configured — most tools are free.
    public decimal CostOf(string server, string tool) =>
        _costs.TryGetValue((server, tool), out var cost) ? cost : 0m;

    public void Reload(ToolCostsFile file)
    {
        _costs = Build(file);
    }

    private static IReadOnlyDictionary<(string, string), decimal> Build(ToolCostsFile file)
    {
        var costs = new Dictionary<(string, string), decimal>();
        foreach (var entry in file.ToolCosts)
            costs[(entry.McpServer, entry.Tool)] = entry.CostPerInvocation;
        return costs;
    }
}
