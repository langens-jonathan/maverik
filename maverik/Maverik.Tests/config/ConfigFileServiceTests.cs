using McpHost.Agents;
using McpHost.Config;
using McpHost.Maverik;

namespace Maverik.Tests.Config;

public class ConfigFileServiceTests : IDisposable
{
    private readonly string _tempDir = Path.Combine(Path.GetTempPath(), "maverik-tests-" + Guid.NewGuid().ToString("N"));

    public ConfigFileServiceTests() => Directory.CreateDirectory(_tempDir);

    public void Dispose() => Directory.Delete(_tempDir, recursive: true);

    private const string ExampleAgentsJson =
        """{"defaultAgent":"a1","agents":[{"id":"a1","name":"A1","model":"m1","systemPrompt":"p"}]}""";

    [Fact]
    public void LoadAgents_BootstrapsFromExampleFile_WhenRealFileMissing()
    {
        File.WriteAllText(Path.Combine(_tempDir, "agents.example.json"), ExampleAgentsJson);
        var service = new ConfigFileService(_tempDir);

        var (data, bootstrapped) = service.LoadAgents();

        Assert.True(bootstrapped);
        Assert.Equal("a1", data.DefaultAgent);
        Assert.True(File.Exists(Path.Combine(_tempDir, "agents.json")));
    }

    [Fact]
    public void LoadAgents_ReturnsBootstrappedFalse_WhenRealFileAlreadyExists()
    {
        File.WriteAllText(Path.Combine(_tempDir, "agents.json"), ExampleAgentsJson);
        var service = new ConfigFileService(_tempDir);

        var (_, bootstrapped) = service.LoadAgents();

        Assert.False(bootstrapped);
    }

    [Fact]
    public void Load_ThrowsClearError_WhenNeitherRealNorExampleFileExists()
    {
        var service = new ConfigFileService(_tempDir);

        Assert.Throws<InvalidOperationException>(() => service.LoadAgents());
    }

    [Fact]
    public void SaveAgents_ThenLoadAgents_RoundTrips()
    {
        var service = new ConfigFileService(_tempDir);
        var data = new AgentsFile
        {
            DefaultAgent = "a1",
            Agents = [new AgentConfig { Id = "a1", Name = "A1", Model = "m1", SystemPrompt = "p" }]
        };

        service.SaveAgents(data);
        var (loaded, bootstrapped) = service.LoadAgents();

        Assert.False(bootstrapped);
        Assert.Equal("a1", loaded.DefaultAgent);
        Assert.Single(loaded.Agents);
        Assert.Equal("a1", loaded.Agents[0].Id);
    }

    [Fact]
    public void SaveCapabilityOverrides_ThenLoadCapabilityOverrides_RoundTrips()
    {
        var service = new ConfigFileService(_tempDir);
        var data = new CapabilityOverridesFile
        {
            Overrides = [new CapabilityOverride { AgentId = "a1", McpServer = "github", Tool = "search_code", Description = "d" }]
        };

        service.SaveCapabilityOverrides(data);
        var (loaded, bootstrapped) = service.LoadCapabilityOverrides();

        Assert.False(bootstrapped);
        Assert.Single(loaded.Overrides);
        Assert.Equal("search_code", loaded.Overrides[0].Tool);
    }

    [Fact]
    public void LoadCapabilityOverrides_BootstrapsFromExampleFile_WhenRealFileMissing()
    {
        File.WriteAllText(Path.Combine(_tempDir, "capability-overrides.example.json"), """{"overrides":[]}""");
        var service = new ConfigFileService(_tempDir);

        var (data, bootstrapped) = service.LoadCapabilityOverrides();

        Assert.True(bootstrapped);
        Assert.Empty(data.Overrides);
        Assert.True(File.Exists(Path.Combine(_tempDir, "capability-overrides.json")));
    }

    [Fact]
    public void SaveSuite_ThenSuiteExists_ThenDeleteSuite_RemovesFile()
    {
        var service = new ConfigFileService(_tempDir);
        var suite = new MaverikSuite
        {
            Id = "suite-1",
            Name = "Suite 1",
            Questions = [new MaverikQuestion { Id = "q1", Text = "text", Criterion = new MaverikCriterion { Type = "exact", Expected = "x" } }]
        };

        Assert.False(service.SuiteExists("suite-1"));

        service.SaveSuite("suite-1", suite);
        Assert.True(service.SuiteExists("suite-1"));

        service.DeleteSuite("suite-1");
        Assert.False(service.SuiteExists("suite-1"));
    }
}
