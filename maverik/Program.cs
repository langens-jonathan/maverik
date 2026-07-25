using System.Net;
using Anthropic;
using McpHost.Agents;
using McpHost.Chat;
using McpHost.Config;
using McpHost.LlmModel;
using McpHost.Loop;
using McpHost.Maverik;
using McpHost.Mcp;
using Microsoft.Extensions.AI;

var builder = WebApplication.CreateBuilder(args);

// --- Config directory ---
// Every editable config file (agents.json, llm-models.json, mcp-servers.json, prompts/,
// maverik-suites/) lives under ./config, bind-mounted read-write so /api/config/* can edit it
// from the dashboard. A missing JSON config is bootstrapped from its committed *.example.json
// sibling on first read — see ConfigFileService. Built before builder.Build() so the same
// instance can both drive startup loading below and be registered for the endpoints.
var configDir = Path.Combine(builder.Environment.ContentRootPath, "config");
var configFiles = new ConfigFileService(configDir);
builder.Services.AddSingleton(configFiles);

// --- CORS (frontend) ---
// The maverik-frontend container is a separate origin (different published port), so the
// browser needs CORS to call this API. None of the endpoints it uses (agents/tools/maverik/*)
// touch the session cookie — that's only /api/session, /api/chat, /api/messages — so a plain
// policy without AllowCredentials is enough and the chat cookie flow is untouched.
var frontendOrigin = Environment.GetEnvironmentVariable("MAVERIK_FRONTEND_ORIGIN") ?? "http://localhost:5090";
builder.Services.AddCors(o => o.AddPolicy("frontend", p =>
    p.WithOrigins(frontendOrigin).AllowAnyHeader().AllowAnyMethod()));

// --- Session ---
// Each browser gets a session cookie; conversation history and the outbox are keyed by the
// session id.
builder.Services.AddDistributedMemoryCache();
builder.Services.AddSession(options =>
{
    options.Cookie.Name = ".McpHost.Session";
    options.Cookie.HttpOnly = true;
    options.Cookie.IsEssential = true;
    options.IdleTimeout = TimeSpan.FromHours(2);
});

// --- LLM backend ---
// Registered WITHOUT .UseFunctionInvocation(): the model returns raw FunctionCallContent and
// the ChatWorker drives the tool loop itself. Adding that middleware back collapses the loop
// to a single call.
var (llmModelsFile, _) = configFiles.LoadLlmModels();
// Wire-level LLM debug logging. When MCPHOST_LLM_DEBUG is truthy, a DelegatingHandler is
// injected into the provider clients that logs every raw HTTP request/response (per session)
// to logs/{sessionId}.log and the ILogger. Off by default — zero overhead, clients built as
// before.
var llmDebugEnv = Environment.GetEnvironmentVariable("MCPHOST_LLM_DEBUG");
var llmDebug = llmDebugEnv == "1" || string.Equals(llmDebugEnv, "true", StringComparison.OrdinalIgnoreCase);
var llmLogDir = Path.Combine(builder.Environment.ContentRootPath, "logs");
if (llmDebug) Directory.CreateDirectory(llmLogDir);

builder.Services.AddSingleton<LLMModelRegistry>(sp =>
{
    HttpClient? loggingHttp = null;
    if (llmDebug)
    {
        var wireLog = sp.GetRequiredService<ILoggerFactory>().CreateLogger("LlmWire");
        loggingHttp = new HttpClient(new LlmLoggingHandler(wireLog, llmLogDir)
        {
            InnerHandler = new HttpClientHandler { AutomaticDecompression = DecompressionMethods.All }
        });
    }
    return new LLMModelRegistry(
        llmModelsFile.Models,
        llmModelsFile.DefaultModelId,
        sp.GetRequiredService<ILogger<LLMModelRegistry>>(),
        loggingHttp);
});
// --- Host-loop infrastructure ---
// The loop strategies ("manual", "parallel-tools") are shared by ChatWorker and the MAVERIK
// benchmark runner — both must execute the same loop code.
builder.Services.AddSingleton<LoopStrategyRegistry>();
builder.Services.AddSingleton<ChatJobQueue>();
builder.Services.AddSingleton<ConversationStore>();
builder.Services.AddSingleton<ChatOutbox>();
builder.Services.AddHostedService<ChatWorker>();

