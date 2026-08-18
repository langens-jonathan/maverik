using McpHost.Guardrails;
using Microsoft.Extensions.AI;

namespace Maverik.Tests.Guardrails;

public class GuardrailEnforcerTests
{
    private static readonly IReadOnlyDictionary<string, IChatClient> NoClassifiers = new Dictionary<string, IChatClient>();

    private static GuardrailRule PatternRule(string id, string pattern, string action = "block") => new()
    {
        Id = id,
        Type = "pattern",
        Pattern = pattern,
        Action = action,
    };

    [Fact]
    public async Task CheckInputAsync_NoRuleMatches_ReturnsNoFindingsAndNoRefusal()
    {
        var policy = new GuardrailPolicy { Id = "p1", InputRules = [PatternRule("r1", @"\d{3}-\d{2}-\d{4}")] };

        var (findings, refusal) = await GuardrailEnforcer.CheckInputAsync([policy], "hello, how are you?", NoClassifiers, CancellationToken.None);

        Assert.Empty(findings);
        Assert.Null(refusal);
    }

    [Fact]
    public async Task CheckInputAsync_BlockRuleMatches_ReturnsFindingAndRefusal()
    {
        var policy = new GuardrailPolicy
        {
            Id = "p1",
            InputRules = [new GuardrailRule { Id = "r1", Type = "pattern", Pattern = @"\d{3}-\d{2}-\d{4}", Action = "block", RefusalMessage = "no SSNs" }],
        };

        var (findings, refusal) = await GuardrailEnforcer.CheckInputAsync([policy], "my ssn is 123-45-6789", NoClassifiers, CancellationToken.None);

        var finding = Assert.Single(findings);
        Assert.Equal("input", finding.Stage);
        Assert.Equal("p1", finding.PolicyId);
        Assert.Equal("r1", finding.RuleId);
        Assert.Equal("block", finding.Action);
        Assert.Equal("no SSNs", refusal);
    }

    [Fact]
    public async Task CheckInputAsync_BlockRuleWithNoRefusalMessage_UsesGenericDefault()
    {
        var policy = new GuardrailPolicy { Id = "p1", InputRules = [PatternRule("r1", "jailbreak")] };

        var (_, refusal) = await GuardrailEnforcer.CheckInputAsync([policy], "this is a jailbreak attempt", NoClassifiers, CancellationToken.None);

        Assert.Equal("I can't help with that.", refusal);
    }

    [Fact]
    public async Task CheckInputAsync_FlagRuleMatches_RecordsFindingButNoRefusal()
    {
        var policy = new GuardrailPolicy { Id = "p1", InputRules = [PatternRule("r1", "spam", action: "flag")] };

        var (findings, refusal) = await GuardrailEnforcer.CheckInputAsync([policy], "this is spam", NoClassifiers, CancellationToken.None);

        var finding = Assert.Single(findings);
        Assert.Equal("flag", finding.Action);
        Assert.Null(refusal);
    }

    [Fact]
    public async Task CheckInputAsync_BlockShortCircuits_LaterRulesNeverEvaluated()
    {
        // Both rules would match; only the first (blocking) finding should be recorded, proving
        // the scan stops the instant a block fires rather than continuing to the second policy.
        var blocking = new GuardrailPolicy { Id = "p1", InputRules = [PatternRule("r1", "bad")] };
        var alsoMatches = new GuardrailPolicy { Id = "p2", InputRules = [PatternRule("r2", "bad", action: "flag")] };

        var (findings, refusal) = await GuardrailEnforcer.CheckInputAsync([blocking, alsoMatches], "this is bad", NoClassifiers, CancellationToken.None);

        var finding = Assert.Single(findings);
        Assert.Equal("p1", finding.PolicyId);
        Assert.NotNull(refusal);
    }

