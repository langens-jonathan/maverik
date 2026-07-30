using McpHost.Maverik;

namespace Maverik.Tests.Maverik;

public class ToolCostRegistryTests
{
    private static ToolCostRegistry NewRegistry(params ToolCostConfig[] costs) =>
        new(new ToolCostsFile { ToolCosts = [.. costs] });

    [Fact]
    public void CostOf_ReturnsConfiguredCost_ForKnownServerToolPair()
    {
        var registry = NewRegistry(new ToolCostConfig { McpServer = "github", Tool = "search_code", CostPerInvocation = 0.5m });

        Assert.Equal(0.5m, registry.CostOf("github", "search_code"));
    }

    [Fact]
    public void CostOf_ReturnsZero_ForUnconfiguredPair()
    {
        var registry = NewRegistry();

        Assert.Equal(0m, registry.CostOf("github", "search_code"));
    }

    [Fact]
    public void CostOf_IsScopedByServer()
    {
        var registry = NewRegistry(new ToolCostConfig { McpServer = "github", Tool = "search_code", CostPerInvocation = 0.5m });

        Assert.Equal(0m, registry.CostOf("other-server", "search_code"));
    }

    [Fact]
    public void Reload_ReplacesCosts_OldEntriesGone()
    {
        var registry = NewRegistry(new ToolCostConfig { McpServer = "github", Tool = "search_code", CostPerInvocation = 0.5m });

        registry.Reload(new ToolCostsFile
        {
            ToolCosts = [new ToolCostConfig { McpServer = "jira", Tool = "create_issue", CostPerInvocation = 1m }]
        });

        Assert.Equal(0m, registry.CostOf("github", "search_code"));
        Assert.Equal(1m, registry.CostOf("jira", "create_issue"));
    }
}
