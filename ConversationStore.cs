using System.Collections.Concurrent;
using Microsoft.Extensions.AI;

namespace McpHost;

// Holds the running message history per session — this is the "context" the host loop
// builds on, keyed by the same session id used everywhere else. The LLM is stateless:
// it keeps no memory between calls, so the host must resend the full history each turn.
// That history lives here.
//
// Note: the sequential ChatWorker processes one job at a time, so a given session's
// list isn't mutated concurrently. If you later parallelize the worker, revisit this
// (e.g. lock per session, or make the list copy-on-write).
public sealed class ConversationStore
{
    private readonly ConcurrentDictionary<string, List<ChatMessage>> _conversations = new();

    public List<ChatMessage> GetOrCreate(string sessionId) =>
        _conversations.GetOrAdd(sessionId, _ => new List<ChatMessage>
        {
            new(ChatRole.System, "You are a helpful assistant running inside an MCP host.")
        });
}
