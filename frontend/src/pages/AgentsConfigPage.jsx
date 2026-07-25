import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { SaveNotice } from "../components/SaveNotice.jsx";

function emptyAgent() {
  return {
    id: "",
    name: "",
    description: "",
    model: "",
    loopType: "manual",
    systemPrompt: null,
    mcpServers: [],
    maxIterations: 8,
  };
}

export function AgentsConfigPage() {
  const [data, setData] = useState(null);
  const [modelIds, setModelIds] = useState([]);
  const [serverNames, setServerNames] = useState([]);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([api.getAgentsConfig(), api.getLlmModelsConfig(), api.getMcpServersConfig()])
      .then(([agentsRes, modelsRes, serversRes]) => {
        setData(agentsRes.data);
        setBootstrapped(agentsRes.bootstrapped);
        setModelIds(modelsRes.data.models.map((m) => m.id));
        setServerNames(serversRes.data.servers.map((s) => s.name));
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  function updateAgent(index, patch) {
    setData((d) => ({
      ...d,
      agents: d.agents.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    }));
  }

  function addAgent() {
    setData((d) => ({ ...d, agents: [...d.agents, emptyAgent()] }));
  }

  function removeAgent(index) {
    setData((d) => ({ ...d, agents: d.agents.filter((_, i) => i !== index) }));
  }

  function toggleServer(index, server, checked) {
    setData((d) => ({
      ...d,
      agents: d.agents.map((a, i) => {
        if (i !== index) return a;
        const servers = checked ? [...a.mcpServers, server] : a.mcpServers.filter((s) => s !== server);
        return { ...a, mcpServers: servers };
      }),
    }));
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    setResult(null);
    try {
      const res = await api.saveAgentsConfig(data);
      setResult(res);
      setBootstrapped(false);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="error-text">Failed to load agents.json: {loadError}</p>;
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

      <div className="card">
        <label>Default agent</label>
        <select
          value={data.defaultAgent}
          onChange={(e) => setData((d) => ({ ...d, defaultAgent: e.target.value }))}
        >
          <option value="">— select —</option>
          {data.agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id || "(unnamed)"}
            </option>
          ))}
        </select>
      </div>

      {data.agents.map((a, i) => (
        <div className="config-row" key={i}>
          <div className="config-row-header">
            <h4>{a.id || `agent ${i + 1}`}</h4>
            <button className="secondary" onClick={() => removeAgent(i)}>
              Remove
            </button>
          </div>

          <div className="field-row">
            <div>
              <label>Id</label>
              <input type="text" value={a.id} onChange={(e) => updateAgent(i, { id: e.target.value })} />
            </div>
            <div>
              <label>Name</label>
              <input type="text" value={a.name} onChange={(e) => updateAgent(i, { name: e.target.value })} />
            </div>
          </div>

          <label>Description</label>
          <input
            type="text"
            value={a.description ?? ""}
            onChange={(e) => updateAgent(i, { description: e.target.value })}
          />

          <div className="field-row">
            <div>
              <label>Model</label>
              <select value={a.model} onChange={(e) => updateAgent(i, { model: e.target.value })}>
                <option value="">— select —</option>
                {modelIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Loop type</label>
              <select value={a.loopType ?? "manual"} onChange={(e) => updateAgent(i, { loopType: e.target.value })}>
                <option value="manual">manual</option>
                <option value="parallel-tools">parallel-tools</option>
              </select>
            </div>
            <div>
              <label>Max iterations</label>
              <input
                type="number"
                value={a.maxIterations ?? 8}
                onChange={(e) => updateAgent(i, { maxIterations: Number(e.target.value) })}
              />
            </div>
          </div>

          <label>MCP servers</label>
          <div className="checkbox-list">
            {serverNames.map((name) => (
              <label key={name}>
                <input
                  type="checkbox"
                  checked={a.mcpServers.includes(name)}
                  onChange={(e) => toggleServer(i, name, e.target.checked)}
                />
                {name}
              </label>
            ))}
          </div>

          <label>Inline system prompt (optional)</label>
          <textarea
            value={a.systemPrompt ?? ""}
            onChange={(e) => updateAgent(i, { systemPrompt: e.target.value === "" ? null : e.target.value })}
            placeholder="Leave blank to use config/prompts/agent/<id>.md instead"
            rows={4}
          />
          <p className="field-hint">
            Blank uses the file-based prompt — edit it on the <Link to="/config/prompts">Prompts</Link> tab.
          </p>
        </div>
      ))}

      <div className="config-toolbar">
        <button className="secondary add-row-btn" onClick={addAgent}>
          + Add agent
        </button>
        <div className="spacer" />
        <button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
