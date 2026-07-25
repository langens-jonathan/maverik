namespace McpHost.LlmModel;

// Ambient carrier for the current chat session id, so the wire-logging DelegatingHandler can
// tag each raw HTTP request/response with the session it belongs to. The handler only sees an
// HttpRequestMessage — it has no other way to know which session triggered the call.
//
// ChatWorker sets this before each LLM turn. AsyncLocal flows across awaits into the handler,
// and because the worker is a single sequential consumer, only one exchange is ever in flight
// under a given value at a time.
public static class LlmLogContext
{
    private static readonly AsyncLocal<string?> _sessionId = new();

    public static string? SessionId
    {
        get => _sessionId.Value;
        set => _sessionId.Value = value;
    }
}
