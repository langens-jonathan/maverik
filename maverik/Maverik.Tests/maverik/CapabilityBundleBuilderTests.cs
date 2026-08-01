using McpHost.Maverik;
using Microsoft.Extensions.AI;

namespace Maverik.Tests.Maverik;

public class CapabilityBundleBuilderTests
{
    private static readonly IReadOnlyDictionary<(string, string), string> NoOverrides =
        new Dictionary<(string, string), string>();

    private static AIFunction Tool(string name, string description) =>
        AIFunctionFactory.Create((string s) => s, name, description);

    private static IReadOnlyList<(string Server, AIFunction Tool)> Tools(params (string Server, string Name, string Description)[] specs) =>
        specs.Select(s => (s.Server, Tool(s.Name, s.Description))).ToList();

    [Fact]
    public void Build_ReflectsEntriesAndToolCount_ExactlyFromInput()
    {
        var bundle = CapabilityBundleBuilder.Build(
            "agent1", Tools(("github", "search_code", "search code"), ("github", "get_repo", "get a repo")), NoOverrides);

        Assert.Equal("agent1", bundle.AgentId);
        Assert.Equal(2, bundle.ToolCount);
        Assert.Equal(["search_code", "get_repo"], bundle.Entries.Select(e => e.Tool));
        Assert.Equal("search code", bundle.Entries[0].Description);
    }

    [Fact]
    public void Build_OverrideWinsOverToolsOwnDescription()
    {
        var overrides = new Dictionary<(string, string), string> { [("github", "search_code")] = "overridden description" };

        var bundle = CapabilityBundleBuilder.Build(
            "agent1", Tools(("github", "search_code", "original description")), overrides);

        Assert.Equal("overridden description", bundle.Entries[0].Description);
    }

    [Fact]
    public void Digest_IsStableAndReproducible_ForIdenticalInput()
    {
        var tools = Tools(("github", "search_code", "search code"), ("deepwiki", "ask", "ask a question"));

        var digest1 = CapabilityBundleBuilder.Build("agent1", tools, NoOverrides).Digest;
        var digest2 = CapabilityBundleBuilder.Build("agent1", Tools(("github", "search_code", "search code"), ("deepwiki", "ask", "ask a question")), NoOverrides).Digest;

        Assert.Equal(digest1, digest2);
        Assert.StartsWith("sha256:", digest1);
    }

    [Fact]
    public void Digest_ChangesOnReorder_EvenWithIdenticalToolSet()
    {
        var baseline = CapabilityBundleBuilder.Build(
            "agent1", Tools(("github", "search_code", "d1"), ("deepwiki", "ask", "d2")), NoOverrides);
        var reordered = CapabilityBundleBuilder.Build(
            "agent1", Tools(("deepwiki", "ask", "d2"), ("github", "search_code", "d1")), NoOverrides);

        Assert.NotEqual(baseline.Digest, reordered.Digest);
        Assert.Equal(baseline.ToolCount, reordered.ToolCount);
    }

    [Fact]
    public void Digest_ChangesOnDescriptionChange()
    {
        var baseline = CapabilityBundleBuilder.Build("agent1", Tools(("github", "search_code", "original")), NoOverrides);
        var changed = CapabilityBundleBuilder.Build(
            "agent1", Tools(("github", "search_code", "original")),
            new Dictionary<(string, string), string> { [("github", "search_code")] = "changed" });

        Assert.NotEqual(baseline.Digest, changed.Digest);
    }

    [Fact]
    public void CanonicalSchemaJson_SortsObjectKeys_SoKeyOrderDoesNotAffectTheResult()
    {
        var schemaA = System.Text.Json.JsonDocument.Parse("""{"b":1,"a":2}""").RootElement;
        var schemaB = System.Text.Json.JsonDocument.Parse("""{"a":2,"b":1}""").RootElement;

        Assert.Equal(CapabilityBundleBuilder.CanonicalSchemaJson(schemaA), CapabilityBundleBuilder.CanonicalSchemaJson(schemaB));
    }
}
