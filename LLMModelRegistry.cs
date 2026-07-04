using Anthropic;
using Anthropic.Core;
using Microsoft.Extensions.AI;
using OpenAI;
using System.ClientModel;

namespace McpHost;

public sealed class LLMModelRegistry(
    IReadOnlyList<LLMModelConfig> configs, string defaultModel,
    ILogger<LLMModelRegistry> log) : IDisposable
{
    private readonly Dictionary<string, IChatClient> _clients = new();
    private bool _loaded = false;
    private readonly string _defaultModel = defaultModel;

    public IChatClient Client { get
        {
            if (!_loaded) loadClients();
            if (string.IsNullOrEmpty(_defaultModel))
            {
                return (_clients.Values.FirstOrDefault());
            }
            return _clients.GetValueOrDefault(_defaultModel);
        }
    }

    private IChatClient createClient(LLMModelConfig config)
    {
        if(config.Provider == "anthropic")
        {
            if (config.ApiKey != null)
            {
                ClientOptions co = new ClientOptions();
                co.ApiKey = config.ApiKey;
                return new AnthropicClient(co).AsIChatClient(config.Model);
            }
            return new AnthropicClient().AsIChatClient(config.Model); // this case supports using the APIKey from the environment variable (default anthropic implementation)
        }

        if(config.Endpoint == null)
        {
            throw new ArgumentNullException(nameof(config.Endpoint));
        }

        OpenAIClientOptions options = new OpenAIClientOptions { Endpoint = new Uri(config.Endpoint) };
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
    }
}