// --- MCP servers ---
var (mcpFile, _) = configFiles.LoadMcpServers();
builder.Services.AddSingleton<IReadOnlyList<McpServerConfig>>(mcpFile.Servers);

// The registry is a singleton (endpoints and the worker read the catalog) AND a hosted
// service (connect on startup, dispose on shutdown) — the same instance for both.
builder.Services.AddSingleton<McpServerRegistry>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<McpServerRegistry>());

// --- Agents ---
// AgentRegistry needs configDir so it can find each agent's prompt file
// (config/prompts/agent/<id>.md) when the prompt isn't inline.
var (agentsFile, _) = configFiles.LoadAgents();
builder.Services.AddSingleton<AgentRegistry>(sp =>
    new AgentRegistry(
        agentsFile,
        configDir,
        sp.GetRequiredService<ILogger<AgentRegistry>>()));

// --- MAVERIK test suites ---
// One file per suite under config/maverik-suites/. Loaded and validated at startup; a missing
// folder just means zero suites. AgentRegistry/LLMModelRegistry are injected so agent ids and
// judge model ids in suite files are validated against the real configuration.
builder.Services.AddSingleton<MaverikSuiteRegistry>(sp => new MaverikSuiteRegistry(
    configDir,
    sp.GetRequiredService<AgentRegistry>(),
    sp.GetRequiredService<LLMModelRegistry>(),
    sp.GetRequiredService<ILogger<MaverikSuiteRegistry>>()));

// Judges MAVERIK answers (deterministic checks + llm-judge). Stateless; used by the runner.
builder.Services.AddSingleton<CriterionEvaluator>();

// --- MAVERIK runner pipeline ---
// Mirrors the chat pipeline (queue → background worker → store polled by endpoints), but as
// its OWN worker so a long benchmark run never blocks interactive chat.
builder.Services.AddSingleton<MaverikRunQueue>();
builder.Services.AddSingleton<MaverikRunStore>();
builder.Services.AddSingleton<MaverikResultsWriter>(sp => new MaverikResultsWriter(
    builder.Environment.ContentRootPath,
    sp.GetRequiredService<ILogger<MaverikResultsWriter>>()));
builder.Services.AddHostedService<MaverikRunner>();

var app = builder.Build();

// Build the agent registry eagerly so agents.json and the prompt files are validated at startup
// (fail fast) with a clear error, rather than surfacing lazily. (ChatWorker depends on it too, so
// it would be constructed at startup regardless; this just makes the intent explicit.)
app.Services.GetRequiredService<AgentRegistry>();

// Same fail-fast treatment for the MAVERIK suites: nothing else depends on the registry at
// startup, so without this a broken suite file would only surface on first use.
app.Services.GetRequiredService<MaverikSuiteRegistry>();

// --- Static test front end (NOT ported to the platform) ---
// Serves wwwroot/index.html as a reference client and local demo. The platform hosts its own
// front end against the /api endpoints below; this exists only for testing.
app.UseDefaultFiles();
app.UseStaticFiles();

app.UseCors("frontend");
app.UseSession();

// --- API (the backend that ports to the platform) ---

// Establish the session cookie.
app.MapPost("/api/session", async (HttpContext http) =>
{
    http.Session.SetString("touched", "1");
    await http.Session.CommitAsync();
    return Results.Ok(new { sessionId = http.Session.Id });
});

