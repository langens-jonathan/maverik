import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { SaveNotice } from "../components/SaveNotice.jsx";
import { exportAgentJson } from "../agentExport.js";

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
    version: 0,
  };
}

// "<id>-copy", or "<id>-copy-2", "-3", ... if that's already taken.
function uniqueCopyId(baseId, existingIds) {
  const base = `${baseId}-copy`;
  if (!existingIds.includes(base)) return base;
  let n = 2;
  while (existingIds.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
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
  const [duplicatingIndex, setDuplicatingIndex] = useState(null);
  const [duplicateError, setDuplicateError] = useState(null);

  // Per-agent-id state for the version-history panel: { open, loading, error, versions,
  // viewingVersion, viewLoading, viewError, viewSnapshot }. Keyed by agent id rather than index
  // since versions only ever apply to an already-saved agent (a stable id), unlike row index
  // which shifts when rows are added/removed/duplicated.
  const [versionState, setVersionState] = useState({});
  const [cuttingId, setCuttingId] = useState(null);
  const [cutError, setCutError] = useState(null);
  const [exportingKey, setExportingKey] = useState(null);
  const [exportError, setExportError] = useState(null);

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

  // Copies every field of an existing agent into a new row right below it — the common case is
  // "same tools/model, one tweaked prompt" to A/B against the original. If the source agent uses
  // a file-based prompt (config/prompts/agent/<id>.md, systemPrompt left blank), that file is
  // fetched and inlined into the copy instead of left blank: the new agent has no id yet at this
  // point, so there's no file for it to fall back to — inlining is what makes the duplicate a
  // faithful, self-contained copy rather than a silently-blank prompt.
  async function duplicateAgent(index) {
    const original = data.agents[index];
    setDuplicatingIndex(index);
    setDuplicateError(null);
    try {
      let systemPrompt = original.systemPrompt;
      if (!systemPrompt) {
        const prompt = await api.getPrompt(original.id);
        systemPrompt = prompt.content || null;
      }
      const newId = uniqueCopyId(original.id, data.agents.map((a) => a.id));
      const copy = {
        ...original,
        id: newId,
        name: original.name ? `${original.name} (copy)` : "",
        systemPrompt,
        mcpServers: [...original.mcpServers],
      };
      setData((d) => ({ ...d, agents: [...d.agents.slice(0, index + 1), copy, ...d.agents.slice(index + 1)] }));
    } catch (err) {
      setDuplicateError(`Failed to duplicate '${original.id}': ${err.message}`);
    } finally {
      setDuplicatingIndex(null);
    }
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
      return true;
    } catch (err) {
      setSaveError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  // Cutting a version freezes whatever is currently persisted in agents.json, so this saves
  // first (the page's usual all-agents-at-once save, not a new partial-save concept) — that way
  // the snapshot always matches exactly what's live, with no separate "did I remember to save
  // first" state for the user to track.
  async function cutVersion(index) {
    const agent = data.agents[index];
    if (!agent.id) return;
    setCuttingId(agent.id);
    setCutError(null);
    try {
      const saved = await save();
      if (!saved) {
        setCutError("Save failed — fix the error above before cutting a version.");
        return;
      }
      const res = await api.cutAgentVersion(agent.id);
      updateAgent(index, { version: res.version });
      if (versionState[agent.id]?.open) await loadVersions(agent.id);
    } catch (err) {
      setCutError(`Failed to cut a new version of '${agent.id}': ${err.message}`);
    } finally {
      setCuttingId(null);
    }
  }

  async function loadVersions(agentId) {
    setVersionState((s) => ({ ...s, [agentId]: { ...s[agentId], loading: true, error: null } }));
    try {
      const versions = await api.listAgentVersions(agentId);
      setVersionState((s) => ({ ...s, [agentId]: { ...s[agentId], loading: false, versions } }));
    } catch (err) {
      setVersionState((s) => ({ ...s, [agentId]: { ...s[agentId], loading: false, error: err.message } }));
    }
  }

  function toggleHistory(agentId) {
    const cur = versionState[agentId] || {};
    const open = !cur.open;
    setVersionState((s) => ({ ...s, [agentId]: { ...cur, open } }));
    if (open && !cur.versions) loadVersions(agentId);
  }

  async function viewVersion(agentId, version) {
    setVersionState((s) => ({
      ...s,
      [agentId]: { ...s[agentId], viewingVersion: version, viewLoading: true, viewError: null, viewSnapshot: null },
    }));
    try {
      const snapshot = await api.getAgentVersion(agentId, version);
      setVersionState((s) => ({ ...s, [agentId]: { ...s[agentId], viewLoading: false, viewSnapshot: snapshot } }));
    } catch (err) {
      setVersionState((s) => ({ ...s, [agentId]: { ...s[agentId], viewLoading: false, viewError: err.message } }));
    }
  }

  function closeVersionView(agentId) {
    setVersionState((s) => ({
      ...s,
      [agentId]: { ...s[agentId], viewingVersion: null, viewSnapshot: null, viewError: null },
    }));
  }

  // "Export current" — the live in-memory draft, no version required. Mirrors duplicateAgent's
  // fallback: a file-based prompt (systemPrompt left null) needs inlining or the download would
  // silently omit it.
  async function exportCurrent(index) {
    const agent = data.agents[index];
    if (!agent.id) return;
    const key = agent.id;
    setExportingKey(key);
    setExportError(null);
    try {
      let systemPrompt = agent.systemPrompt;
      if (!systemPrompt) {
        const prompt = await api.getPrompt(agent.id);
        systemPrompt = prompt.content || null;
      }
      exportAgentJson({ ...agent, systemPrompt });
    } catch (err) {
      setExportError(`Failed to export '${agent.id}': ${err.message}`);
    } finally {
      setExportingKey(null);
    }
  }

  async function exportVersion(agentId, version) {
    const key = `${agentId}@${version}`;
    setExportingKey(key);
    setExportError(null);
    try {
      const snapshot = await api.getAgentVersion(agentId, version);
      exportAgentJson(snapshot.config, { version: snapshot.version, cutAt: snapshot.cutAt });
    } catch (err) {
      setExportError(`Failed to export '${agentId}' v${version}: ${err.message}`);
    } finally {
      setExportingKey(null);
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
      {duplicateError && <p className="error-text">{duplicateError}</p>}
      {cutError && <p className="error-text">{cutError}</p>}
      {exportError && <p className="error-text">{exportError}</p>}

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
            <h4>
              {a.id || `agent ${i + 1}`}
              {a.id && <span className="version-badge">{a.version > 0 ? `v${a.version}` : "unversioned"}</span>}
            </h4>
            <div className="config-row-header-actions">
              <button className="secondary" onClick={() => exportCurrent(i)} disabled={!a.id || exportingKey === a.id}>
                {exportingKey === a.id ? "Exporting…" : "Export current"}
              </button>
              <button className="secondary" onClick={() => cutVersion(i)} disabled={!a.id || cuttingId === a.id}>
                {cuttingId === a.id ? "Cutting…" : "Cut new version"}
              </button>
              <button className="secondary" onClick={() => duplicateAgent(i)} disabled={!a.id || duplicatingIndex === i}>
                {duplicatingIndex === i ? "Duplicating…" : "Duplicate"}
              </button>
              <button className="secondary" onClick={() => removeAgent(i)}>
                Remove
              </button>
            </div>
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

          {a.id && (
            <details className="version-history" onToggle={() => toggleHistory(a.id)}>
              <summary>Version history</summary>
              <div className="version-history-body">
                {versionState[a.id]?.loading && <p className="muted">Loading versions…</p>}
                {versionState[a.id]?.error && <p className="error-text">{versionState[a.id].error}</p>}
                {versionState[a.id]?.versions?.length === 0 && (
                  <p className="muted">No versions cut yet — use "Cut new version" above.</p>
                )}
                {versionState[a.id]?.versions?.length > 0 && (
                  <table className="version-history-table">
                    <thead>
                      <tr>
                        <th>Version</th>
                        <th>Cut at</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {versionState[a.id].versions.map((v) => (
                        <tr key={v.version}>
                          <td>v{v.version}</td>
                          <td>{new Date(v.cutAt).toLocaleString()}</td>
                          <td>
                            <button className="secondary" onClick={() => viewVersion(a.id, v.version)}>
                              View
                            </button>
                            <button
                              className="secondary"
                              onClick={() => exportVersion(a.id, v.version)}
                              disabled={exportingKey === `${a.id}@${v.version}`}
                            >
                              {exportingKey === `${a.id}@${v.version}` ? "Exporting…" : "Export"}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {versionState[a.id]?.viewingVersion != null && (
                  <div className="version-snapshot-view">
                    <div className="config-row-header">
                      <strong>v{versionState[a.id].viewingVersion}</strong>
                      <button className="secondary" onClick={() => closeVersionView(a.id)}>
                        Close
                      </button>
                    </div>
                    {versionState[a.id].viewLoading && <p className="muted">Loading…</p>}
                    {versionState[a.id].viewError && <p className="error-text">{versionState[a.id].viewError}</p>}
                    {versionState[a.id].viewSnapshot && (
                      <pre className="version-snapshot-json">
                        {JSON.stringify(versionState[a.id].viewSnapshot.config, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </details>
          )}
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
