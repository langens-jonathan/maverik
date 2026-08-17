using System.Collections.Concurrent;
using Microsoft.Extensions.AI;

namespace McpHost.Chat;

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

    // The session's context size as of the end of its last turn (TurnResult.PeakContextTokens),
    // so ContextCutoff has something real to compare against before a new turn's very first
    // GetResponseAsync call — a fresh call has no usage of its own yet at that point. Null until
    // at least one turn has completed with real usage. See ChatWorker/ContextCutoff.
    private readonly ConcurrentDictionary<string, long?> _lastKnownContextTokens = new();

    // Returns the session's history, creating it seeded with the given system prompt (the agent's)
    // on first use. The prompt only applies at creation — a later call with a different prompt is
    // ignored for an existing session (agents don't switch mid-session yet).
    public List<ChatMessage> GetOrCreate(string sessionId, string systemPrompt) =>
        _conversations.GetOrAdd(sessionId, _ => new List<ChatMessage>
        {
            new(ChatRole.System, systemPrompt)
        });

    // Same as above, but for a pre-built system ChatMessage — used when the agent has prompt
    // caching enabled (see AnthropicCacheControl) and the caller already built a cache-controlled
    // message rather than a plain string.
    public List<ChatMessage> GetOrCreate(string sessionId, ChatMessage systemMessage) =>
        _conversations.GetOrAdd(sessionId, _ => new List<ChatMessage> { systemMessage });

    public long? GetLastKnownContextTokens(string sessionId) =>
        _lastKnownContextTokens.GetValueOrDefault(sessionId);

    public void SetLastKnownContextTokens(string sessionId, long? tokens) =>
        _lastKnownContextTokens[sessionId] = tokens;
}
