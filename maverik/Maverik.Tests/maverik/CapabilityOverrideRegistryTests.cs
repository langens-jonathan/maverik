using McpHost.Maverik;

namespace Maverik.Tests.Maverik;

public class CapabilityOverrideRegistryTests
{
    private static CapabilityOverrideRegistry NewRegistry(params CapabilityOverride[] overrides) =>
        new(new CapabilityOverridesFile { Overrides = [.. overrides] });

    [Fact]
    public void OverridesFor_ReturnsConfiguredOverride_ScopedToAgent()
    {
        var registry = NewRegistry(new CapabilityOverride
        {
            AgentId = "agent1", McpServer = "github", Tool = "search_code", Description = "new desc"
        });

        var result = registry.OverridesFor("agent1");

        Assert.Equal("new desc", result[("github", "search_code")]);
    }

    [Fact]
    public void OverridesFor_ReturnsEmpty_ForUnconfiguredAgent()
    {
        var registry = NewRegistry(new CapabilityOverride
        {
            AgentId = "agent1", McpServer = "github", Tool = "search_code", Description = "new desc"
        });

        Assert.Empty(registry.OverridesFor("agent2"));
    }

    [Fact]
    public void OverridesFor_DoesNotLeakOtherAgentsOverrides()
    {
        var registry = NewRegistry(
            new CapabilityOverride { AgentId = "agent1", McpServer = "github", Tool = "t1", Description = "d1" },
            new CapabilityOverride { AgentId = "agent2", McpServer = "github", Tool = "t2", Description = "d2" });

        var result = registry.OverridesFor("agent1");

        Assert.Single(result);
        Assert.True(result.ContainsKey(("github", "t1")));
    }

    [Fact]
    public void Reload_ReplacesOverrides_OldEntriesGone()
    {
        var registry = NewRegistry(new CapabilityOverride
        {
            AgentId = "agent1", McpServer = "github", Tool = "search_code", Description = "old desc"
        });

        registry.Reload(new CapabilityOverridesFile
        {
            Overrides = [new CapabilityOverride { AgentId = "agent1", McpServer = "jira", Tool = "create_issue", Description = "new desc" }]
        });

        var result = registry.OverridesFor("agent1");
        Assert.False(result.ContainsKey(("github", "search_code")));
        Assert.Equal("new desc", result[("jira", "create_issue")]);
    }
}
