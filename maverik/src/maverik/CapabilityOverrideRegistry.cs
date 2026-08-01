namespace McpHost.Maverik;

// Lookup table for per-agent tool-description overrides, used by MaverikRunner to build a
// capability bundle/presentation-tools list that reflects an experiment's overrides rather than
// only the live MCP catalog. Same snapshot-swap pattern as ToolCostRegistry (see
// src/maverik/ToolCostRegistry.cs) — reference assignment is atomic, so a concurrent read sees
// either the fully-old or fully-new snapshot. Simpler than either of those: pure data, no file I/O
// or client construction inside Build, so Reload can't meaningfully fail — no rollback-on-throw
// needed.
public sealed class CapabilityOverrideRegistry
{
    private IReadOnlyDictionary<(string AgentId, string Server, string Tool), string> _overrides;

    public CapabilityOverrideRegistry(CapabilityOverridesFile file)
    {
        _overrides = Build(file);
    }

    // Every (server, tool) -> description override configured for one agent; empty for an agent
    // with no overrides (the common case) — most agents send exactly what the live catalog says.
    public IReadOnlyDictionary<(string Server, string Tool), string> OverridesFor(string agentId) =>
        _overrides
            .Where(kv => kv.Key.AgentId == agentId)
            .ToDictionary(kv => (kv.Key.Server, kv.Key.Tool), kv => kv.Value);

    public void Reload(CapabilityOverridesFile file)
    {
        _overrides = Build(file);
    }

    private static IReadOnlyDictionary<(string, string, string), string> Build(CapabilityOverridesFile file)
    {
        var overrides = new Dictionary<(string, string, string), string>();
        foreach (var entry in file.Overrides)
            if (entry.Description is not null)
                overrides[(entry.AgentId, entry.McpServer, entry.Tool)] = entry.Description;
        return overrides;
    }
}
