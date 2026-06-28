using ModelContextProtocol.Client;

namespace McpHost;

// Owns the host's MCP clients (one per server) and the aggregated tool catalog.
// Connects every configured server once at startup — valid here precisely because
// all servers use a static credential, so one shared session serves every user.
// (A server needing per-user auth could NOT be shared this way — the auth model
// decides the session model.)
//
// Registered as both a singleton (endpoints/worker read the catalog) and a hosted
// service (connect on startup, dispose on shutdown) — the same instance for both.
public sealed class McpServerRegistry(
    IReadOnlyList<McpServerConfig> configs,
    ILogger<McpServerRegistry> log) : IHostedService
{
    private readonly Dictionary<string, McpClient> _clients = new();
    private readonly List<McpClientTool> _tools = new();

    // Flat tool catalog across all servers — what step 4 hands to the LLM.
    public IReadOnlyList<McpClientTool> Tools => _tools;
    public IReadOnlyDictionary<string, McpClient> Clients => _clients;

    public async Task StartAsync(CancellationToken ct)
    {
        foreach (var config in configs)
        {
            try
            {
                log.LogInformation("Connecting MCP server '{Name}' ({Transport})...",
                    config.Name, config.Transport);

                var client = await McpConnectionFactory.ConnectAsync(config, ct);
                var tools = await client.ListToolsAsync(cancellationToken: ct);

                _clients[config.Name] = client;
                _tools.AddRange(tools);

                log.LogInformation("  '{Name}' connected: {Count} tools.", config.Name, tools.Count);
                foreach (var tool in tools)
                    log.LogInformation("    - {Tool}: {Desc}", tool.Name, Trim(tool.Description));
            }
            catch (Exception ex)
            {
                // One server failing must not stop the host from starting.
                log.LogError(ex, "Failed to connect MCP server '{Name}'. Skipping it.", config.Name);
            }
        }

        log.LogInformation("MCP catalog ready: {Servers} server(s), {Tools} tool(s).",
            _clients.Count, _tools.Count);
    }

    public async Task StopAsync(CancellationToken ct)
    {
        foreach (var client in _clients.Values)
            await client.DisposeAsync();
    }

    private static string Trim(string? s) =>
        string.IsNullOrEmpty(s) ? "" : (s.Length <= 80 ? s : s[..80] + "...");
}
