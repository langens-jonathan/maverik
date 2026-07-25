import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api } from "../api.js";
import { SaveNotice } from "../components/SaveNotice.jsx";
import { VisualizationRenderer } from "../components/VisualizationRenderer.jsx";
import { NotFound } from "../components/NotFound.jsx";

function runKey(r) {
  return `${r.suiteId}--${r.agentId}--${r.timestamp}`;
}

function emptyBuilder() {
  return { id: "", title: "", suiteIds: new Set(), from: "", to: "", dashboardId: "" };
}

// Configuration + live preview for a report: filter (suites + date range) → "Find runs" →
// deselect any you don't want → pick a dashboard, rendered live against the selection.
// /reporting/reports/new (no :id param) starts blank; /reporting/reports/:id/configure loads
// and pre-fills from the saved report, then immediately re-resolves matching runs (never a
// stale snapshot of what matched when it was saved). Saving a brand new report navigates to its
// view page (ReportViewPage) once it exists; editing an existing one just saves in place.
export function ReportConfigurePage() {
  const { id } = useParams();
  const isNew = id === undefined;
  const navigate = useNavigate();

  const [suites, setSuites] = useState([]);
  const [dashboards, setDashboards] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [notFound, setNotFound] = useState(false);

  const [builder, setBuilder] = useState(isNew ? emptyBuilder() : null);
  const [matchingRuns, setMatchingRuns] = useState(null);
  const [selectedRunKeys, setSelectedRunKeys] = useState(new Set());
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveResult, setSaveResult] = useState(null);

  useEffect(() => {
    Promise.all([api.listSuites(), api.listDashboards()])
      .then(([suiteList, dashboardList]) => {
        setSuites(suiteList);
        setDashboards(dashboardList);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  useEffect(() => {
    if (isNew) return;
    api
      .getReport(id)
      .then((report) => {
        const next = {
          id: report.id,
          title: report.title,
          suiteIds: new Set(report.filter.suiteIds),
          from: report.filter.from ? report.filter.from.slice(0, 10) : "",
          to: report.filter.to ? report.filter.to.slice(0, 10) : "",
          dashboardId: report.dashboardId,
        };
        setBuilder(next);
        findRuns(next);
      })
      .catch((err) => {
        if (err.status === 404) setNotFound(true);
        else setLoadError(err.message);
      });
  }, [id]);

  function toggleSuite(suiteId, checked) {
    setBuilder((b) => {
      const next = new Set(b.suiteIds);
      if (checked) next.add(suiteId);
      else next.delete(suiteId);
      return { ...b, suiteIds: next };
    });
  }

  function findRuns(source) {
    const b = source ?? builder;
    setSearching(true);
    setSearchError(null);
    api
      .listSuiteRuns({
        suiteIds: [...b.suiteIds],
        from: b.from ? `${b.from}T00:00:00Z` : undefined,
        to: b.to ? `${b.to}T23:59:59Z` : undefined,
      })
      .then((runs) => {
        setMatchingRuns(runs);
        setSelectedRunKeys(new Set(runs.map(runKey)));
        setSearching(false);
      })
      .catch((err) => {
        setSearchError(err.message);
        setSearching(false);
      });
  }

  function toggleRun(key, checked) {
    setSelectedRunKeys((s) => {
      const next = new Set(s);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function saveReport() {
    setSaving(true);
    setSaveError(null);
    setSaveResult(null);
    try {
      const payload = {
        id: builder.id,
        title: builder.title,
        filter: {
          suiteIds: [...builder.suiteIds],
          from: builder.from ? `${builder.from}T00:00:00Z` : null,
          to: builder.to ? `${builder.to}T23:59:59Z` : null,
        },
        dashboardId: builder.dashboardId,
      };
      if (isNew) {
        await api.createReport(payload);
        navigate(`/reporting/reports/${encodeURIComponent(builder.id)}`);
        return;
      }
      await api.updateReport(builder.id, payload);
      setSaveResult({ applied: true });
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (notFound) return <NotFound message={`No report '${id}'.`} />;
  if (loadError) return <p className="error-text">Failed to load: {loadError}</p>;
  if (!builder) return <p className="muted">Loading…</p>;

  const selectedDashboard = dashboards.find((d) => d.id === builder.dashboardId);
  const selectedData = (matchingRuns ?? []).filter((r) => selectedRunKeys.has(runKey(r)));

  return (
    <div>
      <p>
        <Link to="/reporting/reports">&larr; Reports</Link>
        {!isNew && (
          <>
            {" · "}
            <Link to={`/reporting/reports/${encodeURIComponent(id)}`}>Open</Link>
          </>
        )}
      </p>

      <div className="config-row">
        <h4>{isNew ? "New report" : builder.title || builder.id}</h4>

        <label>Suites (empty = any)</label>
        <div className="checkbox-list">
          {suites.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={builder.suiteIds.has(s.id)}
                onChange={(e) => toggleSuite(s.id, e.target.checked)}
              />
              {s.name || s.id}
            </label>
          ))}
        </div>

        <div className="field-row">
          <div>
            <label>From (optional)</label>
            <input type="date" value={builder.from} onChange={(e) => setBuilder((b) => ({ ...b, from: e.target.value }))} />
          </div>
          <div>
            <label>To (optional)</label>
            <input type="date" value={builder.to} onChange={(e) => setBuilder((b) => ({ ...b, to: e.target.value }))} />
          </div>
        </div>

        <label>Dashboard</label>
        <select
          value={builder.dashboardId}
          onChange={(e) => setBuilder((b) => ({ ...b, dashboardId: e.target.value }))}
        >
          <option value="">— select —</option>
          {dashboards.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>

        <div className="config-toolbar">
          <div className="spacer" />
          <button className="secondary" onClick={() => findRuns()} disabled={searching}>
            {searching ? "Searching…" : "Find runs"}
          </button>
        </div>
        {searchError && <p className="error-text">{searchError}</p>}

        {matchingRuns && (
          <>
            <label>Matching runs ({matchingRuns.length}) — select which to include</label>
            {matchingRuns.length === 0 ? (
              <p className="muted">No suite runs match this filter.</p>
            ) : (
              <div className="run-picker">
                {matchingRuns.map((r) => {
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
          </>
        )}

        <label style={{ marginTop: "1rem" }}>Save this report</label>
        <div className="field-row">
          <div>
            <label>Id</label>
            <input
              type="text"
              value={builder.id}
              disabled={!isNew}
              onChange={(e) => setBuilder((b) => ({ ...b, id: e.target.value }))}
            />
          </div>
          <div>
            <label>Title</label>
            <input
              type="text"
              value={builder.title}
              onChange={(e) => setBuilder((b) => ({ ...b, title: e.target.value }))}
            />
          </div>
        </div>

        <SaveNotice bootstrapped={false} result={saveResult} onDismissResult={() => setSaveResult(null)} />
        {saveError && <p className="error-text">{saveError}</p>}

        <div className="config-toolbar">
          <div className="spacer" />
          <button onClick={saveReport} disabled={saving}>
            {saving ? "Saving…" : "Save report"}
          </button>
        </div>
      </div>

      {matchingRuns && selectedDashboard && (
        <div className="reporting-preview">
          <h3>{selectedDashboard.title}</h3>
          {selectedDashboard.sections.map((section, sIndex) => (
            <div key={sIndex}>
              <h4>{section.title}</h4>
              {section.visualizations.map((v, vIndex) => (
                <div key={vIndex}>
                  {v.title && <p className="field-hint">{v.title}</p>}
                  <VisualizationRenderer id={v.ref} data={selectedData} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
