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
}
