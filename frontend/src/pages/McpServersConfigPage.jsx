import { useEffect, useState } from "react";
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

  useEffect(() => {
    api
      .getMcpServersConfig()
      .then((res) => {
        setData(res.data);
        setBootstrapped(res.bootstrapped);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

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
        <div className="config-row" key={i}>
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
