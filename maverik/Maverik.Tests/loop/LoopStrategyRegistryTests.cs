using McpHost.Loop;

namespace Maverik.Tests.Loop;

public class LoopStrategyRegistryTests
{
    [Theory]
    [InlineData("manual", "manual")]
    [InlineData("parallel-tools", "parallel-tools")]
    public void Resolve_KnownName_ReturnsMatchingStrategy(string loopType, string expectedName)
    {
        var registry = new LoopStrategyRegistry();

        Assert.Equal(expectedName, registry.Resolve(loopType).Name);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void Resolve_NullOrEmpty_DefaultsToManual(string? loopType)
    {
        var registry = new LoopStrategyRegistry();

        Assert.Equal("manual", registry.Resolve(loopType).Name);
    }

    [Fact]
    public void Resolve_IsCaseInsensitive()
    {
        var registry = new LoopStrategyRegistry();

        Assert.Equal("parallel-tools", registry.Resolve("PARALLEL-TOOLS").Name);
    }

    [Fact]
    public void Resolve_UnknownName_Throws()
    {
        var registry = new LoopStrategyRegistry();

        Assert.Throws<InvalidOperationException>(() => registry.Resolve("does-not-exist"));
    }
}
