import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api } from "../api.js";
import { VisualizationRenderer } from "../components/VisualizationRenderer.jsx";
import { NotFound } from "../components/NotFound.jsx";
import { ExportMenu } from "../components/ExportMenu.jsx";
import { exportReportCsv, exportReportPdf } from "../reportExport.js";

// Pixel budgets for the two-column visualization grid below — sized for this page's wider
// `main.wide` layout (see styles.css), not the 900px width every other page uses. Widened from
// 1100/538 to fit a collapsible right-side legend column (see cost-vs-correctness.js) inside a
// half-width chart while still fitting two side by side; main.wide's max-width was widened to
// match (see styles.css).
const REPORT_FULL_WIDTH = 1184;
const REPORT_HALF_WIDTH = 580;

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
  const [exporting, setExporting] = useState(false); // false | a status string while an export runs
  const [exportError, setExportError] = useState(null);
  const contentRef = useRef(null);

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

  async function handleExportCsv() {
    setExportError(null);
    setExporting("Exporting…");
    try {
      exportReportCsv(report, runs);
    } catch (err) {
      setExportError(err.message || String(err));
    } finally {
      setExporting(false);
    }
  }

  async function handleExportPdf() {
    setExportError(null);
    setExporting("Generating PDF…");
    try {
      await exportReportPdf(report, contentRef.current);
    } catch (err) {
      setExportError(err.message || String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <p>
        <Link to="/reporting/reports">&larr; Reports</Link>
        {" · "}
        <Link to={`/reporting/reports/${encodeURIComponent(id)}/configure`}>Configure</Link>
      </p>

      <div className="report-view-header">
        {exportError && <p className="error-text">Export failed: {exportError}</p>}
        <ExportMenu onExportCsv={handleExportCsv} onExportPdf={handleExportPdf} busy={exporting} />
      </div>

      <div ref={contentRef}>
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
              <div className="viz-row">
                {section.visualizations.map((v, vIndex) => (
                  <VisualizationRenderer
                    key={vIndex}
                    id={v.ref}
                    title={v.title}
                    data={runs}
                    fullWidth={REPORT_FULL_WIDTH}
                    halfWidth={REPORT_HALF_WIDTH}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