// Enqueue a job and return immediately; results arrive via polling /api/messages.
app.MapPost("/api/chat", async (ChatRequest request, HttpContext http, ChatJobQueue queue, AgentRegistry agents) =>
{
    var sessionId = http.Session.Id;
    // Use the requested agent, or the configured default when none is given.
    var agentId = string.IsNullOrWhiteSpace(request.Agent) ? agents.DefaultAgent : request.Agent;
    await queue.EnqueueAsync(new ChatJob(sessionId, request.Message, agentId));
    return Results.Ok(new { status = "accepted" });
});

// Poll for buffered messages (progress lines and final answers) for this session. Returns
// and clears whatever is queued; an empty array means nothing new yet.
app.MapGet("/api/messages", (HttpContext http, ChatOutbox outbox) =>
    Results.Ok(new { messages = outbox.Drain(http.Session.Id) }));

// Inspect the aggregated MCP tool catalog, grouped by server. No LLM involved.
app.MapGet("/api/tools", (McpServerRegistry mcp) =>
    Results.Ok(mcp.ToolsByServer.Select(server => new
    {
        server = server.Key,
        toolCount = server.Value.Count,
        tools = server.Value.Select(t => new { t.Name, t.Description })
    })));

// List the configured agents so a UI can offer a picker. Deliberately excludes the (potentially
// large) system prompt — id/name/model/servers are enough to choose one.
app.MapGet("/api/agents", (AgentRegistry agents) =>
    Results.Ok(new
    {
        defaultAgent = agents.DefaultAgent,
        agents = agents.Agents.Select(a => new { a.Id, a.Name, a.Description, a.Model, a.LoopType, a.McpServers })
    }));

// --- Config editing (dashboard) ---
// View/edit the three editable JSON configs plus per-agent prompt files. Every registry above is
// built once at startup, so a save here only takes effect after the container restarts — every
// PUT response says so explicitly rather than implying a live update.
app.MapGet("/api/config/agents", (ConfigFileService cfg) =>
{
    var (data, bootstrapped) = cfg.LoadAgents();
    return Results.Ok(new { bootstrapped, data });
});

app.MapPut("/api/config/agents", (AgentsFile data, ConfigFileService cfg, AgentRegistry agentRegistry) =>
{
    if (data.Agents.Any(a => string.IsNullOrWhiteSpace(a.Id)))
        return Results.BadRequest(new { error = "Every agent needs a non-empty id." });
    var ids = data.Agents.Select(a => a.Id).ToList();
    if (ids.Distinct(StringComparer.Ordinal).Count() != ids.Count)
        return Results.BadRequest(new { error = "Agent ids must be unique." });
    if (!string.IsNullOrWhiteSpace(data.DefaultAgent) && !ids.Contains(data.DefaultAgent))
        return Results.BadRequest(new { error = $"defaultAgent '{data.DefaultAgent}' is not in the agents list." });

    cfg.SaveAgents(data);
    return Results.Ok(ApplyAgentsReload(data, agentRegistry));
});

app.MapGet("/api/config/llm-models", (ConfigFileService cfg) =>
{
    var (data, bootstrapped) = cfg.LoadLlmModels();
    return Results.Ok(new { bootstrapped, data });
});

app.MapPut("/api/config/llm-models", (LLMModelsConfig data, ConfigFileService cfg, LLMModelRegistry modelRegistry) =>
{
    if (data.Models.Any(m => string.IsNullOrWhiteSpace(m.Id)))
        return Results.BadRequest(new { error = "Every model needs a non-empty id." });
    var ids = data.Models.Select(m => m.Id).ToList();
    if (ids.Distinct(StringComparer.Ordinal).Count() != ids.Count)
        return Results.BadRequest(new { error = "Model ids must be unique." });
    if (string.IsNullOrWhiteSpace(data.DefaultModelId) || !ids.Contains(data.DefaultModelId))
        return Results.BadRequest(new { error = $"defaultModelId '{data.DefaultModelId}' is not in the models list." });

    cfg.SaveLlmModels(data);
    var failures = modelRegistry.Reload(data.Models, data.DefaultModelId);
    var message = failures.Count == 0
        ? null
        : $"Applied, but {failures.Count} model(s) failed to initialize and are unavailable: " +
          string.Join("; ", failures.Select(f => $"{f.Id} ({f.Error})"));
    return Results.Ok(new { applied = true, message, restartRequired = false });
});

