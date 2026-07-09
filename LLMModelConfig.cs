namespace McpHost;

public sealed class LLMModelsConfig
{
    public required string DefaultModelId { get; set; }
    public List<LLMModelConfig> Models { get; set; } = new();
}

public sealed class LLMModelConfig
{
    public string Id { get; set; } = "";
    public string? Provider { get; set; } = "openai-compatible";
    public string? Model { get; set; }

    public string? Endpoint { get; set; }
    public string? ApiKey { get; set; } = null;
    public bool? SupportsTools { get; set; } = true;

    // Optional pricing in USD per 1M tokens, used by MAVERIK's cost estimation. Null means
    // "no pricing configured" — cost fields in run summaries stay null rather than 0.
    public decimal? InputPricePerMTok { get; set; }
    public decimal? OutputPricePerMTok { get; set; }
}
