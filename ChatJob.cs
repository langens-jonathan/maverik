namespace McpHost;

// One unit of work for the host loop: a user message tied to the session it came from,
// so the worker knows which WebSocket to push the answer back to.
public record ChatJob(string SessionId, string Message);
