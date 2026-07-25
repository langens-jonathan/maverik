import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

function filterSummary(report, suites) {
  const suiteNames = report.filter.suiteIds.length
    ? report.filter.suiteIds.map((id) => suites.find((s) => s.id === id)?.name ?? id).join(", ")
    : "any suite";
  const range = [report.filter.from, report.filter.to].filter(Boolean).map((d) => d.slice(0, 10));
  const rangeText = range.length ? ` · ${range.join(" – ")}` : "";
  return `${suiteNames}${rangeText}`;
}

// Saved reports, each with two entry points: "Open" (ReportViewPage — just the rendered result,
// against all currently-matching runs) and "Configure" (ReportConfigurePage — the filter/dashboard
// builder with a live preview, where you can also narrow down which matching runs to look at).
export function ReportsListPage() {
  const [reports, setReports] = useState(null);
  const [suites, setSuites] = useState([]);
  const [dashboards, setDashboards] = useState([]);
  const [loadError, setLoadError] = useState(null);

  function reload() {
    return Promise.all([api.listReports(), api.listSuites(), api.listDashboards()]).then(
      ([reportList, suiteList, dashboardList]) => {
        setReports(reportList);
        setSuites(suiteList);
        setDashboards(dashboardList);
      }
    );
  }

  useEffect(() => {
    reload().catch((err) => setLoadError(err.message));
  }, []);

  async function deleteReport(id) {
    if (!confirm(`Delete report '${id}'? This cannot be undone.`)) return;
    try {
      await api.deleteReport(id);
      await reload();
    } catch (err) {
      setLoadError(err.message);
    }
  }

  if (loadError) return <p className="error-text">Failed to load: {loadError}</p>;
  if (!reports) return <p className="muted">Loading…</p>;

  return (
    <div>
      {dashboards.length === 0 ? (
        <p className="muted">
          No dashboards exist yet — build one under the Dashboards tab before creating a report.
        </p>
      ) : reports.length === 0 ? (
        <p className="muted">No saved reports yet.</p>
      ) : (
        reports.map((r) => (
          <div className="config-row" key={r.id}>
            <div className="config-row-header">
              <h4>{r.title}</h4>
              <button className="secondary" onClick={() => deleteReport(r.id)}>
                Delete
              </button>
            </div>
            <p className="field-hint">{filterSummary(r, suites)}</p>
            <p className="field-hint">
              Dashboard: {dashboards.find((d) => d.id === r.dashboardId)?.title ?? r.dashboardId}
            </p>
            <div className="config-toolbar">
              <div className="spacer" />
              <Link className="btn secondary" to={`/reporting/reports/${encodeURIComponent(r.id)}/configure`}>
                Configure
              </Link>
              <Link className="btn" to={`/reporting/reports/${encodeURIComponent(r.id)}`}>
                Open
              </Link>
            </div>
          </div>
        ))
      )}

      {dashboards.length > 0 && (
        <div className="config-toolbar">
          <Link className="btn secondary add-row-btn" to="/reporting/reports/new">
            + New report
          </Link>
        </div>
      )}
    </div>
  );
}
