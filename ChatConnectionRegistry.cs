using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;

namespace McpHost;

// session id -> live socket. The host writes results here; they land in the right tab.
public sealed class ChatConnectionRegistry
{
    private readonly ConcurrentDictionary<string, WebSocket> _sockets = new();

    // Registers the socket, then blocks reading until the client disconnects.
    // You must keep reading or the socket tears down.
    public async Task HandleConnectionAsync(string sessionId, WebSocket socket, CancellationToken ct)
    {
        _sockets[sessionId] = socket;        // a second tab on this session overwrites the first
        var buffer = new byte[4 * 1024];

        try
        {
            while (socket.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var result = await socket.ReceiveAsync(buffer, ct);
                if (result.MessageType == WebSocketMessageType.Close) break;
                // No inbound socket messages in this design — the POST is the inbound channel.
            }
        }
        catch (OperationCanceledException) { /* shutting down */ }
        catch (WebSocketException) { /* client vanished */ }
        finally
        {
            _sockets.TryRemove(new KeyValuePair<string, WebSocket>(sessionId, socket));
        }
    }

    // Push a result to a session's socket, if one is connected.
    public async Task SendAsync(string sessionId, string message)
    {
        if (_sockets.TryGetValue(sessionId, out var socket) && socket.State == WebSocketState.Open)
        {
            var bytes = Encoding.UTF8.GetBytes(message);
            await socket.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, CancellationToken.None);
        }
    }
}
