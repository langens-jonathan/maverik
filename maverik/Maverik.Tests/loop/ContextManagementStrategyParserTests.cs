using McpHost.Loop;

namespace Maverik.Tests.Loop;

public class ContextManagementStrategyParserTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("none")]
    public void Parse_NullEmptyOrNone_ReturnsNone(string? value)
    {
        Assert.Equal(ContextManagementStrategy.None, ContextManagementStrategyParser.Parse(value));
    }

    [Fact]
    public void Parse_Cutoff_ReturnsCutoff()
    {
        Assert.Equal(ContextManagementStrategy.Cutoff, ContextManagementStrategyParser.Parse("cutoff"));
    }

    [Fact]
    public void Parse_Compaction_ReturnsCompaction()
    {
        Assert.Equal(ContextManagementStrategy.Compaction, ContextManagementStrategyParser.Parse("compaction"));
    }

    [Fact]
    public void Parse_UnknownValue_Throws()
    {
        Assert.Throws<ArgumentException>(() => ContextManagementStrategyParser.Parse("summarize"));
    }
}
