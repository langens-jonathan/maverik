import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { SaveNotice } from "../components/SaveNotice.jsx";

function emptyServer() {
  return { name: "", description: "", transport: "http", endpoint: "", headers: {} };
}

export function McpServersConfigPage() {
  const [data, setData] = useState(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);

  // Landing target for Compare Versions' tool-usage-flow chart: ?servers=a,b,c highlights the
  // named servers (an agent's whole configured mcpServers set — this page has no per-tool
  // ownership data, so it can't pinpoint a single server for a single tool, see
  // charts/toolUsageFlow.js's own header comment). Names are passed directly rather than an
  // agentId since this page never fetches agents.json. searchParams.get already fully decodes the
  // param value (URLSearchParams' own encoding, built by comparison/links.js's mcpServersHref),
  // so no per-token decodeURIComponent here — that would double-decode.
  const [searchParams] = useSearchParams();
  const highlightedServers = useMemo(() => {
    const raw = searchParams.get("servers");
    if (!raw) return new Set();
    return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
  }, [searchParams]);
  const rowRefs = useRef({});

  useEffect(() => {
    api
      .getMcpServersConfig()
      .then((res) => {
        setData(res.data);
        setBootstrapped(res.bootstrapped);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  useEffect(() => {
    if (!data || highlightedServers.size === 0) return;
    const first = data.servers.find((s) => highlightedServers.has(s.name));
    first && rowRefs.current[first.name]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [data, highlightedServers]);

  function updateServer(index, patch) {
    setData((d) => ({
      ...d,
      servers: d.servers.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  }

  function addServer() {
    setData((d) => ({ ...d, servers: [...d.servers, emptyServer()] }));
  }

  function removeServer(index) {
    setData((d) => ({ ...d, servers: d.servers.filter((_, i) => i !== index) }));
  }

  function headerEntries(server) {
    return Object.entries(server.headers ?? {});
  }

  function updateHeader(serverIndex, headerIndex, key, value) {
    setData((d) => ({
      ...d,
      servers: d.servers.map((s, i) => {
        if (i !== serverIndex) return s;
        const entries = headerEntries(s);
        entries[headerIndex] = [key, value];
        return { ...s, headers: Object.fromEntries(entries) };
      }),
    }));
  }

  function addHeader(serverIndex) {
    setData((d) => ({
      ...d,
      servers: d.servers.map((s, i) => {
        if (i !== serverIndex) return s;
        const entries = headerEntries(s);
        entries.push(["", ""]);
        return { ...s, headers: Object.fromEntries(entries) };
      }),
    }));
  }

  function removeHeader(serverIndex, headerIndex) {
    setData((d) => ({
      ...d,
      servers: d.servers.map((s, i) => {
        if (i !== serverIndex) return s;
        const entries = headerEntries(s);
        entries.splice(headerIndex, 1);
        return { ...s, headers: Object.fromEntries(entries) };
      }),
    }));
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    setResult(null);
    try {
      const res = await api.saveMcpServersConfig(data);
      setResult(res);
      setBootstrapped(false);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="error-text">Failed to load mcp-servers.json: {loadError}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div>
      <SaveNotice
        bootstrapped={bootstrapped}
        onDismissBootstrapped={() => setBootstrapped(false)}
        result={result}
        onDismissResult={() => setResult(null)}
      />
      {saveError && <p className="error-text">{saveError}</p>}

      {data.servers.map((s, i) => (
        <div
          className={`config-row${s.name && highlightedServers.has(s.name) ? " is-highlighted" : ""}`}
          key={i}
          ref={(el) => {
            if (s.name) rowRefs.current[s.name] = el;
          }}
        >
          <div className="config-row-header">
            <h4>{s.name || `server ${i + 1}`}</h4>
            <button className="secondary" onClick={() => removeServer(i)}>
              Remove
            </button>
          </div>

          <div className="field-row">
            <div>
              <label>Name</label>
              <input type="text" value={s.name} onChange={(e) => updateServer(i, { name: e.target.value })} />
            </div>
            <div>
              <label>Transport</label>
              <input
                type="text"
                value={s.transport ?? "http"}
                onChange={(e) => updateServer(i, { transport: e.target.value })}
              />
              <p className="field-hint">Only "http" is currently implemented.</p>
            </div>
          </div>

          <label>Description</label>
          <input
            type="text"
            value={s.description ?? ""}
            onChange={(e) => updateServer(i, { description: e.target.value })}
          />

          <label>Endpoint</label>
          <input
            type="text"
            value={s.endpoint ?? ""}
            onChange={(e) => updateServer(i, { endpoint: e.target.value })}
          />

          <label>Headers</label>
          {headerEntries(s).map(([key, value], hi) => (
            <div className="kv-row" key={hi}>
              <input
                type="text"
                placeholder="Header name"
                value={key}
                onChange={(e) => updateHeader(i, hi, e.target.value, value)}
              />
              <input
                type="text"
                placeholder="Value, e.g. Bearer ${SOME_MCP_PAT}"
                value={value}
                onChange={(e) => updateHeader(i, hi, key, e.target.value)}
              />
              <button className="secondary" onClick={() => removeHeader(i, hi)}>
                Remove
              </button>
            </div>
          ))}
          <button className="secondary add-row-btn" onClick={() => addHeader(i)}>
            + Add header
          </button>
        </div>
      ))}

      <div className="config-toolbar">
        <button className="secondary add-row-btn" onClick={addServer}>
          + Add server
        </button>
        <div className="spacer" />
        <button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
