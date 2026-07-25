namespace McpHost.Loop;

// Maps an agent's loopType to the strategy that drives its tool loop. The strategies are
// stateless, so they are built once here. A null/empty loopType falls back to "manual"
// (AgentConfig's default); an unknown one throws — same fail-loudly convention as
// AgentRegistry.Resolve and LLMModelRegistry.Resolve.
public sealed class LoopStrategyRegistry
{
    private readonly Dictionary<string, ILoopStrategy> _strategies;

    public LoopStrategyRegistry()
    {
        _strategies = new ILoopStrategy[]
        {
            new ManualLoopStrategy(),
            new ParallelToolsLoopStrategy(),
        }.ToDictionary(s => s.Name, StringComparer.OrdinalIgnoreCase);
    }

    public ILoopStrategy Resolve(string? loopType)
    {
        var key = string.IsNullOrWhiteSpace(loopType) ? "manual" : loopType;

        if (_strategies.TryGetValue(key, out var strategy))
            return strategy;

        throw new InvalidOperationException(
            $"No loop strategy named '{key}' — check the agent's loopType in agents.json " +
            $"(available: {string.Join(", ", _strategies.Keys)}).");
    }
}
