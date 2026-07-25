namespace McpHost.LlmModel;

// Runtime on/off switch for LLM wire logging (see LlmLoggingHandler) — whether every raw
// request/response to the LLM provider gets written to logs/{sessionId}.log, covering both
// interactive chat sessions and MAVERIK runs (both tag LlmLogContext.SessionId per turn).
//
// Distinct from MCPHOST_LLM_DEBUG: that env var only sets the value at container start (an
// operator's fixed choice), this is a mutable singleton so the value can also be flipped at
// runtime via POST /api/dev-mode without a restart. The env var still sets the STARTING value
// (Program.cs constructs this with it) — flipping this alone isn't enough on its own, though;
// see LLMModelRegistry.SetDevMode, which is what actually rebuilds the wire-logging HttpClient
// and re-wires every model's IChatClient to use (or stop using) it.
public sealed class DevModeState(bool initialValue)
{
    public bool Enabled { get; private set; } = initialValue;

    public void Set(bool enabled) => Enabled = enabled;
}
