using System.Collections.Concurrent;
using Microsoft.Extensions.AI;

namespace McpHost;

// Per-session message history — the context the host loop builds on, keyed by session id.
// The LLM is stateless, so the host resends the full history each turn; that history lives
// here. In-memory and single-instance: porting to a multi-instance host would need a
// shared/distributed backing.
//
// The sequential ChatWorker processes one job at a time, so a given session's list is not
// mutated concurrently.
public sealed class ConversationStore
{
    private readonly ConcurrentDictionary<string, List<ChatMessage>> _conversations = new();

    public List<ChatMessage> GetOrCreate(string sessionId) =>
        _conversations.GetOrAdd(sessionId, _ => new List<ChatMessage>
        {
            new(ChatRole.System, "You are a helpful assistant running inside an MCP host.")
        });
}
