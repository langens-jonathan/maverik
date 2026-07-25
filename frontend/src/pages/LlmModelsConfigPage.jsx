import { useEffect, useState } from "react";
import { api } from "../api.js";
import { SaveNotice } from "../components/SaveNotice.jsx";

function emptyModel() {
  return {
    id: "",
    provider: "openai-compatible",
    model: "",
    endpoint: "",
    apiKey: "",
    supportsTools: true,
    inputPricePerMTok: null,
    outputPricePerMTok: null,
  };
}

export function LlmModelsConfigPage() {
  const [data, setData] = useState(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getLlmModelsConfig()
      .then((res) => {
        setData(res.data);
        setBootstrapped(res.bootstrapped);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  function updateModel(index, patch) {
    setData((d) => ({
      ...d,
      models: d.models.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    }));
  }

  function addModel() {
    setData((d) => ({ ...d, models: [...d.models, emptyModel()] }));
  }

  function removeModel(index) {
    setData((d) => ({ ...d, models: d.models.filter((_, i) => i !== index) }));
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await api.saveLlmModelsConfig(data);
      setSaved(true);
      setBootstrapped(false);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="error-text">Failed to load llm-models.json: {loadError}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div>
      <SaveNotice
        bootstrapped={bootstrapped}
        onDismissBootstrapped={() => setBootstrapped(false)}
        saved={saved}
        onDismissSaved={() => setSaved(false)}
      />
      {saveError && <p className="error-text">{saveError}</p>}

      <div className="card">
        <label>Default model</label>
        <select
          value={data.defaultModelId}
          onChange={(e) => setData((d) => ({ ...d, defaultModelId: e.target.value }))}
        >
          <option value="">— select —</option>
          {data.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id || "(unnamed)"}
            </option>
          ))}
        </select>
      </div>

      {data.models.map((m, i) => (
        <div className="config-row" key={i}>
          <div className="config-row-header">
            <h4>{m.id || `model ${i + 1}`}</h4>
            <button className="secondary" onClick={() => removeModel(i)}>
              Remove
            </button>
          </div>

          <div className="field-row">
            <div>
              <label>Id</label>
              <input
                type="text"
                value={m.id}
                onChange={(e) => updateModel(i, { id: e.target.value })}
              />
            </div>
            <div>
              <label>Provider</label>
              <select value={m.provider ?? "openai-compatible"} onChange={(e) => updateModel(i, { provider: e.target.value })}>
                <option value="anthropic">anthropic</option>
                <option value="openai-compatible">openai-compatible</option>
              </select>
            </div>
            <div>
              <label>Model name</label>
              <input
                type="text"
                value={m.model ?? ""}
                onChange={(e) => updateModel(i, { model: e.target.value })}
                placeholder="e.g. claude-haiku-4-5"
              />
            </div>
          </div>

          <div className="field-row">
            <div>
              <label>Endpoint</label>
              <input
                type="text"
                value={m.endpoint ?? ""}
                onChange={(e) => updateModel(i, { endpoint: e.target.value })}
                placeholder="used by openai-compatible only"
              />
            </div>
            <div>
              <label>API key</label>
              <input
                type="text"
                value={m.apiKey ?? ""}
                onChange={(e) => updateModel(i, { apiKey: e.target.value })}
                placeholder="${VAR_NAME}"
              />
              <p className="field-hint">Reference an env var from config/.env — never paste a literal key.</p>
            </div>
          </div>

          <div className="field-row">
            <div>
              <label>Input price / MTok</label>
              <input
                type="number"
                step="0.01"
                value={m.inputPricePerMTok ?? ""}
                onChange={(e) =>
                  updateModel(i, { inputPricePerMTok: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </div>
            <div>
              <label>Output price / MTok</label>
              <input
                type="number"
                step="0.01"
                value={m.outputPricePerMTok ?? ""}
                onChange={(e) =>
                  updateModel(i, { outputPricePerMTok: e.target.value === "" ? null : Number(e.target.value) })
                }
              />
            </div>
          </div>

          <div className="checkbox-list" style={{ marginTop: "0.6rem" }}>
            <label>
              <input
                type="checkbox"
                checked={m.supportsTools ?? true}
                onChange={(e) => updateModel(i, { supportsTools: e.target.checked })}
              />
              Supports tools
            </label>
          </div>
        </div>
      ))}

      <div className="config-toolbar">
        <button className="secondary add-row-btn" onClick={addModel}>
          + Add model
        </button>
        <div className="spacer" />
        <button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
