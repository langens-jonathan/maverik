using System.Text.Json;
using McpHost.Agents;
using McpHost.LlmModel;
using McpHost.Maverik;
using McpHost.Mcp;
using Microsoft.Extensions.Logging.Abstractions;

namespace Maverik.Tests.Maverik;

// MaverikSummaryBuilder.Build takes five collaborators, all concrete classes. None of these
// tests call McpServerRegistry.StartAsync (that requires a live MCP connection), so
// McpServerRegistry.ToolsByServer stays empty and every tool-cost lookup resolves to 0 — see
// the plan's "Key testability findings". These tests stick to the token-cost/pass-rate/
// null-handling math that doesn't depend on a live tool catalog.
public class MaverikSummaryBuilderTests
{
    private sealed class Harness : IDisposable
    {
        public required string TempDir { get; init; }
        public required MaverikSuiteRegistry Suites { get; init; }
        public required AgentRegistry Agents { get; init; }
        public required LLMModelRegistry Models { get; init; }
        public required McpServerRegistry Mcp { get; init; }
        public required ToolCostRegistry ToolCosts { get; init; }

        public void Dispose() => Directory.Delete(TempDir, recursive: true);
    }

    private static Harness NewHarness(string suiteId, IReadOnlyList<AgentConfig> agentConfigs, IReadOnlyList<LLMModelConfig> modelConfigs)
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "maverik-tests-" + Guid.NewGuid().ToString("N"));
        var suitesDir = Path.Combine(tempDir, "maverik-suites");
        Directory.CreateDirectory(suitesDir);

        var agents = new AgentRegistry(
            new AgentsFile { DefaultAgent = agentConfigs[0].Id, Agents = [.. agentConfigs] },
            tempDir, NullLogger<AgentRegistry>.Instance);

        var models = new LLMModelRegistry(modelConfigs, modelConfigs.Count > 0 ? modelConfigs[0].Id : "none",
            NullLogger<LLMModelRegistry>.Instance);

        var suite = new MaverikSuite
        {
            Id = suiteId,
            Name = suiteId,
            Agents = [],
            Questions = [new MaverikQuestion { Id = "q1", Text = "text", Criterion = new MaverikCriterion { Type = "exact", Expected = "x" } }]
        };
        File.WriteAllText(Path.Combine(suitesDir, "test-suite.json"), JsonSerializer.Serialize(suite));

        var suites = new MaverikSuiteRegistry(tempDir, agents, models, NullLogger<MaverikSuiteRegistry>.Instance);
        var mcp = new McpServerRegistry([], NullLogger<McpServerRegistry>.Instance);
        var toolCosts = new ToolCostRegistry(new ToolCostsFile());

        return new Harness { TempDir = tempDir, Suites = suites, Agents = agents, Models = models, Mcp = mcp, ToolCosts = toolCosts };
    }

    private static AgentConfig Agent(string id, string model = "unpriced-model") => new()
    {
        Id = id, Name = id, Model = model, SystemPrompt = "prompt", McpServers = []
    };

    private static RunStatus Run(string suiteId, IReadOnlyList<string> agentIds, IReadOnlyList<QuestionRunResult> results) => new(
        RunId: "run-1", SuiteId: suiteId, AgentIds: agentIds, Repetitions: 1, State: "completed",
        TotalCases: results.Count, CompletedCases: results.Count, CreatedAt: DateTimeOffset.UtcNow,
        StartedAt: DateTimeOffset.UtcNow, FinishedAt: DateTimeOffset.UtcNow, Results: results, JudgedMetrics: []);

    [Fact]
    public void Build_ComputesPassRate_ExcludingErroredCases()
    {
        using var h = NewHarness("suite-1", [Agent("agent1")], []);
        var results = new List<QuestionRunResult>
        {
            new() { AgentId = "agent1", QuestionId = "q1", Repetition = 1, Error = "boom" },
            new() { AgentId = "agent1", QuestionId = "q2", Repetition = 1, Passed = true },
            new() { AgentId = "agent1", QuestionId = "q3", Repetition = 1, Passed = false },
        };

        var summary = MaverikSummaryBuilder.Build(Run("suite-1", ["agent1"], results), h.Suites, h.Agents, h.Models, h.Mcp, h.ToolCosts);
        var agent1 = summary.Agents.Single(a => a.AgentId == "agent1");

        Assert.Equal(0.5, agent1.PassRate);
        Assert.Equal(1, agent1.Errors);
    }

    [Fact]
    public void Build_AveragesTokens_OnlyOverCasesWithUsage_NullMeansUnknownNotZero()
    {
        using var h = NewHarness("suite-1", [Agent("agent1")], []);
        var results = new List<QuestionRunResult>
        {
            new() { AgentId = "agent1", QuestionId = "q1", Repetition = 1, InputTokens = 100, OutputTokens = 50, Passed = true },
            new() { AgentId = "agent1", QuestionId = "q2", Repetition = 1, InputTokens = null, OutputTokens = null, Passed = true },
        };

        var summary = MaverikSummaryBuilder.Build(Run("suite-1", ["agent1"], results), h.Suites, h.Agents, h.Models, h.Mcp, h.ToolCosts);
        var agent1 = summary.Agents.Single(a => a.AgentId == "agent1");

        Assert.Equal(100, agent1.AvgInputTokens);
        Assert.Equal(1, agent1.CasesWithoutUsage);
    }

    [Fact]
    public void Build_ComputesEstCost_WhenModelHasPricing()
    {
        var pricedModel = new LLMModelConfig { Id = "priced-model", InputPricePerMTok = 3m, OutputPricePerMTok = 15m };
        using var h = NewHarness("suite-1", [Agent("agent1", "priced-model")], [pricedModel]);
        var results = new List<QuestionRunResult>
        {
            new() { AgentId = "agent1", QuestionId = "q1", Repetition = 1, InputTokens = 1_000_000, OutputTokens = 1_000_000, Passed = true },
        };

        var summary = MaverikSummaryBuilder.Build(Run("suite-1", ["agent1"], results), h.Suites, h.Agents, h.Models, h.Mcp, h.ToolCosts);
        var agent1 = summary.Agents.Single(a => a.AgentId == "agent1");

        Assert.Equal(18m, agent1.EstCostPerQuestion);
        Assert.Equal(18m, agent1.EstCostTotal);
    }

    [Fact]
    public void Build_EstCostIsNull_WhenModelHasNoPricing()
    {
        using var h = NewHarness("suite-1", [Agent("agent1", "unpriced-model")], [new LLMModelConfig { Id = "unpriced-model" }]);
        var results = new List<QuestionRunResult>
        {
            new() { AgentId = "agent1", QuestionId = "q1", Repetition = 1, InputTokens = 100, OutputTokens = 50, Passed = true },
        };

        var summary = MaverikSummaryBuilder.Build(Run("suite-1", ["agent1"], results), h.Suites, h.Agents, h.Models, h.Mcp, h.ToolCosts);
        var agent1 = summary.Agents.Single(a => a.AgentId == "agent1");

        Assert.Null(agent1.EstCostPerQuestion);
        Assert.Null(agent1.EstCostTotal);
    }

    [Fact]
    public void Build_ToolCostIsZero_WhenNoServersConnected()
    {
        using var h = NewHarness("suite-1", [Agent("agent1")], []);
        var results = new List<QuestionRunResult>
        {
            new() { AgentId = "agent1", QuestionId = "q1", Repetition = 1, Passed = true, ToolNames = ["some_tool"] },
        };

        var summary = MaverikSummaryBuilder.Build(Run("suite-1", ["agent1"], results), h.Suites, h.Agents, h.Models, h.Mcp, h.ToolCosts);
        var agent1 = summary.Agents.Single(a => a.AgentId == "agent1");

        Assert.Equal(0m, agent1.EstToolCostPerQuestion);
        Assert.Equal(0m, agent1.EstToolCostTotal);
    }

    [Fact]
    public void Build_EstOverallCostTotal_IsNull_WhenAllCasesErrored()
    {
        using var h = NewHarness("suite-1", [Agent("agent1")], []);
        var results = new List<QuestionRunResult>
        {
            new() { AgentId = "agent1", QuestionId = "q1", Repetition = 1, Error = "boom" },
        };

        var summary = MaverikSummaryBuilder.Build(Run("suite-1", ["agent1"], results), h.Suites, h.Agents, h.Models, h.Mcp, h.ToolCosts);
        var agent1 = summary.Agents.Single(a => a.AgentId == "agent1");

        Assert.Null(agent1.EstOverallCostTotal);
    }

    [Fact]
    public void Build_EstOverallCostTotal_SumsTokenAndToolCost_WhenPresent()
    {
        var pricedModel = new LLMModelConfig { Id = "priced-model", InputPricePerMTok = 3m, OutputPricePerMTok = 15m };
        using var h = NewHarness("suite-1", [Agent("agent1", "priced-model")], [pricedModel]);
        var results = new List<QuestionRunResult>
        {
            new() { AgentId = "agent1", QuestionId = "q1", Repetition = 1, InputTokens = 1_000_000, OutputTokens = 1_000_000, Passed = true },
        };

        var summary = MaverikSummaryBuilder.Build(Run("suite-1", ["agent1"], results), h.Suites, h.Agents, h.Models, h.Mcp, h.ToolCosts);
        var agent1 = summary.Agents.Single(a => a.AgentId == "agent1");

        // Tool cost is 0 (not null) since evaluated.Count > 0 — see the class-level comment.
        Assert.Equal(18m, agent1.EstOverallCostTotal);
    }

    [Fact]
    public void Build_JudgeOverhead_SumsJudgeTokensAcrossAllAgents_SeparateFromAgentMetrics()
    {
        using var h = NewHarness("suite-1", [Agent("agent1"), Agent("agent2")], []);
        var results = new List<QuestionRunResult>
        {
            new() { AgentId = "agent1", QuestionId = "q1", Repetition = 1, Passed = true, JudgeInputTokens = 10, JudgeOutputTokens = 5 },
            new() { AgentId = "agent2", QuestionId = "q1", Repetition = 1, Passed = true, JudgeInputTokens = 20, JudgeOutputTokens = 15 },
        };

        var summary = MaverikSummaryBuilder.Build(Run("suite-1", ["agent1", "agent2"], results), h.Suites, h.Agents, h.Models, h.Mcp, h.ToolCosts);

        Assert.Equal(30, summary.JudgeOverhead.InputTokens);
        Assert.Equal(20, summary.JudgeOverhead.OutputTokens);
        // Judge tokens never leak into an agent's own token averages.
        Assert.Null(summary.Agents.Single(a => a.AgentId == "agent1").AvgInputTokens);
    }

    [Fact]
    public void TokenCost_ComputesPerMillionTokenPricing_Correctly()
    {
        Assert.Equal(18m, MaverikSummaryBuilder.TokenCost(1_000_000, 1_000_000, 3m, 15m));
    }
}
