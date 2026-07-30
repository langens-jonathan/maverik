using McpHost.LlmModel;
using McpHost.Maverik;
using Microsoft.Extensions.Logging.Abstractions;

namespace Maverik.Tests.Maverik;

public class CriterionEvaluatorTests
{
    private static CriterionEvaluator NewEvaluator() =>
        new(new LLMModelRegistry([], "unused", NullLogger<LLMModelRegistry>.Instance));

    private static MaverikQuestion Question(MaverikCriterion criterion) => new()
    {
        Id = "q1",
        Text = "does not matter for these criterion types",
        Criterion = criterion,
    };

    [Fact]
    public async Task EvaluateAsync_Exact_PassesOnTrimmedMatch()
    {
        var evaluator = NewEvaluator();
        var question = Question(new MaverikCriterion { Type = "exact", Expected = "42" });

        var result = await evaluator.EvaluateAsync(question, "  42  ", null, CancellationToken.None);

        Assert.True(result.Passed);
        Assert.Null(result.Detail);
    }

    [Fact]
    public async Task EvaluateAsync_Exact_FailsOnMismatch_WithTruncatedDetail()
    {
        var evaluator = NewEvaluator();
        var question = Question(new MaverikCriterion { Type = "exact", Expected = "42" });

        var result = await evaluator.EvaluateAsync(question, "43", null, CancellationToken.None);

        Assert.False(result.Passed);
        Assert.Contains("42", result.Detail);
        Assert.Contains("43", result.Detail);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task EvaluateAsync_Exact_CaseSensitiveFlag_ChangesComparison(bool caseSensitive, bool expectedPass)
    {
        var evaluator = NewEvaluator();
        var question = Question(new MaverikCriterion { Type = "exact", Expected = "Answer", CaseSensitive = caseSensitive });

        var result = await evaluator.EvaluateAsync(question, "answer", null, CancellationToken.None);

        Assert.Equal(expectedPass, result.Passed);
    }

    [Fact]
    public async Task EvaluateAsync_Contains_PassesWhenSubstringPresent()
    {
        var evaluator = NewEvaluator();
        var question = Question(new MaverikCriterion { Type = "contains", Expected = "world" });

        var result = await evaluator.EvaluateAsync(question, "hello world!", null, CancellationToken.None);

        Assert.True(result.Passed);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public async Task EvaluateAsync_Contains_RespectsCaseSensitivity(bool caseSensitive, bool expectedPass)
    {
        var evaluator = NewEvaluator();
        var question = Question(new MaverikCriterion { Type = "contains", Expected = "World", CaseSensitive = caseSensitive });

        var result = await evaluator.EvaluateAsync(question, "hello world!", null, CancellationToken.None);

        Assert.Equal(expectedPass, result.Passed);
    }

    [Fact]
    public async Task EvaluateAsync_Regex_PassesOnMatch()
    {
        var evaluator = NewEvaluator();
        var question = Question(new MaverikCriterion { Type = "regex", Pattern = @"^\d+$" });

        var result = await evaluator.EvaluateAsync(question, "12345", null, CancellationToken.None);

        Assert.True(result.Passed);
    }

    [Fact]
    public async Task EvaluateAsync_Regex_FailsOnNoMatch()
    {
        var evaluator = NewEvaluator();
        var question = Question(new MaverikCriterion { Type = "regex", Pattern = @"^\d+$" });

        var result = await evaluator.EvaluateAsync(question, "not a number", null, CancellationToken.None);

        Assert.False(result.Passed);
    }

    [Fact]
    public async Task EvaluateAsync_UnknownCriterionType_Throws()
    {
        var evaluator = NewEvaluator();
        var question = Question(new MaverikCriterion { Type = "bogus" });

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => evaluator.EvaluateAsync(question, "anything", null, CancellationToken.None));
    }

    [Fact]
    public void ParseVerdict_ParsesPlainJson()
    {
        var (passed, detail) = CriterionEvaluator.ParseVerdict("""{"verdict": "PASS", "reasoning": "looks right"}""");

        Assert.True(passed);
        Assert.Equal("looks right", detail);
    }

    [Fact]
    public void ParseVerdict_ParsesFencedJson()
    {
        var text = "```json\n{\"verdict\": \"FAIL\", \"reasoning\": \"wrong\"}\n```";

        var (passed, detail) = CriterionEvaluator.ParseVerdict(text);

        Assert.False(passed);
        Assert.Equal("wrong", detail);
    }

    [Fact]
    public void ParseVerdict_ParsesJsonWrappedInProse()
    {
        var text = "Here is my verdict: {\"verdict\": \"PASS\", \"reasoning\": \"ok\"} thanks!";

        var (passed, _) = CriterionEvaluator.ParseVerdict(text);

        Assert.True(passed);
    }

    [Fact]
    public void ParseVerdict_MissingVerdictField_FailsWithDetail()
    {
        var (passed, detail) = CriterionEvaluator.ParseVerdict("""{"reasoning": "no verdict key"}""");

        Assert.False(passed);
        Assert.Contains("no verdict", detail);
    }

    [Fact]
    public void ParseVerdict_UnparseableText_FailsWithTruncatedDetail()
    {
        var (passed, detail) = CriterionEvaluator.ParseVerdict("not json at all");

        Assert.False(passed);
        Assert.Contains("unparseable", detail);
    }

    [Fact]
    public void Truncate_LeavesShortStringsUnchanged()
    {
        Assert.Equal("short", CriterionEvaluator.Truncate("short"));
    }

    [Fact]
    public void Truncate_CutsLongStringsAt300CharsWithEllipsis()
    {
        var longString = new string('a', 350);

        var result = CriterionEvaluator.Truncate(longString);

        Assert.Equal(new string('a', 300) + "...", result);
    }
}
