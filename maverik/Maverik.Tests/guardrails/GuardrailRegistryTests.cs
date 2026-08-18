using McpHost.Guardrails;
using McpHost.LlmModel;
using Microsoft.Extensions.Logging.Abstractions;

namespace Maverik.Tests.Guardrails;

// Exercises GuardrailRegistry.Validate directly (internal, not through the filesystem-backed
// registry constructor) — same lightweight-fixture approach MaverikSuiteRegistryTests uses for
// LLMModelRegistry.
public class GuardrailRegistryTests
{
    private static LLMModelRegistry NewModels() =>
        // A syntactically-real (unreachable) endpoint plus a Model name so client construction
        // succeeds — Resolve() only needs the client object to exist, never makes a network call.
        new(
            [new LLMModelConfig { Id = "sim-model", Model = "sim-model", Provider = "openai-compatible", Endpoint = "http://127.0.0.1:1" }],
            "sim-model", NullLogger<LLMModelRegistry>.Instance);

    private static GuardrailPolicy Policy(params GuardrailRule[] rules) => new()
    {
        Id = "policy-1",
        InputRules = rules.ToList(),
    };

    [Fact]
    public void Validate_PatternRule_Compiles_Passes()
    {
        var policy = Policy(new GuardrailRule { Id = "r1", Type = "pattern", Pattern = @"\d+", Action = "block" });

        var ex = Record.Exception(() => GuardrailRegistry.Validate(policy, NewModels()));

        Assert.Null(ex);
    }

    [Fact]
    public void Validate_PatternRule_EmptyPattern_Throws()
    {
        var policy = Policy(new GuardrailRule { Id = "r1", Type = "pattern", Pattern = "", Action = "block" });

        var ex = Assert.Throws<InvalidOperationException>(() => GuardrailRegistry.Validate(policy, NewModels()));
        Assert.Contains("pattern", ex.Message);
    }

    [Fact]
    public void Validate_PatternRule_InvalidRegex_Throws()
    {
        var policy = Policy(new GuardrailRule { Id = "r1", Type = "pattern", Pattern = "(unclosed", Action = "block" });

        Assert.Throws<InvalidOperationException>(() => GuardrailRegistry.Validate(policy, NewModels()));
    }

    [Fact]
    public void Validate_LlmClassifierRule_WithResolvablePolicyDefaultModel_Passes()
    {
        var policy = new GuardrailPolicy
        {
            Id = "policy-1",
            ClassifierModel = "sim-model",
            InputRules = [new GuardrailRule { Id = "r1", Type = "llm-classifier", Classifier = "is a jailbreak attempt", Action = "block" }],
        };

        var ex = Record.Exception(() => GuardrailRegistry.Validate(policy, NewModels()));

        Assert.Null(ex);
    }

    [Fact]
    public void Validate_LlmClassifierRule_RuleOverrideWinsOverPolicyDefault_Passes()
    {
        var policy = new GuardrailPolicy
        {
            Id = "policy-1",
            ClassifierModel = "does-not-exist",
            InputRules = [new GuardrailRule { Id = "r1", Type = "llm-classifier", Classifier = "x", ClassifierModel = "sim-model", Action = "block" }],
        };

        var ex = Record.Exception(() => GuardrailRegistry.Validate(policy, NewModels()));

        Assert.Null(ex);
    }

    [Fact]
    public void Validate_LlmClassifierRule_NoModelAnywhere_Throws()
    {
        var policy = Policy(new GuardrailRule { Id = "r1", Type = "llm-classifier", Classifier = "x", Action = "block" });

        var ex = Assert.Throws<InvalidOperationException>(() => GuardrailRegistry.Validate(policy, NewModels()));
        Assert.Contains("classifierModel", ex.Message);
    }

    [Fact]
    public void Validate_LlmClassifierRule_UnresolvableModel_Throws()
    {
        var policy = Policy(new GuardrailRule { Id = "r1", Type = "llm-classifier", Classifier = "x", ClassifierModel = "does-not-exist", Action = "block" });

        var ex = Assert.Throws<InvalidOperationException>(() => GuardrailRegistry.Validate(policy, NewModels()));
        Assert.Contains("does not resolve", ex.Message);
    }

