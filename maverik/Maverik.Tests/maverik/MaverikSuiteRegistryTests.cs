using McpHost.Agents;
using McpHost.LlmModel;
using McpHost.Maverik;
using Microsoft.Extensions.Logging.Abstractions;

namespace Maverik.Tests.Maverik;

// Exercises MaverikSuiteRegistry.Validate directly (internal, not through the filesystem-backed
// registry constructor) — same lightweight-fixture approach MaverikSummaryBuilderTests uses for
// AgentRegistry/LLMModelRegistry. Covers only the new Multiturn validation branches; the existing
// criterion-type branches (exact/contains/regex/llm-judge) predate this feature and aren't
// re-tested here.
public class MaverikSuiteRegistryTests
{
    private sealed class Harness : IDisposable
    {
        public required string TempDir { get; init; }
        public required AgentRegistry Agents { get; init; }
        public required LLMModelRegistry Models { get; init; }
        public void Dispose() => Directory.Delete(TempDir, recursive: true);
    }

    private static Harness NewHarness()
    {
        var tempDir = Path.Combine(Path.GetTempPath(), "maverik-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        var agents = new AgentRegistry(
            new AgentsFile { DefaultAgent = "agent1", Agents = [new AgentConfig { Id = "agent1", Name = "agent1", Model = "sim-model", SystemPrompt = "prompt", McpServers = [] }] },
            tempDir, NullLogger<AgentRegistry>.Instance);
        // A syntactically-real (unreachable) endpoint plus a Model name so client construction
        // succeeds — Resolve() only needs the client object to exist, never makes a network call.
        var models = new LLMModelRegistry(
            [new LLMModelConfig { Id = "sim-model", Model = "sim-model", Provider = "openai-compatible", Endpoint = "http://127.0.0.1:1" }],
            "sim-model", NullLogger<LLMModelRegistry>.Instance);
        return new Harness { TempDir = tempDir, Agents = agents, Models = models };
    }

    private static MaverikSuite Suite(MaverikQuestion question, string? userSimulatorModel = null) => new()
    {
        Id = "suite-1",
        Agents = ["agent1"],
        UserSimulatorModel = userSimulatorModel,
        Questions = [question],
    };

    private static MaverikQuestion MultiturnQuestion(string? userTurnMode, List<string>? scriptedUserTurns = null, string? userSimulatorModel = null) => new()
    {
        Id = "q1",
        Text = "what's the star count?",
        Criterion = new MaverikCriterion { Type = "exact", Expected = "42" },
        Multiturn = true,
        UserTurnMode = userTurnMode,
        ScriptedUserTurns = scriptedUserTurns,
        UserSimulatorModel = userSimulatorModel,
    };

    [Fact]
    public void Validate_MultiturnScripted_WithNonEmptyTurns_Passes()
    {
        using var h = NewHarness();
        var suite = Suite(MultiturnQuestion("scripted", scriptedUserTurns: ["it's octocat/Hello-World"]));

        var ex = Record.Exception(() => MaverikSuiteRegistry.Validate(suite, "test.json", h.Agents, h.Models));

        Assert.Null(ex);
    }

    [Fact]
    public void Validate_MultiturnScripted_WithEmptyTurns_Throws()
    {
        using var h = NewHarness();
        var suite = Suite(MultiturnQuestion("scripted", scriptedUserTurns: []));

        var ex = Assert.Throws<InvalidOperationException>(
            () => MaverikSuiteRegistry.Validate(suite, "test.json", h.Agents, h.Models));
        Assert.Contains("scriptedUserTurns", ex.Message);
    }

    [Fact]
    public void Validate_MultiturnScripted_WithNullTurns_Throws()
    {
        using var h = NewHarness();
        var suite = Suite(MultiturnQuestion("scripted"));

        Assert.Throws<InvalidOperationException>(
            () => MaverikSuiteRegistry.Validate(suite, "test.json", h.Agents, h.Models));
    }

    [Fact]
    public void Validate_MultiturnSimulated_WithResolvableSuiteDefaultModel_Passes()
    {
        using var h = NewHarness();
        var suite = Suite(MultiturnQuestion("simulated"), userSimulatorModel: "sim-model");

        var ex = Record.Exception(() => MaverikSuiteRegistry.Validate(suite, "test.json", h.Agents, h.Models));

        Assert.Null(ex);
    }

    [Fact]
    public void Validate_MultiturnSimulated_QuestionOverrideWinsOverSuiteDefault_Passes()
    {
        using var h = NewHarness();
        // Suite default deliberately unresolvable; the question's own override should be what's checked.
        var suite = Suite(MultiturnQuestion("simulated", userSimulatorModel: "sim-model"), userSimulatorModel: "does-not-exist");

        var ex = Record.Exception(() => MaverikSuiteRegistry.Validate(suite, "test.json", h.Agents, h.Models));

        Assert.Null(ex);
    }

    [Fact]
    public void Validate_MultiturnSimulated_NoSimulatorModelAnywhere_Throws()
    {
        using var h = NewHarness();
        var suite = Suite(MultiturnQuestion("simulated"));

        var ex = Assert.Throws<InvalidOperationException>(
            () => MaverikSuiteRegistry.Validate(suite, "test.json", h.Agents, h.Models));
        Assert.Contains("userSimulatorModel", ex.Message);
    }

    [Fact]
    public void Validate_MultiturnSimulated_UnresolvableSimulatorModel_Throws()
    {
        using var h = NewHarness();
        var suite = Suite(MultiturnQuestion("simulated"), userSimulatorModel: "does-not-exist");

        var ex = Assert.Throws<InvalidOperationException>(
            () => MaverikSuiteRegistry.Validate(suite, "test.json", h.Agents, h.Models));
        Assert.Contains("does not resolve", ex.Message);
    }

    [Fact]
    public void Validate_MultiturnUnknownMode_Throws()
    {
        using var h = NewHarness();
        var suite = Suite(MultiturnQuestion("telepathic"));

        var ex = Assert.Throws<InvalidOperationException>(
            () => MaverikSuiteRegistry.Validate(suite, "test.json", h.Agents, h.Models));
        Assert.Contains("userTurnMode", ex.Message);
    }

    [Fact]
    public void Validate_NonMultiturnQuestion_IgnoresMissingUserTurnFields()
    {
        using var h = NewHarness();
        var question = new MaverikQuestion
        {
            Id = "q1", Text = "plain question",
            Criterion = new MaverikCriterion { Type = "exact", Expected = "42" },
            Multiturn = false,
        };
        var suite = Suite(question);

        var ex = Record.Exception(() => MaverikSuiteRegistry.Validate(suite, "test.json", h.Agents, h.Models));

        Assert.Null(ex);
    }
}
