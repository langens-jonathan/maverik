using System.Text.RegularExpressions;
using ModelContextProtocol.Client;

namespace McpHost;

// Turns one McpServerConfig into a live, connected McpClient. Branches on transport.
// Named to avoid colliding with the SDK's own McpClientFactory type.
public static class McpConnectionFactory
{
    public static async Task<McpClient> ConnectAsync(McpServerConfig config, CancellationToken ct)
    {
        return config.Transport.ToLowerInvariant() switch
        {
            "http"  => await ConnectHttpAsync(config, ct),
            "stdio" => throw new NotSupportedException(
                           $"stdio transport ('{config.Name}') arrives in step 5."),
            _       => throw new InvalidOperationException(
                           $"Unknown transport '{config.Transport}' for server '{config.Name}'.")
        };
    }

    private static async Task<McpClient> ConnectHttpAsync(McpServerConfig config, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(config.Endpoint))
            throw new InvalidOperationException($"Server '{config.Name}' is http but has no endpoint.");

        // Expand ${ENV_VAR} placeholders in header values, so secrets like the PAT live
        // in environment variables and never in the committed config file.
        var headers = config.Headers.ToDictionary(kv => kv.Key, kv => ExpandEnv(kv.Value));

        var transport = new HttpClientTransport(new HttpClientTransportOptions
        {
            Name = config.Name,
            Endpoint = new Uri(config.Endpoint),
            TransportMode = HttpTransportMode.StreamableHttp,   // GitHub speaks streamable HTTP
            AdditionalHeaders = headers
        });

        // CreateAsync performs the MCP initialize handshake. A bad token surfaces here
        // as an HttpRequestException with a 401.
        return await McpClient.CreateAsync(transport, cancellationToken: ct);
    }

    // Replaces every "${NAME}" in the string with environment variable NAME.
    // Handles embedded placeholders, e.g. "Bearer ${GITHUB_MCP_PAT}".
    private static string ExpandEnv(string value) =>
        Regex.Replace(value, @"\$\{(\w+)\}", m =>
        {
            var name = m.Groups[1].Value;
            return Environment.GetEnvironmentVariable(name)
                   ?? throw new InvalidOperationException($"Environment variable '{name}' is not set.");
        });
}
