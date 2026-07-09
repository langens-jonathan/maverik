using System.Net;
using System.Text.Json;
using Anthropic;
using McpHost;
using Microsoft.Extensions.AI;

var builder = WebApplication.CreateBuilder(args);

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
var llmModelsConfigPath = Path.Combine(builder.Environment.ContentRootPath, "llm-models.json");
var llmModelsFile = JsonSerializer.Deserialize<LLMModelsConfig>(
                  File.ReadAllText(llmModelsConfigPath),
                  new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
              ?? new LLMModelsConfig { DefaultModelId = "" };
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
builder.Services.AddSingleton<ChatJobQueue>();
builder.Services.AddSingleton<ConversationStore>();
builder.Services.AddSingleton<ChatOutbox>();
builder.Services.AddHostedService<ChatWorker>();

// --- MCP servers ---
// Load mcp-servers.json and bind it (case-insensitive, so "name" maps to Name).
// ContentRootPath is the project dir during `dotnet run`.
var mcpConfigPath = Path.Combine(builder.Environment.ContentRootPath, "mcp-servers.json");
var mcpFile = JsonSerializer.Deserialize<McpServersFile>(
                  File.ReadAllText(mcpConfigPath),
                  new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
              ?? new McpServersFile();
builder.Services.AddSingleton<IReadOnlyList<McpServerConfig>>(mcpFile.Servers);

// The registry is a singleton (endpoints and the worker read the catalog) AND a hosted
// service (connect on startup, dispose on shutdown) — the same instance for both.
builder.Services.AddSingleton<McpServerRegistry>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<McpServerRegistry>());

// --- Agents ---
// Load agents.json the same way as mcp-servers.json. AgentRegistry needs ContentRootPath so it can
// find each agent's prompt file (prompts/agent/<id>.md) when the prompt isn't inline.
var agentsConfigPath = Path.Combine(builder.Environment.ContentRootPath, "agents.json");
var agentsFile = JsonSerializer.Deserialize<AgentsFile>(
                     File.ReadAllText(agentsConfigPath),
                     new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                 ?? new AgentsFile();
builder.Services.AddSingleton<AgentRegistry>(sp =>
    new AgentRegistry(
        agentsFile,
        builder.Environment.ContentRootPath,
        sp.GetRequiredService<ILogger<AgentRegistry>>()));

var app = builder.Build();

// Build the agent registry eagerly so agents.json and the prompt files are validated at startup
// (fail fast) with a clear error, rather than surfacing lazily. (ChatWorker depends on it too, so
// it would be constructed at startup regardless; this just makes the intent explicit.)
app.Services.GetRequiredService<AgentRegistry>();

// --- Static test front end (NOT ported to the platform) ---
// Serves wwwroot/index.html as a reference client and local demo. The platform hosts its own
// front end against the /api endpoints below; this exists only for testing.
app.UseDefaultFiles();
app.UseStaticFiles();

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

app.Run();

public record ChatRequest(string Message, string? Agent = null);
