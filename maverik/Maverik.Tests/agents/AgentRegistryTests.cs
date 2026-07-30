using McpHost.Agents;
using Microsoft.Extensions.Logging.Abstractions;

namespace Maverik.Tests.Agents;

public class AgentRegistryTests
{
    private static AgentConfig MakeAgent(string id, string systemPrompt = "you are a helpful agent") => new()
    {
        Id = id,
        Name = id,
        Model = "some-model",
        SystemPrompt = systemPrompt,
    };

    private static AgentRegistry NewRegistry(string defaultAgent, params AgentConfig[] agents) =>
        new(
            new AgentsFile { DefaultAgent = defaultAgent, Agents = [.. agents] },
            "unused-config-dir",
            NullLogger<AgentRegistry>.Instance);

    [Fact]
    public void Resolve_ReturnsConfiguredAgent_ById()
    {
        var registry = NewRegistry("a1", MakeAgent("a1"), MakeAgent("a2"));

        Assert.Equal("a2", registry.Resolve("a2").Id);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void Resolve_NullOrEmptyId_ReturnsDefaultAgent(string? id)
    {
        var registry = NewRegistry("a1", MakeAgent("a1"), MakeAgent("a2"));

        Assert.Equal("a1", registry.Resolve(id).Id);
    }

    [Fact]
    public void Resolve_UnknownId_Throws()
    {
        var registry = NewRegistry("a1", MakeAgent("a1"));

        Assert.Throws<InvalidOperationException>(() => registry.Resolve("does-not-exist"));
    }

    [Fact]
    public void Reload_SwapsInNewAgentSet()
    {
        var registry = NewRegistry("a1", MakeAgent("a1"));

        registry.Reload(new AgentsFile { DefaultAgent = "b1", Agents = [MakeAgent("b1")] });

        Assert.Equal("b1", registry.DefaultAgent);
        Assert.Throws<InvalidOperationException>(() => registry.Resolve("a1"));
        Assert.Equal("b1", registry.Resolve(null).Id);
    }

    [Fact]
    public void Constructor_MissingSystemPromptAndNoPromptFile_Throws()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "maverik-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        try
        {
            var file = new AgentsFile
            {
                DefaultAgent = "a1",
                Agents = [MakeAgent("a1", systemPrompt: null!)]
            };

            Assert.Throws<InvalidOperationException>(
                () => new AgentRegistry(file, tempDir, NullLogger<AgentRegistry>.Instance));
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }
}
