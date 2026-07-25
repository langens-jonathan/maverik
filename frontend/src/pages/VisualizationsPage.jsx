import { useEffect, useState } from "react";
import { api } from "../api.js";
import { VisualizationRenderer } from "../components/VisualizationRenderer.jsx";

function runKey(r) {
  return `${r.suiteId}--${r.agentId}--${r.timestamp}`;
}

// Lists everything under config/reporting/visualizations/ and lets you preview one against real
// suite-run data. There's no in-app editor here (see config/reporting/README.md): a visualization
// is authored directly on disk, and this page just checks it before wiring it into a dashboard.
export function VisualizationsPage() {
  const [files, setFiles] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [runs, setRuns] = useState(null);
  const [selectedRunKeys, setSelectedRunKeys] = useState(new Set());
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    api
      .listVisualizations()
      .then((files) => {
        setFiles(files);
        if (files.length > 0) setSelectedId(files[0].id);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  useEffect(() => {
    api
      .listSuiteRuns()
      .then((runs) => {
        setRuns(runs);
        if (runs.length > 0) setSelectedRunKeys(new Set([runKey(runs[0])]));
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  function toggleRun(key, checked) {
    setSelectedRunKeys((s) => {
      const next = new Set(s);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  if (loadError) return <p className="error-text">Failed to load: {loadError}</p>;
  if (!files) return <p className="muted">Loading…</p>;

  if (files.length === 0) {
    return (
      <p className="muted">
        No visualizations yet — add a file under <code>config/reporting/visualizations/</code>
        (see the contract in <code>config/reporting/README.md</code>), then refresh this page.
      </p>
    );
  }

  const selectedData = (runs ?? []).filter((r) => selectedRunKeys.has(runKey(r)));

  return (
    <div className="reporting-layout">
      <div className="reporting-file-list">
        {files.map((f) => (
          <button
            key={f.id}
            className={`secondary${f.id === selectedId ? " active" : ""}`}
            onClick={() => setSelectedId(f.id)}
          >
            {f.id}
          </button>
        ))}
      </div>

      <div className="reporting-preview">
        {selectedId && (
          <p className="field-hint">
            Edit <code>config/reporting/visualizations/{selectedId}.js</code> directly, then
            refresh this page to see changes — there's no in-app editor for these files.
          </p>
        )}

        <h4>Preview against</h4>
        {!runs ? (
          <p className="muted">Loading runs…</p>
        ) : runs.length === 0 ? (
          <p className="muted">No suite runs recorded yet — run a suite first.</p>
        ) : (
          <div className="run-picker">
            {runs.map((r) => {
              const key = runKey(r);
              return (
                <label key={key} className="run-picker-row">
                  <input
                    type="checkbox"
                    checked={selectedRunKeys.has(key)}
                    onChange={(e) => toggleRun(key, e.target.checked)}
                  />
                  {r.suiteId} / {r.agentId} — {new Date(r.timestamp).toLocaleString()}
                </label>
              );
            })}
          </div>
        )}

        {selectedId && <VisualizationRenderer id={selectedId} data={selectedData} />}
      </div>
    </div>
  );
}
