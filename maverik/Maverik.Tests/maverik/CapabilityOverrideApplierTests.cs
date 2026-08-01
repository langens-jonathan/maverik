using Anthropic.Models.Messages;
using McpHost.Maverik;
using Microsoft.Extensions.AI;

namespace Maverik.Tests.Maverik;

public class CapabilityOverrideApplierTests
{
    private static AIFunction Tool(string name, string description) =>
        AIFunctionFactory.Create((string s) => s, name, description);

    // Overridden entries become a raw Anthropic.Tool wrapped via AsAITool() — that wrapper's own
    // .Name/.Description properties report the wrapper TYPE's name, not the tool's, by design
    // (it's a wire-only passthrough for the Anthropic client to special-case). The real content
    // is reachable only via GetService(typeof(ToolUnion)) — see AnthropicClientExtensions.AsAITool.
    private static Tool UnwrapOverriddenTool(AITool aiTool)
    {
        var union = Assert.IsType<ToolUnion>(aiTool.GetService(typeof(ToolUnion)));
        Assert.True(union.TryPickTool(out var tool));
        return tool;
    }

    [Fact]
    public void Apply_OverriddenTool_CarriesTheNewDescription_NameAndSchemaUnchanged()
    {
        var original = Tool("search_code", "original description");
        var overrides = new Dictionary<(string, string), string> { [("github", "search_code")] = "overridden description" };

        var result = CapabilityOverrideApplier.Apply([("github", original)], overrides);

        var unwrapped = UnwrapOverriddenTool(result[0]);
        Assert.Equal("search_code", unwrapped.Name);
        Assert.Equal("overridden description", unwrapped.Description);
    }

    [Fact]
    public void Apply_NonOverriddenTool_PassesThroughAsTheSameInstance()
    {
        var original = Tool("search_code", "original description");
        var overrides = new Dictionary<(string, string), string> { [("github", "some_other_tool")] = "irrelevant" };

        var result = CapabilityOverrideApplier.Apply([("github", original)], overrides);

        Assert.Same(original, result[0]);
    }

    [Fact]
    public void Apply_PreservesOrder()
    {
        var a = Tool("a", "desc a");
        var b = Tool("b", "desc b");
        var overrides = new Dictionary<(string, string), string>();

        var result = CapabilityOverrideApplier.Apply([("s", a), ("s", b)], overrides);

        Assert.Same(a, result[0]);
        Assert.Same(b, result[1]);
    }

    [Fact]
    public void Apply_ScopesOverrideByServer_SameToolNameOnDifferentServerUnaffected()
    {
        var original = Tool("search", "desc");
        var overrides = new Dictionary<(string, string), string> { [("other-server", "search")] = "should not apply" };

        var result = CapabilityOverrideApplier.Apply([("github", original)], overrides);

        Assert.Same(original, result[0]);
    }
}