    [Fact]
    public async Task CheckInputAsync_MultipleFlagsAccumulate_ThenBlockStops()
    {
        var policy = new GuardrailPolicy
        {
            Id = "p1",
            InputRules =
            [
                PatternRule("flag1", "foo", action: "flag"),
                PatternRule("flag2", "bar", action: "flag"),
                PatternRule("block1", "baz"),
                PatternRule("flag3", "qux", action: "flag"), // would also match, but never reached
            ],
        };

        var (findings, refusal) = await GuardrailEnforcer.CheckInputAsync([policy], "foo bar baz qux", NoClassifiers, CancellationToken.None);

        Assert.Equal(3, findings.Count);
        Assert.Equal(["flag1", "flag2", "block1"], findings.Select(f => f.RuleId));
        Assert.NotNull(refusal);
    }

    [Fact]
    public async Task CheckOutputAsync_UsesOutputRulesNotInputRules()
    {
        var policy = new GuardrailPolicy
        {
            Id = "p1",
            InputRules = [PatternRule("in", "should-not-fire-on-output")],
            OutputRules = [PatternRule("out", @"[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}", action: "flag")],
        };

        var (findings, refusal) = await GuardrailEnforcer.CheckOutputAsync([policy], "contact me at a@b.com", NoClassifiers, CancellationToken.None);

        var finding = Assert.Single(findings);
        Assert.Equal("output", finding.Stage);
        Assert.Equal("out", finding.RuleId);
        Assert.Null(refusal);
    }

    [Fact]
    public void TryGetDenyingPolicy_ToolInDeniedList_ReturnsTrueAndPolicyId()
    {
        var policy = new GuardrailPolicy { Id = "p1", DeniedTools = ["get_file_contents"] };

        var found = GuardrailEnforcer.TryGetDenyingPolicy([policy], "get_file_contents", out var policyId);

        Assert.True(found);
        Assert.Equal("p1", policyId);
    }

    [Fact]
    public void TryGetDenyingPolicy_ToolNotDenied_ReturnsFalse()
    {
        var policy = new GuardrailPolicy { Id = "p1", DeniedTools = ["get_file_contents"] };

        var found = GuardrailEnforcer.TryGetDenyingPolicy([policy], "search_code", out var policyId);

        Assert.False(found);
        Assert.Null(policyId);
    }

    [Theory]
    [InlineData("""{"match": true, "reasoning": "looks like a jailbreak"}""", true, "looks like a jailbreak")]
    [InlineData("""{"match": false}""", false, null)]
    public void ParseClassifierReply_ParsesPlainJson(string text, bool expectedMatch, string? expectedDetail)
    {
        var (matched, detail) = GuardrailEnforcer.ParseClassifierReply(text);

        Assert.Equal(expectedMatch, matched);
        Assert.Equal(expectedDetail, detail);
    }

    [Fact]
    public void ParseClassifierReply_ParsesFencedJson()
    {
        var text = "```json\n{\"match\": true, \"reasoning\": \"contains PII\"}\n```";

        var (matched, detail) = GuardrailEnforcer.ParseClassifierReply(text);

        Assert.True(matched);
        Assert.Equal("contains PII", detail);
    }

    [Fact]
    public void ParseClassifierReply_ParsesJsonWrappedInProse()
    {
        var text = "Sure: {\"match\": false} there you go!";

        var (matched, _) = GuardrailEnforcer.ParseClassifierReply(text);

        Assert.False(matched);
    }

    [Fact]
    public void ParseClassifierReply_MissingMatchField_FailsOpen()
    {
        var (matched, detail) = GuardrailEnforcer.ParseClassifierReply("""{"reasoning": "no match key"}""");

        Assert.False(matched);
        Assert.Null(detail);
    }

    [Fact]
    public void ParseClassifierReply_UnparseableText_FailsOpen()
    {
        var (matched, detail) = GuardrailEnforcer.ParseClassifierReply("not json at all");

        Assert.False(matched);
        Assert.Null(detail);
    }

    [Fact]
    public void ParseClassifierReply_MatchTrueWithNoReasoning_UsesGenericDetail()
    {
        var (matched, detail) = GuardrailEnforcer.ParseClassifierReply("""{"match": true}""");

        Assert.True(matched);
        Assert.Equal("classifier matched", detail);
    }
}
