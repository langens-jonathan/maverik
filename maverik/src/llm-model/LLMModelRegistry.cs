using Anthropic;
using Anthropic.Core;
using Microsoft.Extensions.AI;
using OpenAI;
using System.ClientModel;
using System.ClientModel.Primitives;
using McpHost.Config;

namespace McpHost.LlmModel;

// State lives in a single immutable Snapshot, swapped by reference on Reload(). Reference
// assignment is atomic in .NET, so a Resolve() running concurrently with a Reload() sees either
// the fully-old or fully-new snapshot, never a torn mix — no locking needed on the read side.
// Unlike the original lazy-on-first-Resolve design, clients are now built eagerly at
// construction/Reload time: Reload is a deliberate action (a config-editor save) that wants to
// report success/failure immediately, and laziness bought little in practice since
// MaverikSuiteRegistry's startup validation already forces an eager load for any suite with an
// llm-judge criterion.
public sealed class LLMModelRegistry : IDisposable
{
    private sealed class Snapshot : IDisposable
    {
        public required string DefaultModel { get; init; }
        public required IReadOnlyList<LLMModelConfig> Configs { get; init; }
        public required Dictionary<string, IChatClient> Clients { get; init; }

        public void Dispose()
        {
            foreach (var client in Clients.Values) client.Dispose();
        }
    }

    private readonly ILogger<LLMModelRegistry> _log;

    // When non-null (MCPHOST_LLM_DEBUG on), this HttpClient carries the wire-logging handler
    // and is injected into every provider client. Null in normal operation. Reused across
    // reloads — it isn't per-model state.
    private readonly HttpClient? _http;

    private Snapshot _snapshot;

    public LLMModelRegistry(
        IReadOnlyList<LLMModelConfig> configs, string defaultModel,
        ILogger<LLMModelRegistry> log,
        HttpClient? loggingHttpClient = null)
    {
        _log = log;
        _http = loggingHttpClient;
        _snapshot = Build(configs, defaultModel, null);
    }

    // Convenience accessor for the default model's client (resolves the configured default id).
    // The primary API is Resolve(id); callers that need a specific model use that.
    public IChatClient Client => Resolve(_snapshot.DefaultModel);

    // Return the IChatClient for a specific model id. A null/empty id yields the default (the
    // configured default id, or the first loaded model when no default is set). An unknown id
    // throws — a wrong model id (e.g. from an agent's `model`) should fail loudly, not silently
    // fall back.
    public IChatClient Resolve(string? id)
    {
        var snap = _snapshot;

        if (string.IsNullOrEmpty(id))
        {
            var fallback = snap.Clients.Values.FirstOrDefault();
            if (fallback is null)
                throw new InvalidOperationException("No LLM models are configured in llm-models.json.");
            return fallback;
        }

        if (snap.Clients.TryGetValue(id, out var client))
            return client;

        _log.LogError("No LLM model with id '{Id}'. Available: {Ids}", id, string.Join(", ", snap.Clients.Keys));
        throw new InvalidOperationException(
            $"No LLM model with id '{id}' — check llm-models.json or the agent's model.");
    }

    // Config lookup (pricing, provider, etc.) rather than a live client. Unlike Resolve, an
    // unknown id returns null instead of throwing — a missing/bad model id when computing a
    // benchmark summary should just mean "no pricing available," not blow up the results view.
    public LLMModelConfig? ResolveConfig(string? id) =>
        string.IsNullOrEmpty(id) ? null : _snapshot.Configs.FirstOrDefault(c => c.Id == id);

    // Rebuilds every model's IChatClient from freshly edited llm-models.json and atomically
    // swaps them in. Returns the id/error of any model that failed to build (e.g. bad endpoint)
    // — those are skipped rather than aborting the whole reload, same fail-soft behavior as
    // startup. The previous snapshot's clients are disposed only after the swap: any chat turn
    // or MAVERIK run already holding an old IChatClient reference keeps using it until it
    // finishes: only Resolve() calls made after this point see the new set.
    public IReadOnlyList<(string Id, string Error)> Reload(IReadOnlyList<LLMModelConfig> configs, string defaultModel)
    {
        var failures = new List<(string, string)>();
        var newSnapshot = Build(configs, defaultModel, failures);
        var old = Interlocked.Exchange(ref _snapshot, newSnapshot);
        old.Dispose();
        return failures;
    }

    private Snapshot Build(IReadOnlyList<LLMModelConfig> configs, string defaultModel, List<(string, string)>? failures)
    {
        var clients = new Dictionary<string, IChatClient>();
        foreach (var config in configs)
        {
            try
            {
                _log.LogInformation("Adding LLM Model: '{Name}', '{Provider}', '{Model}', '{Endpoint}', apiKey configured: {HasApiKey}, '{SupportsTools}'",
                    config.Id, config.Provider, config.Model, config.Endpoint, config.ApiKey != null, config.SupportsTools);
                clients.Add(config.Id, createClient(config));
            }
            catch (Exception ex)
            {
                // One model failing must not stop the others (or the reload) from succeeding.
                _log.LogError(ex, "Failed to register model '{Name}'. Skipping it.", config.Id);
                failures?.Add((config.Id, ex.Message));
            }
        }

        _log.LogInformation("LLM models ready: {Models} model(s).", clients.Count);
        return new Snapshot { DefaultModel = defaultModel, Configs = configs, Clients = clients };
    }

    private IChatClient createClient(LLMModelConfig config)
    {
        // ${ENV_VAR} in apiKey (e.g. "${ANTHROPIC_API_KEY}") resolves against the environment
        // here — same construct and same shared expander as mcp-servers.json headers, so
        // secrets never have to live in the committed config file.
        var apiKey = EnvExpansion.ExpandNullable(config.ApiKey);

        if(config.Provider == "anthropic")
        {
            // Normal path unchanged. Only when wire logging is on do we route through
            // ClientOptions so the logging HttpClient can be injected; with ApiKey null we then
            // rely on ClientOptions reading the key from the environment, as the parameterless
            // AnthropicClient() does.
            if (_http == null)
            {
                if (apiKey != null)
                {
                    ClientOptions co = new ClientOptions();
                    co.ApiKey = apiKey;
                    return new AnthropicClient(co).AsIChatClient(config.Model);
                }
                return new AnthropicClient().AsIChatClient(config.Model); // this case supports using the APIKey from the environment variable (default anthropic implementation)
            }

            ClientOptions coDebug = new ClientOptions();
            if (apiKey != null) coDebug.ApiKey = apiKey;
            coDebug.HttpClient = _http;
            return new AnthropicClient(coDebug).AsIChatClient(config.Model);
        }

        if(config.Endpoint == null)
        {
            throw new ArgumentNullException(nameof(config.Endpoint));
        }

        OpenAIClientOptions options = new OpenAIClientOptions { Endpoint = new Uri(config.Endpoint) };
        if (_http != null) options.Transport = new HttpClientPipelineTransport(_http);
        ApiKeyCredential credential = new ApiKeyCredential(apiKey == null ? "none" : apiKey);
        return new OpenAIClient(credential, options).GetChatClient(config.Model).AsIChatClient();
    }

    void IDisposable.Dispose()
    {
        _snapshot.Dispose();
        _http?.Dispose();
    }
}
