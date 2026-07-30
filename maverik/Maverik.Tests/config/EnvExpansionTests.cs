using McpHost.Config;

namespace Maverik.Tests.Config;

public class EnvExpansionTests
{
    [Fact]
    public void Expand_SubstitutesSetEnvironmentVariable()
    {
        var varName = "MAVERIK_TEST_" + Guid.NewGuid().ToString("N");
        Environment.SetEnvironmentVariable(varName, "hello");
        try
        {
            Assert.Equal("hello", EnvExpansion.Expand($"${{{varName}}}"));
        }
        finally
        {
            Environment.SetEnvironmentVariable(varName, null);
        }
    }

    [Fact]
    public void Expand_ThrowsWhenVariableNotSet()
    {
        var varName = "MAVERIK_TEST_MISSING_" + Guid.NewGuid().ToString("N");
        Assert.Throws<InvalidOperationException>(() => EnvExpansion.Expand($"${{{varName}}}"));
    }

    [Fact]
    public void Expand_LeavesNonPlaceholderTextUnchanged()
    {
        Assert.Equal("plain text, no placeholders here", EnvExpansion.Expand("plain text, no placeholders here"));
    }

    [Fact]
    public void Expand_SubstitutesMultiplePlaceholdersInOneString()
    {
        var varA = "MAVERIK_TEST_A_" + Guid.NewGuid().ToString("N");
        var varB = "MAVERIK_TEST_B_" + Guid.NewGuid().ToString("N");
        Environment.SetEnvironmentVariable(varA, "foo");
        Environment.SetEnvironmentVariable(varB, "bar");
        try
        {
            Assert.Equal("foo-bar", EnvExpansion.Expand($"${{{varA}}}-${{{varB}}}"));
        }
        finally
        {
            Environment.SetEnvironmentVariable(varA, null);
            Environment.SetEnvironmentVariable(varB, null);
        }
    }

    [Fact]
    public void ExpandNullable_ReturnsNullForNullInput()
    {
        Assert.Null(EnvExpansion.ExpandNullable(null));
    }

    [Fact]
    public void ExpandNullable_DelegatesToExpandForNonNull()
    {
        var varName = "MAVERIK_TEST_" + Guid.NewGuid().ToString("N");
        Environment.SetEnvironmentVariable(varName, "value");
        try
        {
            Assert.Equal("value", EnvExpansion.ExpandNullable($"${{{varName}}}"));
        }
        finally
        {
            Environment.SetEnvironmentVariable(varName, null);
        }
    }
}
