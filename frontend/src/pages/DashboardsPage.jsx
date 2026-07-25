import { useEffect, useState } from "react";
import { api } from "../api.js";
import { SaveNotice } from "../components/SaveNotice.jsx";
import { VisualizationRenderer } from "../components/VisualizationRenderer.jsx";

function newKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k${Date.now()}${Math.random()}`;
}

function emptyDashboard() {
  return { _key: newKey(), _isNew: true, id: "", title: "", sections: [] };
}

function emptySection() {
  return { title: "", visualizations: [] };
}

function emptyVisualizationRef() {
  return { ref: "", title: "" };
}

function runKey(r) {
  return `${r.suiteId}--${r.agentId}--${r.timestamp}`;
}

// Full CRUD for dashboards (config/reporting/dashboards/<id>.json), same shape as
// SuitesConfigPage. Each dashboard also gets an in-place "Preview" panel: since a dashboard is
// just a composition of visualizations already provable in isolation (see VisualizationsPage),
// previewing here works entirely against in-memory edits — no save required first.
export function DashboardsPage() {
  const [dashboards, setDashboards] = useState(null);
  const [visualizationIds, setVisualizationIds] = useState([]);
  const [runs, setRuns] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [saveStates, setSaveStates] = useState({});
  const [previewStates, setPreviewStates] = useState({});

  useEffect(() => {
    Promise.all([api.listDashboards(), api.listVisualizations(), api.listSuiteRuns()])
      .then(([dashboardList, visualizations, runList]) => {
        setDashboards(dashboardList.map((d) => ({ ...d, _key: d.id, _isNew: false })));
        setVisualizationIds(visualizations.map((v) => v.id));
        setRuns(runList);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  function setSaveState(key, patch) {
    setSaveStates((s) => ({ ...s, [key]: { ...s[key], ...patch } }));
  }

  function setPreviewState(key, patch) {
    setPreviewStates((s) => ({ ...s, [key]: { open: false, runKeys: new Set(), ...s[key], ...patch } }));
  }

  function updateDashboard(key, patch) {
    setDashboards((list) => list.map((d) => (d._key === key ? { ...d, ...patch } : d)));
  }

  function updateSection(key, sIndex, patch) {
    setDashboards((list) =>
      list.map((d) =>
        d._key !== key ? d : { ...d, sections: d.sections.map((s, i) => (i === sIndex ? { ...s, ...patch } : s)) }
      )
    );
  }

  function updateVisualization(key, sIndex, vIndex, patch) {
    setDashboards((list) =>
      list.map((d) =>
        d._key !== key
          ? d
          : {
              ...d,
              sections: d.sections.map((s, i) =>
                i !== sIndex
                  ? s
                  : { ...s, visualizations: s.visualizations.map((v, j) => (j === vIndex ? { ...v, ...patch } : v)) }
              ),
            }
      )
    );
  }

  function addSection(key) {
    setDashboards((list) => list.map((d) => (d._key === key ? { ...d, sections: [...d.sections, emptySection()] } : d)));
  }

  function removeSection(key, sIndex) {
    setDashboards((list) =>
      list.map((d) => (d._key === key ? { ...d, sections: d.sections.filter((_, i) => i !== sIndex) } : d))
    );
  }

  function addVisualization(key, sIndex) {
    setDashboards((list) =>
      list.map((d) =>
        d._key !== key
          ? d
          : {
              ...d,
              sections: d.sections.map((s, i) =>
                i === sIndex ? { ...s, visualizations: [...s.visualizations, emptyVisualizationRef()] } : s
              ),
            }
      )
    );
  }

  function removeVisualization(key, sIndex, vIndex) {
    setDashboards((list) =>
      list.map((d) =>
        d._key !== key
          ? d
          : {
              ...d,
              sections: d.sections.map((s, i) =>
                i === sIndex ? { ...s, visualizations: s.visualizations.filter((_, j) => j !== vIndex) } : s
              ),
            }
      )
    );
  }

  function addDashboard() {
    setDashboards((list) => [...list, emptyDashboard()]);
  }

  async function saveDashboard(key) {
    const dashboard = dashboards.find((d) => d._key === key);
    setSaveState(key, { saving: true, saveError: null, result: null });
    try {
      const payload = {
        id: dashboard.id,
        title: dashboard.title,
        sections: dashboard.sections.map((s) => ({
          title: s.title,
          visualizations: s.visualizations.map((v) => ({ ref: v.ref, title: v.title || null })),
        })),
      };
      if (dashboard._isNew) {
        await api.createDashboard(payload);
        updateDashboard(key, { _isNew: false });
      } else {
        await api.updateDashboard(dashboard.id, payload);
      }
      setSaveState(key, { saving: false, result: { applied: true } });
    } catch (err) {
      setSaveState(key, { saving: false, saveError: err.message });
    }
  }

  async function deleteDashboard(key) {
    const dashboard = dashboards.find((d) => d._key === key);
    if (dashboard._isNew) {
      setDashboards((list) => list.filter((d) => d._key !== key));
      return;
    }
    if (!confirm(`Delete dashboard '${dashboard.id}'? This cannot be undone.`)) return;
    setSaveState(key, { saving: true, saveError: null, result: null });
    try {
      await api.deleteDashboard(dashboard.id);
      setDashboards((list) => list.filter((d) => d._key !== key));
    } catch (err) {
      setSaveState(key, { saving: false, saveError: err.message });
    }
  }

  function toggleRun(key, runK, checked) {
    setPreviewState(key, {
      runKeys: (() => {
        const current = previewStates[key]?.runKeys ?? new Set();
        const next = new Set(current);
        if (checked) next.add(runK);
        else next.delete(runK);
        return next;
      })(),
    });
  }

  if (loadError) return <p className="error-text">Failed to load dashboards: {loadError}</p>;
  if (!dashboards) return <p className="muted">Loading…</p>;

  return (
    <div>
      <p className="field-hint" style={{ marginBottom: "1rem" }}>
        Each dashboard saves independently — id becomes the filename
        (config/reporting/dashboards/&lt;id&gt;.json) and can't be changed after creation. A
        section's visualizations reference ids from the Visualizations tab.
      </p>

      {visualizationIds.length === 0 && (
        <p className="muted" style={{ marginBottom: "1rem" }}>
          No visualizations exist yet — add one under config/reporting/visualizations/ first (see
          the Visualizations tab).
        </p>
      )}

      {dashboards.map((dashboard) => {
        const state = saveStates[dashboard._key] ?? {};
        const preview = previewStates[dashboard._key] ?? { open: false, runKeys: new Set() };
        const previewData = runs.filter((r) => preview.runKeys.has(runKey(r)));

        return (
          <div className="config-row" key={dashboard._key}>
            <div className="config-row-header">
              <h4>{dashboard.title || dashboard.id || "new dashboard"}</h4>
              <button className="secondary" onClick={() => deleteDashboard(dashboard._key)}>
                Delete
              </button>
            </div>

            <div className="field-row">
              <div>
                <label>Id</label>
                <input
                  type="text"
                  value={dashboard.id}
                  disabled={!dashboard._isNew}
                  onChange={(e) => updateDashboard(dashboard._key, { id: e.target.value })}
                />
              </div>
              <div>
                <label>Title</label>
                <input
                  type="text"
                  value={dashboard.title}
                  onChange={(e) => updateDashboard(dashboard._key, { title: e.target.value })}
                />
              </div>
            </div>

            <label style={{ marginTop: "1rem" }}>Sections ({dashboard.sections.length})</label>
            {dashboard.sections.map((section, sIndex) => (
              <div className="config-row" key={sIndex}>
                <div className="config-row-header">
                  <h4>{section.title || `section ${sIndex + 1}`}</h4>
                  <button className="secondary" onClick={() => removeSection(dashboard._key, sIndex)}>
                    Remove
                  </button>
                </div>
                <label>Title</label>
                <input
                  type="text"
                  value={section.title}
                  onChange={(e) => updateSection(dashboard._key, sIndex, { title: e.target.value })}
                />

                <label style={{ marginTop: "0.6rem" }}>Visualizations ({section.visualizations.length})</label>
                {section.visualizations.map((viz, vIndex) => (
                  <div className="field-row" key={vIndex}>
                    <div>
                      <label>Visualization</label>
                      <select
                        value={viz.ref}
                        onChange={(e) => updateVisualization(dashboard._key, sIndex, vIndex, { ref: e.target.value })}
                      >
                        <option value="">— select —</option>
                        {visualizationIds.map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label>Title override (optional)</label>
                      <input
                        type="text"
                        value={viz.title ?? ""}
                        onChange={(e) => updateVisualization(dashboard._key, sIndex, vIndex, { title: e.target.value })}
                      />
                    </div>
                    <div style={{ alignSelf: "flex-end" }}>
                      <button className="secondary" onClick={() => removeVisualization(dashboard._key, sIndex, vIndex)}>
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
                <button className="secondary add-row-btn" onClick={() => addVisualization(dashboard._key, sIndex)}>
                  + Add visualization
                </button>
              </div>
            ))}
            <button className="secondary add-row-btn" onClick={() => addSection(dashboard._key)}>
              + Add section
            </button>

            <SaveNotice
              bootstrapped={false}
              result={state.result}
              onDismissResult={() => setSaveState(dashboard._key, { result: null })}
            />
            {state.saveError && <p className="error-text">{state.saveError}</p>}

            <div className="config-toolbar">
              <button className="secondary" onClick={() => setPreviewState(dashboard._key, { open: !preview.open })}>
                {preview.open ? "Hide preview" : "Preview"}
              </button>
              <div className="spacer" />
              <button onClick={() => saveDashboard(dashboard._key)} disabled={state.saving}>
                {state.saving ? "Saving…" : "Save"}
              </button>
            </div>

            {preview.open && (
              <div className="reporting-preview">
                <h4>Preview against</h4>
                {runs.length === 0 ? (
                  <p className="muted">No suite runs recorded yet — run a suite first.</p>
                ) : (
                  <div className="run-picker">
                    {runs.map((r) => {
                      const rk = runKey(r);
                      return (
                        <label key={rk} className="run-picker-row">
                          <input
                            type="checkbox"
                            checked={preview.runKeys.has(rk)}
                            onChange={(e) => toggleRun(dashboard._key, rk, e.target.checked)}
                          />
                          {r.suiteId} / {r.agentId} — {new Date(r.timestamp).toLocaleString()}
                        </label>
                      );
                    })}
                  </div>
                )}

                {dashboard.sections.map((section, sIndex) => (
                  <div key={sIndex}>
                    <h4>{section.title || `section ${sIndex + 1}`}</h4>
                    {section.visualizations
                      .filter((v) => v.ref)
                      .map((v, vIndex) => (
                        <div key={vIndex}>
                          {v.title && <p className="field-hint">{v.title}</p>}
                          <VisualizationRenderer id={v.ref} data={previewData} />
                        </div>
                      ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <div className="config-toolbar">
        <button className="secondary add-row-btn" onClick={addDashboard}>
          + Add dashboard
        </button>
      </div>
    </div>
  );
}
