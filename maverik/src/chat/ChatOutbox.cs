using System.Collections.Concurrent;

namespace McpHost.Chat;

// Per-session buffer of outbound messages awaiting delivery. The ChatWorker appends progress
// lines and final answers here; the client drains them by polling GET /api/messages. This is
// the pull-based replacement for a push-based WebSocket channel, for environments where
// WebSockets aren't available.
//
// In-memory and single-instance, like ConversationStore: a multi-instance host would need a
// shared/distributed backing so a poll can reach whichever instance produced the message.
public sealed class ChatOutbox
{
    private readonly ConcurrentDictionary<string, ConcurrentQueue<string>> _outbox = new();

    // Called by the worker to queue a message for a session.
    public void Add(string sessionId, string message) =>
        _outbox.GetOrAdd(sessionId, _ => new ConcurrentQueue<string>()).Enqueue(message);

    // Called by the poll endpoint: returns all queued messages for a session and clears them.
    public IReadOnlyList<string> Drain(string sessionId)
    {
        if (!_outbox.TryGetValue(sessionId, out var queue))
            return Array.Empty<string>();

        var messages = new List<string>();
        while (queue.TryDequeue(out var message))
            messages.Add(message);
        return messages;
    }
}
