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

    [Fact]
    public void CacheAwareTokenCost_DoesNotDoubleCountCacheReadTokens()
    {
        // 1M total input tokens, 400K of which were served from cache. The non-cached remainder
        // (600K) prices at the full input rate; the cached 600K... wait, 400K prices at the
        // read rate (0.1x); the other 600K at the full input rate. Output: 200K at $15/M.
        var cost = MaverikSummaryBuilder.CacheAwareTokenCost(
            inputTokens: 1_000_000, outputTokens: 200_000, cacheReadTokens: 400_000, cacheCreationTokens: 0,
            inputPricePerMTok: 3m, outputPricePerMTok: 15m, cacheReadMultiplier: 0.1m, cacheCreationMultiplier: 1.25m);

        var expected = 600_000 / 1_000_000m * 3m       // non-cached input
                     + 200_000 / 1_000_000m * 15m       // output
                     + 400_000 / 1_000_000m * 3m * 0.1m; // cached input at the read discount
        Assert.Equal(expected, cost);
    }

    [Fact]
    public void CacheAwareTokenCost_AddsCacheCreationTokensAtThePremiumOnTop()
    {
        var cost = MaverikSummaryBuilder.CacheAwareTokenCost(
            inputTokens: 100, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 1_000_000,
            inputPricePerMTok: 3m, outputPricePerMTok: 15m, cacheReadMultiplier: 0.1m, cacheCreationMultiplier: 1.25m);

        var expected = 100 / 1_000_000m * 3m + 1_000_000 / 1_000_000m * 3m * 1.25m;
        Assert.Equal(expected, cost);
    }

    [Fact]
    public void Build_UsesCacheAwareCost_WhenModelHasCacheMultipliersAndCaseHasCacheTokens()
    {
        var pricedModel = new LLMModelConfig
        {
            Id = "priced-model", InputPricePerMTok = 3m, OutputPricePerMTok = 15m,
            CacheReadMultiplier = 0.1m, CacheWriteMultiplier = 1.25m,
        };
        using var h = NewHarness("suite-1", [Agent("agent1", "priced-model")], [pricedModel]);
        var results = new List<QuestionRunResult>
        {
            new()
            {
                AgentId = "agent1", QuestionId = "q1", Repetition = 1, Passed = true,
                InputTokens = 1_000_000, OutputTokens = 0, CacheReadInputTokens = 1_000_000,
            },
        };

        var summary = MaverikSummaryBuilder.Build(Run("suite-1", ["agent1"], results), h.Suites, h.Agents, h.Models, h.Mcp, h.ToolCosts);
        var agent1 = summary.Agents.Single(a => a.AgentId == "agent1");

        // Fully cache-read: 1M tokens at $3/M * 0.1 = $0.30, NOT the plain $3 a non-cache-aware
        // TokenCost would compute — proves the cache-aware path is actually being used.
        Assert.Equal(0.3m, agent1.EstCostTotal);
    }

    [Fact]
    public void Build_FallsBackToPlainTokenCost_WhenModelHasNoCacheMultipliers()
    {
        var pricedModel = new LLMModelConfig { Id = "priced-model", InputPricePerMTok = 3m, OutputPricePerMTok = 15m };
        using var h = NewHarness("suite-1", [Agent("agent1", "priced-model")], [pricedModel]);
        var results = new List<QuestionRunResult>
        {
            new()
            {
                AgentId = "agent1", QuestionId = "q1", Repetition = 1, Passed = true,
                InputTokens = 1_000_000, OutputTokens = 0, CacheReadInputTokens = 1_000_000,
            },
        };

        var summary = MaverikSummaryBuilder.Build(Run("suite-1", ["agent1"], results), h.Suites, h.Agents, h.Models, h.Mcp, h.ToolCosts);
        var agent1 = summary.Agents.Single(a => a.AgentId == "agent1");

        // No cache pricing configured on the model — falls back to the plain, cache-unaware rate.
        Assert.Equal(3m, agent1.EstCostTotal);
    }

    [Fact]
    public void Build_CacheTokenAverages_OnlyOverCasesThatHaveThem()
    {
        using var h = NewHarness("suite-1", [Agent("agent1")], []);
        var results = new List<QuestionRunResult>
        {
            new() { AgentId = "agent1", QuestionId = "q1", Repetition = 1, Passed = true, CacheReadInputTokens = 200, CacheCreationInputTokens = null },
            new() { AgentId = "agent1", QuestionId = "q2", Repetition = 1, Passed = true, CacheReadInputTokens = null, CacheCreationInputTokens = null },
        };

        var summary = MaverikSummaryBuilder.Build(Run("suite-1", ["agent1"], results), h.Suites, h.Agents, h.Models, h.Mcp, h.ToolCosts);
        var agent1 = summary.Agents.Single(a => a.AgentId == "agent1");

        Assert.Equal(200, agent1.AvgCacheReadInputTokens);
        Assert.Null(agent1.AvgCacheCreationInputTokens);
    }

    [Fact]
    public void Build_CapabilityFields_AreNull_WhenNoBundleCaptured()
    {
        using var h = NewHarness("suite-1", [Agent("agent1")], []);
        var results = new List<QuestionRunResult> { new() { AgentId = "agent1", QuestionId = "q1", Repetition = 1, Passed = true } };

        var summary = MaverikSummaryBuilder.Build(Run("suite-1", ["agent1"], results), h.Suites, h.Agents, h.Models, h.Mcp, h.ToolCosts);
        var agent1 = summary.Agents.Single(a => a.AgentId == "agent1");

        Assert.Null(agent1.CapabilityDigest);
        Assert.Null(agent1.CapabilityToolCount);
    }

    [Fact]
    public void Build_CapabilityFields_ReflectRunsCapabilityBundles_WhenPresent()
    {
        using var h = NewHarness("suite-1", [Agent("agent1")], []);
        var results = new List<QuestionRunResult> { new() { AgentId = "agent1", QuestionId = "q1", Repetition = 1, Passed = true } };
        var bundle = new CapabilityBundle("agent1", [], "sha256:abc123", 3);
        var run = Run("suite-1", ["agent1"], results) with { CapabilityBundles = new Dictionary<string, CapabilityBundle> { ["agent1"] = bundle } };

        var summary = MaverikSummaryBuilder.Build(run, h.Suites, h.Agents, h.Models, h.Mcp, h.ToolCosts);
        var agent1 = summary.Agents.Single(a => a.AgentId == "agent1");

        Assert.Equal("sha256:abc123", agent1.CapabilityDigest);
        Assert.Equal(3, agent1.CapabilityToolCount);
    }
}
