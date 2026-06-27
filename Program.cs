using McpHost;

var builder = WebApplication.CreateBuilder(args);

// In-memory session store. Fine for a learning harness; not durable, doesn't scale
// across multiple servers. The session id is what correlates the POST and the socket.
builder.Services.AddDistributedMemoryCache();
builder.Services.AddSession(options =>
{
    options.Cookie.Name = ".McpHost.Session";
    options.Cookie.HttpOnly = true;
    options.Cookie.IsEssential = true; // ignore GDPR
    options.IdleTimeout = TimeSpan.FromHours(2);
});

// Shared map of session id -> live WebSocket. Singleton because it must be the same
// instance across every request.
builder.Services.AddSingleton<ChatConnectionRegistry>();

var app = builder.Build();

app.UseDefaultFiles();   // serve wwwroot/index.html at "/"
app.UseStaticFiles();
app.UseWebSockets();
app.UseSession();        // must run before any endpoint that touches Session

// (a) Establish the session cookie BEFORE the socket opens, so both resolve to the
//     same session. ASP.NET only persists the session (and issues the cookie) once
//     you actually write a value to it.
app.MapPost("/api/session", async (HttpContext http) =>
{
    http.Session.SetString("touched", "1");
    await http.Session.CommitAsync();
    return Results.Ok(new { sessionId = http.Session.Id });
});

// (b) The message endpoint the form submits to.
app.MapPost("/api/chat", (ChatRequest request, HttpContext http, ChatConnectionRegistry registry) =>
{
    var sessionId = http.Session.Id;

    // Kick off the (eventually long-running) work WITHOUT awaiting, so the request
    // returns immediately. Step 1 just echoes after a delay to simulate the LLM.
    // Task.Run fire-and-forget is OK for a stub but unsafe for real work (no error
    // surface, dies on shutdown). Step 2 replaces this with a Channel + BackgroundService.
    _ = Task.Run(async () =>
    {
        await Task.Delay(1000);
        await registry.SendAsync(sessionId, $"(stub) host received: \"{request.Message}\"");
    });

    return Results.Ok(new { status = "accepted" });   // real answer arrives over the socket
});

// (c) The WebSocket endpoint. Parks the socket in the registry under the SAME session id.
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

// Shape of the POST body: { "message": "..." }
public record ChatRequest(string Message);
