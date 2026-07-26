import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { usePolling } from "../hooks/usePolling.js";

function newSessionId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `s${Date.now()}${Math.random()}`;
}

// A minimal REPL for exercising one agent at a time — pick an agent, talk to it, watch tool
// calls happen as progress lines. This is what replaced wwwroot/index.html: the backend is now
// API-only (no static front end), and this page speaks the same POST /api/chat + poll
// /api/messages protocol that reference client used, just with an agent picker and a proper UI.
//
// Conversations are identified by an opaque X-Session-Id header this page mints itself (see
// api.js) rather than a cookie — switching agents or hitting "New conversation" just mints a
// fresh id and starts polling under it; there's nothing server-side to reset.
export function ChatPage() {
  const [agentsData, setAgentsData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [agentId, setAgentId] = useState("");
  const [sessionId, setSessionId] = useState(newSessionId);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [sendError, setSendError] = useState(null);
  const logRef = useRef(null);

  useEffect(() => {
    api
      .listAgents()
      .then((data) => {
        setAgentsData(data);
        setAgentId(data.defaultAgent || data.agents[0]?.id || "");
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, awaitingReply]);

  const { data: pollResult } = usePolling(() => api.pollMessages(sessionId), 1000, !!agentId);

  useEffect(() => {
    if (!pollResult?.messages?.length) return;
    const incoming = pollResult.messages.map((text) => ({
      role: text.startsWith("(") ? "progress" : "assistant",
      text,
    }));
    // Progress lines ("(calling tool...)") don't end the wait — only the real answer does.
    if (incoming.some((m) => m.role === "assistant")) setAwaitingReply(false);
    setMessages((m) => [...m, ...incoming]);
  }, [pollResult]);

  function startNewConversation(nextAgentId) {
    setSessionId(newSessionId());
    setMessages([]);
    setAwaitingReply(false);
    setSendError(null);
    if (nextAgentId) setAgentId(nextAgentId);
  }

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setSendError(null);
    setAwaitingReply(true);
    try {
      await api.sendChatMessage(sessionId, text, agentId);
    } catch (err) {
      setAwaitingReply(false);
      setSendError(err.message);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  if (loadError) return <p className="error-text">Failed to load agents: {loadError}</p>;
  if (!agentsData) return <p className="muted">Loading…</p>;
  if (agentsData.agents.length === 0)
    return <p className="muted">No agents configured yet — add one under Config &gt; Agents.</p>;

  const selectedAgent = agentsData.agents.find((a) => a.id === agentId);

  return (
    <div className="chat-page">
      <div className="chat-toolbar">
        <div>
          <label>Agent</label>
          <select value={agentId} onChange={(e) => startNewConversation(e.target.value)}>
            {agentsData.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name || a.id}
              </option>
            ))}
          </select>
        </div>
        <button className="secondary" onClick={() => startNewConversation()}>
          New conversation
        </button>
      </div>

      {selectedAgent?.description && <p className="field-hint">{selectedAgent.description}</p>}

      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && (
          <p className="muted">Say something to {selectedAgent?.name || agentId}.</p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg ${m.role}`}>
            {m.text}
          </div>
        ))}
        {awaitingReply && <div className="chat-msg progress">…</div>}
      </div>

      {sendError && <p className="error-text">{sendError}</p>}

      <div className="chat-input-row">
        <textarea
          rows={2}
          value={input}
          placeholder="Ask something…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button onClick={send} disabled={!input.trim()}>
          Send
        </button>
      </div>
    </div>
  );
}
