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
builder.Services.AddSingleton<LLMModelRegistry>(sp =>
    new LLMModelRegistry(
        llmModelsFile.Models,
        llmModelsFile.DefaultModelId,
        sp.GetRequiredService<ILogger<LLMModelRegistry>>()));
builder.Services.AddChatClient(sp => sp.GetRequiredService<LLMModelRegistry>().Client);

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

var app = builder.Build();

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
app.MapPost("/api/chat", async (ChatRequest request, HttpContext http, ChatJobQueue queue) =>
{
    var sessionId = http.Session.Id;
    await queue.EnqueueAsync(new ChatJob(sessionId, request.Message));
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

app.Run();

public record ChatRequest(string Message);
