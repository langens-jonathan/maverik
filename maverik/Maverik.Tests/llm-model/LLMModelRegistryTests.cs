using McpHost.LlmModel;
using Microsoft.Extensions.Logging.Abstractions;

namespace Maverik.Tests.LlmModel;

public class LLMModelRegistryTests
{
    [Fact]
    public void Constructor_ZeroConfigs_ConstructsWithEmptyClientSet()
    {
        var registry = new LLMModelRegistry([], "some-default", NullLogger<LLMModelRegistry>.Instance);

        Assert.Throws<InvalidOperationException>(() => registry.Resolve(null));
    }

    [Fact]
    public void ResolveConfig_NullId_ReturnsNull()
    {
        var registry = new LLMModelRegistry([], "x", NullLogger<LLMModelRegistry>.Instance);

        Assert.Null(registry.ResolveConfig(null));
    }

    [Fact]
    public void ResolveConfig_UnknownId_ReturnsNull()
    {
        var registry = new LLMModelRegistry([], "x", NullLogger<LLMModelRegistry>.Instance);

        Assert.Null(registry.ResolveConfig("does-not-exist"));
    }

    [Fact]
    public void ResolveConfig_KnownId_ReturnsMatchingConfig()
    {
        // Endpoint left null on purpose: client construction fails and is caught internally
        // (see Reload_BadConfig test below), but Configs still records every config regardless
        // of whether its client built successfully.
        var config = new LLMModelConfig { Id = "m1", Provider = "openai-compatible", Endpoint = null };
        var registry = new LLMModelRegistry([config], "m1", NullLogger<LLMModelRegistry>.Instance);

        var resolved = registry.ResolveConfig("m1");

        Assert.NotNull(resolved);
        Assert.Equal("m1", resolved!.Id);
    }

    [Fact]
    public void Resolve_UnknownId_Throws()
    {
        var registry = new LLMModelRegistry([], "x", NullLogger<LLMModelRegistry>.Instance);

        Assert.Throws<InvalidOperationException>(() => registry.Resolve("does-not-exist"));
    }

    [Fact]
    public void Reload_BadConfig_ReportedAsFailure_DoesNotCrashRegistry()
    {
        var registry = new LLMModelRegistry([], "x", NullLogger<LLMModelRegistry>.Instance);
        var badConfig = new LLMModelConfig { Id = "bad-model", Provider = "openai-compatible", Endpoint = null };

        var failures = registry.Reload([badConfig], "x");

        Assert.Single(failures);
        Assert.Equal("bad-model", failures[0].Id);
        // Registry itself is still usable after a partial-failure reload.
        Assert.NotNull(registry.ResolveConfig("bad-model"));
    }
}