app.MapGet("/api/config/mcp-servers", (ConfigFileService cfg) =>
{
    var (data, bootstrapped) = cfg.LoadMcpServers();
    return Results.Ok(new { bootstrapped, data });
});

app.MapPut("/api/config/mcp-servers", (McpServersFile data, ConfigFileService cfg) =>
{
    if (data.Servers.Any(s => string.IsNullOrWhiteSpace(s.Name)))
        return Results.BadRequest(new { error = "Every MCP server needs a non-empty name." });
    var names = data.Servers.Select(s => s.Name).ToList();
    if (names.Distinct(StringComparer.Ordinal).Count() != names.Count)
        return Results.BadRequest(new { error = "MCP server names must be unique." });

    cfg.SaveMcpServers(data);
    // MCP servers hold live network connections (McpServerRegistry is also the hosted service
    // that connects/disconnects them) — reconnecting safely while requests may be in flight is
    // its own piece of work, deliberately not done here. Restart to pick this up.
    return Results.Ok(new { applied = false, message = (string?)null, restartRequired = true });
});

// Per-agent system prompt file (config/prompts/agent/<id>.md). No example template exists for
// these (they're real committed content, not secrets), so a missing file just means an empty
// draft rather than a copied-from-example one.
app.MapGet("/api/config/prompts/{agentId}", (string agentId, ConfigFileService cfg) =>
{
    var (content, bootstrapped) = cfg.LoadPrompt(agentId);
    return Results.Ok(new { bootstrapped, content });
});

app.MapPut("/api/config/prompts/{agentId}", (string agentId, PromptRequest request, ConfigFileService cfg, AgentRegistry agentRegistry) =>
{
    cfg.SavePrompt(agentId, request.Content ?? "");
    // Re-resolve every agent's effective prompt (including this one) from the current
    // agents.json, so a prompt-file-only edit is picked up live the same way an agents.json
    // edit is.
    var (agentsFile, _) = cfg.LoadAgents();
    return Results.Ok(ApplyAgentsReload(agentsFile, agentRegistry));
});

// List the loaded MAVERIK suites so a client can pick one to run. Question texts/criteria are
// deliberately summarized to a count — the run results are where answers live.
app.MapGet("/api/maverik/suites", (MaverikSuiteRegistry suites) =>
    Results.Ok(suites.Suites.Select(s => new
    {
        s.Id,
        s.Name,
        s.Description,
        s.Agents,
        s.JudgeModel,
        questionCount = s.Questions.Count
    })));

// Full detail of one suite — questions and criteria included — so a UI can render the test plan
// itself, not just a count.
app.MapGet("/api/maverik/suites/{suiteId}", (string suiteId, MaverikSuiteRegistry suites) =>
{
    try { return Results.Ok(suites.Resolve(suiteId)); }
    catch (InvalidOperationException ex) { return Results.NotFound(new { error = ex.Message }); }
});

