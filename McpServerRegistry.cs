using ModelContextProtocol.Client;

namespace McpHost;

// Owns the host's MCP clients (one per server) and the aggregated tool catalog.
// Connects every configured server once at startup — valid here because all servers use a
// static credential, so one shared session serves every user. A server needing per-user auth
// could not be shared this way.
//
// Registered as both a singleton (endpoints and the worker read the catalog) and a hosted
// service (connect on startup, dispose on shutdown) — the same instance for both.
public sealed class McpServerRegistry(
    IReadOnlyList<McpServerConfig> configs,
    ILogger<McpServerRegistry> log) : IHostedService
{
    private readonly Dictionary<string, McpClient> _clients = new();
    private readonly List<McpClientTool> _tools = new();
    private readonly Dictionary<string, IReadOnlyList<McpClientTool>> _toolsByServer = new();

    // Flat tool catalog across all servers — handed to the LLM each turn.
    public IReadOnlyList<McpClientTool> Tools => _tools;
    public IReadOnlyDictionary<string, McpClient> Clients => _clients;

    // The same tools grouped by the server that contributed them (used by /api/tools).
    public IReadOnlyDictionary<string, IReadOnlyList<McpClientTool>> ToolsByServer => _toolsByServer;

    // The tools contributed by just the named servers — an agent's allowed subset, filtered from
    // the already-connected catalog (no reconnect). Unknown names are skipped with a warning so a
    // typo in agents.json doesn't crash the loop.
    public IReadOnlyList<McpClientTool> ToolsForServers(IEnumerable<string> serverNames)
    {
        var tools = new List<McpClientTool>();
        foreach (var name in serverNames)
        {
            if (_toolsByServer.TryGetValue(name, out var serverTools))
                tools.AddRange(serverTools);
            else
                log.LogWarning("Agent references unknown MCP server '{Name}'; skipping.", name);
        }
        return tools;
    }

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
                _toolsByServer[config.Name] = tools.ToList();

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
