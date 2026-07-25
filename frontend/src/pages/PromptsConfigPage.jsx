import { useEffect, useState } from "react";
import { api } from "../api.js";
import { SaveNotice } from "../components/SaveNotice.jsx";

export function PromptsConfigPage() {
  const [agentIds, setAgentIds] = useState([]);
  const [selected, setSelected] = useState("");
  const [content, setContent] = useState("");
  const [bootstrapped, setBootstrapped] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingPrompt, setLoadingPrompt] = useState(false);

  useEffect(() => {
    api
      .getAgentsConfig()
      .then((res) => {
        const ids = res.data.agents.map((a) => a.id).filter(Boolean);
        setAgentIds(ids);
        if (ids.length > 0) setSelected(ids[0]);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setLoadingPrompt(true);
    setSaved(false);
    setSaveError(null);
    api
      .getPrompt(selected)
      .then((res) => {
        setContent(res.content);
        setBootstrapped(res.bootstrapped);
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoadingPrompt(false));
  }, [selected]);

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await api.savePrompt(selected, content);
      setSaved(true);
      setBootstrapped(false);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="error-text">Failed to load agents: {loadError}</p>;
  if (agentIds.length === 0) return <p className="muted">No agents configured yet — add one on the Agents tab first.</p>;

  return (
    <div>
      <div className="card">
        <label>Agent</label>
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {agentIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </div>

      <SaveNotice
        bootstrapped={bootstrapped}
        onDismissBootstrapped={() => setBootstrapped(false)}
        saved={saved}
        onDismissSaved={() => setSaved(false)}
      />
      {saveError && <p className="error-text">{saveError}</p>}

      {loadingPrompt ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <textarea
            className="prompt-editor mono"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <p className="field-hint">
            Saved to config/prompts/agent/{selected}.md. Only used if the agent's inline system prompt
            (Agents tab) is blank.
          </p>
          <div className="config-toolbar">
            <div className="spacer" />
            <button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