// Start a benchmark run. All ids are validated HERE so mistakes fail at request time with a
// 400, not mid-run; the runner can then assume a well-formed request. Returns { runId }
// immediately — results arrive by polling the endpoints below.
app.MapPost("/api/maverik/runs", async (
    StartRunRequest request, MaverikSuiteRegistry suites, AgentRegistry agents,
    MaverikRunStore store, MaverikRunQueue queue) =>
{
    MaverikSuite suite;
    try { suite = suites.Resolve(request.SuiteId ?? ""); }
    catch (InvalidOperationException ex) { return Results.BadRequest(new { error = ex.Message }); }

    // The request's agent list wins; otherwise the suite's default set.
    var agentIds = request.AgentIds is { Count: > 0 } ? request.AgentIds : suite.Agents;
    if (agentIds.Count == 0)
        return Results.BadRequest(new { error = $"Suite '{suite.Id}' has no default agents; pass agentIds." });
    foreach (var agentId in agentIds)
    {
        try { agents.Resolve(agentId); }
        catch (InvalidOperationException ex) { return Results.BadRequest(new { error = ex.Message }); }
    }

    var repetitions = request.Repetitions ?? 1;
    if (repetitions < 1)
        return Results.BadRequest(new { error = "repetitions must be >= 1." });

    // Readable-unique id; the suffix guards against two runs started within the same second.
    var runId = $"{suite.Id}-{DateTimeOffset.UtcNow:yyyyMMdd-HHmmss}";
    while (store.Get(runId) is not null)
        runId += "x";

    store.Set(new RunStatus(
        runId, suite.Id, agentIds, repetitions,
        State: "queued",
        TotalCases: agentIds.Count * suite.Questions.Count * repetitions,
        CompletedCases: 0,
        CreatedAt: DateTimeOffset.UtcNow,
        StartedAt: null, FinishedAt: null,
        Results: []));

    await queue.EnqueueAsync(new RunRequest(runId, suite.Id, agentIds, repetitions));
    return Results.Ok(new { runId });
});

// List all runs, newest first — id, state, and progress; details live one level deeper.
app.MapGet("/api/maverik/runs", (MaverikRunStore store) =>
    Results.Ok(store.All().Select(r => new
    {
        r.RunId,
        r.SuiteId,
        r.State,
        r.CompletedCases,
        r.TotalCases,
        r.CreatedAt,
        r.StartedAt,
        r.FinishedAt
    })));

// Full status of one run, per-case results included — poll this while the run executes.
app.MapGet("/api/maverik/runs/{runId}", (string runId, MaverikRunStore store) =>
    store.Get(runId) is { } run ? Results.Ok(run) : Results.NotFound(new { error = $"No run '{runId}'." }));

// Per-agent aggregates + cost estimates + judge overhead — the comparison view. Computed live
// from whatever results exist so far, so this also works on a still-running run (it just
// reflects partial progress); the same computation is persisted as summary.json once a run
// completes (see MaverikRunner/MaverikResultsWriter).
app.MapGet("/api/maverik/runs/{runId}/summary", (
    string runId, MaverikRunStore store, MaverikSuiteRegistry suites, AgentRegistry agents, LLMModelRegistry models) =>
    store.Get(runId) is { } run
        ? Results.Ok(MaverikSummaryBuilder.Build(run, suites, agents, models))
        : Results.NotFound(new { error = $"No run '{runId}'." }));

app.Run();

// Shared by PUT /api/config/agents and PUT /api/config/prompts/{agentId} (the latter reloads
// from the current on-disk agents.json rather than a new one, so a prompt-only edit also takes
// effect immediately). AgentRegistry.Reload rolls back to the previous snapshot on failure (e.g.
// a referenced prompt file is missing), so a bad edit never takes the host down — it just fails
// to apply until fixed, which this reports back rather than throwing through to the client.
static object ApplyAgentsReload(AgentsFile file, AgentRegistry agentRegistry)
{
    try
    {
        agentRegistry.Reload(file);
        return new { applied = true, message = (string?)null, restartRequired = false };
    }
    catch (Exception ex)
    {
        return new
        {
            applied = false,
            message = $"Saved to disk, but couldn't apply live: {ex.Message} The previous configuration is still active — fix the issue and save again.",
            restartRequired = false
        };
    }
}

public record ChatRequest(string Message, string? Agent = null);

// Body of POST /api/maverik/runs. AgentIds defaults to the suite's list, Repetitions to 1.
public record StartRunRequest(string? SuiteId, List<string>? AgentIds = null, int? Repetitions = null);

// Body of PUT /api/config/prompts/{agentId}.
public record PromptRequest(string? Content);
