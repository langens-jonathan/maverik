using System.Text.Json;
using Anthropic;
using McpHost;
using Microsoft.Extensions.AI;

var builder = WebApplication.CreateBuilder(args);

// --- Session (step 1) ---
builder.Services.AddDistributedMemoryCache();
builder.Services.AddSession(options =>
{
    options.Cookie.Name = ".McpHost.Session";
    options.Cookie.HttpOnly = true;
    options.Cookie.IsEssential = true;
    options.IdleTimeout = TimeSpan.FromHours(2);
});

// --- WebSocket registry (step 1) ---
builder.Services.AddSingleton<ChatConnectionRegistry>();

// --- LLM backend (step 2, modified in step 4) ---
// NOTE: .UseFunctionInvocation() is intentionally REMOVED here. With it, the middleware
// would auto-resolve tool calls and the ChatWorker loop would never see them. Without
// it, the model returns raw FunctionCallContent and we drive the tool loop ourselves.
// Put it back (and simplify ChatWorker.ProcessAsync) to switch to automatic invocation.
builder.Services.AddChatClient(_ =>
    new AnthropicClient().AsIChatClient("claude-haiku-4-5"));

// --- Host-loop infrastructure (step 2) ---
builder.Services.AddSingleton<ChatJobQueue>();
builder.Services.AddSingleton<ConversationStore>();
builder.Services.AddHostedService<ChatWorker>();

// --- MCP servers (step 3) ---
// Load the dedicated config file (his preferred shape) and bind it. Case-insensitive
// so "name" maps to Name, etc. ContentRootPath is the project dir during `dotnet run`.
var mcpConfigPath = Path.Combine(builder.Environment.ContentRootPath, "mcp-servers.json");
var mcpFile = JsonSerializer.Deserialize<McpServersFile>(
                  File.ReadAllText(mcpConfigPath),
                  new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
              ?? new McpServersFile();
builder.Services.AddSingleton<IReadOnlyList<McpServerConfig>>(mcpFile.Servers);

// The registry is a singleton (so the /api/tools endpoint and, later, the worker can
// read the catalog) AND a hosted service (so it connects on startup, disposes on
// shutdown). Register the singleton, then point the hosted service at that same instance.
builder.Services.AddSingleton<McpServerRegistry>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<McpServerRegistry>());

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();
app.UseWebSockets();
app.UseSession();

// Establish the session cookie before the socket opens (step 1).
app.MapPost("/api/session", async (HttpContext http) =>
{
    http.Session.SetString("touched", "1");
    await http.Session.CommitAsync();
    return Results.Ok(new { sessionId = http.Session.Id });
});

// Enqueue a job; the ChatWorker pushes the answer over the socket (step 2).
app.MapPost("/api/chat", async (ChatRequest request, HttpContext http, ChatJobQueue queue) =>
{
    var sessionId = http.Session.Id;
    await queue.EnqueueAsync(new ChatJob(sessionId, request.Message));
    return Results.Ok(new { status = "accepted" });
});

// Inspect the aggregated MCP tool catalog in the browser, grouped by server. No LLM
// involved — this just proves the connections work. Only servers that connected appear.
app.MapGet("/api/tools", (McpServerRegistry mcp) =>
    Results.Ok(mcp.ToolsByServer.Select(server => new
    {
        server = server.Key,
        toolCount = server.Value.Count,
        tools = server.Value.Select(t => new { t.Name, t.Description })
    })));

// WebSocket endpoint (step 1).
app.Map("/ws", async (HttpContext http, ChatConnectionRegistry registry) =>
{
    if (!http.WebSockets.IsWebSocketRequest)
    {
        http.Response.StatusCode = StatusCodes.Status400BadRequest;
        return;
    }

    var sessionId = http.Session.Id;
    using var socket = await http.WebSockets.AcceptWebSocketAsync();
    await registry.HandleConnectionAsync(sessionId, socket, http.RequestAborted);
});

app.Run();

public record ChatRequest(string Message);
