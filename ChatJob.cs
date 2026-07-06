namespace McpHost;

// One unit of work for the host loop: a user message tied to the session it came from (so the
// worker knows which outbox to write to) and the agent chosen to handle it.
public record ChatJob(string SessionId, string Message, string AgentId);
