import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api.js";
import { VisualizationRenderer } from "../components/VisualizationRenderer.jsx";
import { NotFound } from "../components/NotFound.jsx";

// The plain "here's the report" view: load the saved report, resolve its filter against every
// currently-matching suite-run (no manual narrowing — that's what Configure is for), and render
// the dashboard against all of them. Nothing here is editable; ReportConfigurePage is one click
// away for that.
export function ReportViewPage() {
  const { id } = useParams();
  const [report, setReport] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setReport(null);
    setDashboard(null);
    setRuns(null);
    setError(null);

    api
      .getReport(id)
      .then(async (r) => {
        setReport(r);
        const [dashboardData, runData] = await Promise.all([
          api.getDashboard(r.dashboardId),
          api.listSuiteRuns({ suiteIds: r.filter.suiteIds, from: r.filter.from, to: r.filter.to }),
        ]);
        setDashboard(dashboardData);
        setRuns(runData);
      })
      .catch(setError);
  }, [id]);

  if (error?.status === 404) return <NotFound message={`No report '${id}'.`} />;
  if (error) return <p className="error-text">Failed to load report: {error.message}</p>;
  if (!report || !dashboard || !runs) return <p className="muted">Loading…</p>;

  return (
    <div>
      <p>
        <Link to="/reporting/reports">&larr; Reports</Link>
        {" · "}
        <Link to={`/reporting/reports/${encodeURIComponent(id)}/configure`}>Configure</Link>
      </p>

      <h2>{report.title}</h2>
      <p className="muted">
        {runs.length} matching run{runs.length === 1 ? "" : "s"} · {dashboard.title}
      </p>

      {runs.length === 0 ? (
        <p className="muted">No suite runs match this report's filter.</p>
      ) : (
        dashboard.sections.map((section, sIndex) => (
          <div className="card" key={sIndex}>
            <h3>{section.title}</h3>
            {section.visualizations.map((v, vIndex) => (
              <div key={vIndex}>
                {v.title && <p className="field-hint">{v.title}</p>}
                <VisualizationRenderer id={v.ref} data={runs} />
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}
