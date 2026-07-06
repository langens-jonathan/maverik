using Anthropic;
using Anthropic.Core;
using Microsoft.Extensions.AI;
using OpenAI;
using System.ClientModel;
using System.ClientModel.Primitives;

namespace McpHost;

public sealed class LLMModelRegistry(
    IReadOnlyList<LLMModelConfig> configs, string defaultModel,
    ILogger<LLMModelRegistry> log,
    HttpClient? loggingHttpClient = null) : IDisposable
{
    private readonly Dictionary<string, IChatClient> _clients = new();
    private bool _loaded = false;
    private readonly string _defaultModel = defaultModel;

    // When non-null (MCPHOST_LLM_DEBUG on), this HttpClient carries the wire-logging handler
    // and is injected into every provider client. Null in normal operation.
    private readonly HttpClient? _http = loggingHttpClient;

    // The default model's client. Kept for existing callers (e.g. AddChatClient in Program.cs);
    // it now just resolves the configured default id.
    public IChatClient Client => Resolve(_defaultModel);

    // Return the IChatClient for a specific model id. A null/empty id yields the default (the
    // configured default id, or the first loaded model when no default is set). An unknown id
    // throws — a wrong model id (e.g. from an agent's `model`) should fail loudly, not silently
    // fall back.
    public IChatClient Resolve(string? id)
    {
        if (!_loaded) loadClients();

        if (string.IsNullOrEmpty(id))
        {
            var fallback = _clients.Values.FirstOrDefault();
            if (fallback is null)
                throw new InvalidOperationException("No LLM models are configured in llm-models.json.");
            return fallback;
        }

        if (_clients.TryGetValue(id, out var client))
            return client;

        log.LogError("No LLM model with id '{Id}'. Available: {Ids}", id, string.Join(", ", _clients.Keys));
        throw new InvalidOperationException(
            $"No LLM model with id '{id}' — check llm-models.json or the agent's model.");
    }

    private IChatClient createClient(LLMModelConfig config)
    {
        if(config.Provider == "anthropic")
        {
            // Normal path unchanged. Only when wire logging is on do we route through
            // ClientOptions so the logging HttpClient can be injected; with ApiKey null we then
            // rely on ClientOptions reading the key from the environment, as the parameterless
            // AnthropicClient() does.
            if (_http == null)
            {
                if (config.ApiKey != null)
                {
                    ClientOptions co = new ClientOptions();
                    co.ApiKey = config.ApiKey;
                    return new AnthropicClient(co).AsIChatClient(config.Model);
                }
                return new AnthropicClient().AsIChatClient(config.Model); // this case supports using the APIKey from the environment variable (default anthropic implementation)
            }

            ClientOptions coDebug = new ClientOptions();
            if (config.ApiKey != null) coDebug.ApiKey = config.ApiKey;
            coDebug.HttpClient = _http;
            return new AnthropicClient(coDebug).AsIChatClient(config.Model);
        }

        if(config.Endpoint == null)
        {
            throw new ArgumentNullException(nameof(config.Endpoint));
        }

        OpenAIClientOptions options = new OpenAIClientOptions { Endpoint = new Uri(config.Endpoint) };
        if (_http != null) options.Transport = new HttpClientPipelineTransport(_http);
        ApiKeyCredential credential = new ApiKeyCredential(config.ApiKey == null ? "none" : config.ApiKey);
        return new OpenAIClient(credential, options).GetChatClient(config.Model).AsIChatClient();
    }

    private void loadClients()
    {
        _loaded = true;
        foreach (var config in configs)
        {
            try
            {
                log.LogInformation("Adding LLM Model: '{Name}', '{Provider}', '{Model}', '{Endpoint}', '{ApiKey}', '{SupportsTools}'",
                    config.Id, config.Provider, config.Model, config.Endpoint, config.ApiKey, config.SupportsTools);
                _clients.Add(config.Id, createClient(config));
            }
            catch (Exception ex)
            {
                // One server failing must not stop the host from starting.
                log.LogError(ex, "Failed to Register Model '{Name}'. Skipping it.", config.Id);
            }
        }

        log.LogInformation("LLM models ready: {Models} model(s).",
            _clients.Count);
    }

    void IDisposable.Dispose()
    {
        foreach(IChatClient client in _clients.Values)
        {
                client.Dispose();
        }
        _http?.Dispose();
    }
}
