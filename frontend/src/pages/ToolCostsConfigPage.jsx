import { useEffect, useState } from "react";
import { api } from "../api.js";
import { SaveNotice } from "../components/SaveNotice.jsx";

function emptyEntry() {
  return { mcpServer: "", tool: "", costPerInvocation: 0 };
}

export function ToolCostsConfigPage() {
  const [data, setData] = useState(null);
  const [serverNames, setServerNames] = useState([]);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.getToolCostsConfig(), api.getMcpServersConfig()])
      .then(([toolCostsRes, serversRes]) => {
        setData(toolCostsRes.data);
        setBootstrapped(toolCostsRes.bootstrapped);
        setServerNames(serversRes.data.servers.map((s) => s.name));
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  function updateEntry(index, patch) {
    setData((d) => ({
      ...d,
      toolCosts: d.toolCosts.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }));
  }

  function addEntry() {
    setData((d) => ({ ...d, toolCosts: [...d.toolCosts, emptyEntry()] }));
  }

  function removeEntry(index) {
    setData((d) => ({ ...d, toolCosts: d.toolCosts.filter((_, i) => i !== index) }));
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    setResult(null);
    try {
      const res = await api.saveToolCostsConfig(data);
      setResult(res);
      setBootstrapped(false);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="error-text">Failed to load tool-costs.json: {loadError}</p>;
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
      <p className="field-hint" style={{ marginBottom: "1rem" }}>
        Cost of a single invocation of a given tool. A tool with no entry here costs 0 — most
        tools are free; only add the ones that aren't.
      </p>

      {data.toolCosts.map((t, i) => (
        <div className="config-row" key={i}>
          <div className="config-row-header">
            <h4>{t.mcpServer && t.tool ? `${t.mcpServer} / ${t.tool}` : `entry ${i + 1}`}</h4>
            <button className="secondary" onClick={() => removeEntry(i)}>
              Remove
            </button>
          </div>

          <div className="field-row">
            <div>
              <label>MCP server</label>
              <select value={t.mcpServer} onChange={(e) => updateEntry(i, { mcpServer: e.target.value })}>
                <option value="">— select —</option>
                {serverNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Tool name</label>
              <input type="text" value={t.tool} onChange={(e) => updateEntry(i, { tool: e.target.value })} />
            </div>
            <div>
              <label>Cost per invocation</label>
              <input
                type="number"
                step="0.01"
                value={t.costPerInvocation}
                onChange={(e) => updateEntry(i, { costPerInvocation: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>
      ))}

      <div className="config-toolbar">
        <button className="secondary add-row-btn" onClick={addEntry}>
          + Add tool cost
        </button>
        <div className="spacer" />
        <button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
