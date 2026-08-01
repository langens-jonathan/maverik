namespace McpHost.LlmModel;

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

    // Multipliers on InputPricePerMTok for Anthropic prompt-caching (see AnthropicCacheControl) —
    // not separate absolute prices, since that's literally how the provider prices caching (a
    // premium/discount off the base input rate) and it stays correct if the base price changes.
    // Null means "no cache-aware estimate," matching the InputPricePerMTok/OutputPricePerMTok
    // null convention above; only consulted for agents with PromptCaching enabled.
    public decimal? CacheWriteMultiplier { get; set; }     // 5-minute TTL, e.g. 1.25
    public decimal? CacheWrite1hMultiplier { get; set; }   // 1-hour TTL, e.g. 2.0
    public decimal? CacheReadMultiplier { get; set; }      // e.g. 0.1
}