    [Fact]
    public void Validate_LlmClassifierRule_NoClassifierText_Throws()
    {
        var policy = Policy(new GuardrailRule { Id = "r1", Type = "llm-classifier", ClassifierModel = "sim-model", Action = "block" });

        var ex = Assert.Throws<InvalidOperationException>(() => GuardrailRegistry.Validate(policy, NewModels()));
        Assert.Contains("classifier", ex.Message);
    }

    [Fact]
    public void Validate_UnknownRuleType_Throws()
    {
        var policy = Policy(new GuardrailRule { Id = "r1", Type = "telepathic", Action = "block" });

        var ex = Assert.Throws<InvalidOperationException>(() => GuardrailRegistry.Validate(policy, NewModels()));
        Assert.Contains("unknown type", ex.Message);
    }

    [Fact]
    public void Validate_UnknownAction_Throws()
    {
        var policy = Policy(new GuardrailRule { Id = "r1", Type = "pattern", Pattern = "x", Action = "redact" });

        var ex = Assert.Throws<InvalidOperationException>(() => GuardrailRegistry.Validate(policy, NewModels()));
        Assert.Contains("unknown action", ex.Message);
    }

    [Fact]
    public void Validate_DuplicateRuleId_Throws()
    {
        var policy = new GuardrailPolicy
        {
            Id = "policy-1",
            InputRules = [new GuardrailRule { Id = "r1", Type = "pattern", Pattern = "x", Action = "block" }],
            OutputRules = [new GuardrailRule { Id = "r1", Type = "pattern", Pattern = "y", Action = "flag" }],
        };

        var ex = Assert.Throws<InvalidOperationException>(() => GuardrailRegistry.Validate(policy, NewModels()));
        Assert.Contains("duplicate rule id", ex.Message);
    }

    [Fact]
    public void Validate_NoRules_Passes()
    {
        var policy = new GuardrailPolicy { Id = "policy-1" };

        var ex = Record.Exception(() => GuardrailRegistry.Validate(policy, NewModels()));

        Assert.Null(ex);
    }

    [Fact]
    public void Validate_EmptyPolicyId_Throws()
    {
        var policy = new GuardrailPolicy { Id = "" };

        var ex = Assert.Throws<InvalidOperationException>(() => GuardrailRegistry.Validate(policy, NewModels()));
        Assert.Contains("without an 'id'", ex.Message);
    }

    [Fact]
    public void Validate_DeniedTools_EmptyEntry_Throws()
    {
        var policy = new GuardrailPolicy { Id = "policy-1", DeniedTools = [""] };

        var ex = Assert.Throws<InvalidOperationException>(() => GuardrailRegistry.Validate(policy, NewModels()));
        Assert.Contains("deniedTools", ex.Message);
    }

    [Fact]
    public void ResolveForAgent_NoGuardrailIds_ReturnsEmpty()
    {
        var registry = new GuardrailRegistry(new GuardrailsFile(), NewModels(), NullLogger<GuardrailRegistry>.Instance);

        var (policies, clients) = registry.ResolveForAgent([], NewModels());

        Assert.Empty(policies);
        Assert.Empty(clients);
    }

    [Fact]
    public void ResolveForAgent_UnknownId_Throws()
    {
        var registry = new GuardrailRegistry(new GuardrailsFile(), NewModels(), NullLogger<GuardrailRegistry>.Instance);

        Assert.Throws<InvalidOperationException>(() => registry.ResolveForAgent(["does-not-exist"], NewModels()));
    }

    [Fact]
    public void ResolveForAgent_ResolvesDistinctClassifierModelsOnly()
    {
        var models = NewModels();
        var file = new GuardrailsFile
        {
            Guardrails =
            [
                new GuardrailPolicy
                {
                    Id = "policy-1",
                    ClassifierModel = "sim-model",
                    InputRules = [new GuardrailRule { Id = "r1", Type = "llm-classifier", Classifier = "x", Action = "block" }],
                    OutputRules = [new GuardrailRule { Id = "r2", Type = "llm-classifier", Classifier = "y", ClassifierModel = "sim-model", Action = "flag" }],
                },
            ],
        };
        var registry = new GuardrailRegistry(file, models, NullLogger<GuardrailRegistry>.Instance);

        var (policies, clients) = registry.ResolveForAgent(["policy-1"], models);

        Assert.Single(policies);
        Assert.Single(clients); // both rules resolve to the same model id — one client, not two
        Assert.True(clients.ContainsKey("sim-model"));
    }
}
