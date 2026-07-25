using ModelContextProtocol.Client;
using McpHost.Config;

namespace McpHost.Mcp;

// Turns one McpServerConfig into a live, connected McpClient.
// Named to avoid colliding with the SDK's own McpClientFactory type.
public static class McpConnectionFactory
{
    public static async Task<McpClient> ConnectAsync(McpServerConfig config, CancellationToken ct)
    {
        return config.Transport.ToLowerInvariant() switch
        {
            "http" => await ConnectHttpAsync(config, ct),
            _ => throw new InvalidOperationException(
                     $"Unsupported transport '{config.Transport}' for server '{config.Name}'.")
        };
    }

    private static async Task<McpClient> ConnectHttpAsync(McpServerConfig config, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(config.Endpoint))
            throw new InvalidOperationException($"Server '{config.Name}' is http but has no endpoint.");

        // Expand ${ENV_VAR} placeholders in header values so secrets live in environment
        // variables, never in the committed config file.
        var headers = config.Headers.ToDictionary(kv => kv.Key, kv => EnvExpansion.Expand(kv.Value));

        var transport = new HttpClientTransport(new HttpClientTransportOptions
        {
            Name = config.Name,
            Endpoint = new Uri(config.Endpoint),
            TransportMode = HttpTransportMode.StreamableHttp,
            AdditionalHeaders = headers
        });

        // CreateAsync performs the MCP initialize handshake. A bad token surfaces here as an
        // HttpRequestException with a 401.
        return await McpClient.CreateAsync(transport, cancellationToken: ct);
    }
}
