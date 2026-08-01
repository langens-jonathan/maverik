using McpHost.Config;
using McpHost.Maverik;
using Microsoft.Extensions.Logging.Abstractions;

namespace Maverik.Tests.Maverik;

public class MaverikResultsWriterTests
{
    private static QuestionRunResult Result(string? error = null) => new()
    {
        AgentId = "agent1", QuestionId = "q1", Repetition = 1, Error = error,
    };

    [Fact]
    public void ToCsv_EscapesFieldsContainingComma()
    {
        var csv = MaverikResultsWriter.ToCsv([Result(error: "comma, in error")]);

        Assert.Contains("\"comma, in error\"", csv);
    }

    [Fact]
    public void ToCsv_EscapesFieldsContainingQuote_DoublesEmbeddedQuotes()
    {
        var csv = MaverikResultsWriter.ToCsv([Result(error: "has \"quotes\"")]);

        Assert.Contains("\"has \"\"quotes\"\"\"", csv);
    }

    [Fact]
    public void ToCsv_LeavesPlainFieldsUnquoted()
    {
        var csv = MaverikResultsWriter.ToCsv([Result()]);
        var dataLine = csv.Split('\n')[1];

        Assert.DoesNotContain('"', dataLine);
    }

    [Theory]
    [InlineData("hello world!", "hello_world_")]
    [InlineData("abc-XYZ_123", "abc-XYZ_123")]
    public void Sanitize_ReplacesNonAlphanumericWithUnderscore_PreservesDashAndUnderscore(string input, string expected)
    {
        Assert.Equal(expected, MaverikResultsWriter.Sanitize(input));
    }

    private static AgentSummary MinimalAgentSummary(string agentId) => new(
        AgentId: agentId, Version: null, PassRate: 1.0, AvgDurationMs: 100, AvgInputTokens: 10, AvgOutputTokens: 5,
        AvgIterations: 1, AvgToolCalls: 0, AvgPeakContextTokens: null, MaxPeakContextTokens: null,
        AvgCacheReadInputTokens: null, AvgCacheCreationInputTokens: null,
        EstCostPerQuestion: null, EstCostTotal: null, EstToolCostPerQuestion: null, EstToolCostTotal: null,
        EstOverallCostTotal: null, Errors: 0, CasesWithoutUsage: 0, CapabilityDigest: null, CapabilityToolCount: null);

    private static RunStatus MinimalRun(string runId) => new(
        RunId: runId, SuiteId: "suite-1", AgentSelections: [new AgentSelection("agent1", null)], Repetitions: 1, State: "completed",
        TotalCases: 1, CompletedCases: 1, CreatedAt: DateTimeOffset.UtcNow, StartedAt: DateTimeOffset.UtcNow,
        FinishedAt: DateTimeOffset.UtcNow, Results: [Result()], JudgedMetrics: []);

    private static RunSummary MinimalSummary(string runId) =>
        new(runId, [MinimalAgentSummary("agent1")], new JudgeOverheadSummary(0, 0, null));

    [Fact]
    public async Task WriteAsync_WritesRunJsonSummaryJsonAndCsv_ToRunIdFolder()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "maverik-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var writer = new MaverikResultsWriter(tempDir, new ConfigFileService(tempDir), NullLogger<MaverikResultsWriter>.Instance);
            var run = MinimalRun("run-1");

            await writer.WriteAsync(run, MinimalSummary("run-1"), CancellationToken.None);

            var dir = Path.Combine(tempDir, "results", "run-1");
            Assert.True(File.Exists(Path.Combine(dir, "run.json")));
            Assert.True(File.Exists(Path.Combine(dir, "summary.json")));
            Assert.True(File.Exists(Path.Combine(dir, "summary.csv")));
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }

    [Fact]
    public async Task LoadAll_SkipsSuiteRunsFolder_AndUnreadableRunJson()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "maverik-tests-" + Guid.NewGuid().ToString("N"));
        try
        {
            var writer = new MaverikResultsWriter(tempDir, new ConfigFileService(tempDir), NullLogger<MaverikResultsWriter>.Instance);
            await writer.WriteAsync(MinimalRun("good-run"), MinimalSummary("good-run"), CancellationToken.None);

            var suiteRunsDir = Path.Combine(tempDir, "results", "suite-runs");
            Directory.CreateDirectory(suiteRunsDir);
            File.WriteAllText(Path.Combine(suiteRunsDir, "irrelevant.json"), "{}");

            var badRunDir = Path.Combine(tempDir, "results", "bad-run");
            Directory.CreateDirectory(badRunDir);
            File.WriteAllText(Path.Combine(badRunDir, "run.json"), "{ not valid json");

            var runs = writer.LoadAll();

            Assert.Single(runs);
            Assert.Equal("good-run", runs[0].RunId);
        }
        finally
        {
            Directory.Delete(tempDir, recursive: true);
        }
    }
}
