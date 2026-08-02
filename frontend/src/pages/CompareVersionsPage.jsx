import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { ChartCard } from "../components/ChartCard.jsx";
import { ExportMenu } from "../components/ExportMenu.jsx";
import { colorForIndex } from "../charts/comparison/palette.js";
import { agentConfigHref } from "../charts/comparison/links.js";
import { exportCompareCsv, exportComparePdf } from "../charts/comparison/pageExport.js";
import renderDeltaHeader, { TITLE as DELTA_HEADER_TITLE } from "../charts/deltaHeader.js";
import renderReliabilityDelta, { TITLE as RELIABILITY_TITLE } from "../charts/reliabilityDelta.js";
import renderParetoScatter, { TITLE as PARETO_TITLE } from "../charts/paretoScatter.js";
import renderRegressionMatrix, { TITLE as MATRIX_TITLE } from "../charts/regressionMatrix.js";
import renderIterationBudget, { TITLE as ITERATION_BUDGET_TITLE } from "../charts/iterationBudget.js";
import { makeDistributionStrip } from "../charts/distributionStrip.js";
import renderToolUsageFlow, { TITLE as TOOL_FLOW_TITLE } from "../charts/toolUsageFlow.js";

const renderDurationStrip = makeDistributionStrip("durationMs");
const renderInputTokensStrip = makeDistributionStrip("inputTokens");
const renderOutputTokensStrip = makeDistributionStrip("outputTokens");
const renderCostStrip = makeDistributionStrip("cost");
const renderContextStrip = makeDistributionStrip("peakContextTokens");

function pointLabel(version) {
  return version == null ? "Current" : `v${version}`;
}

function fmtTimestamp(ts) {
  return new Date(ts).toLocaleString();
}

export function CompareVersionsPage() {
  const [suites, setSuites] = useState([]);
  const [agentsById, setAgentsById] = useState({});
  const [toolCosts, setToolCosts] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const [suiteId, setSuiteId] = useState("");
  const [records, setRecords] = useState(null); // null = not loaded yet for the current suite
  const [agentId, setAgentId] = useState("");

  const [baselineVersion, setBaselineVersion] = useState(undefined);
  const [candidateVersions, setCandidateVersions] = useState(new Set());

  const [exporting, setExporting] = useState(false); // false | a status string while an export runs
  const [exportError, setExportError] = useState(null);
  const contentRef = useRef(null);

  useEffect(() => {
    Promise.all([api.listSuites(), api.listAgents(), api.getToolCostsConfig()])
      .then(([suitesRes, agentsRes, toolCostsRes]) => {
        setSuites(suitesRes);
        setAgentsById(Object.fromEntries(agentsRes.agents.map((a) => [a.id, a])));
        setToolCosts(toolCostsRes.data.toolCosts ?? []);
        if (suitesRes.length > 0) setSuiteId(suitesRes[0].id);
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  useEffect(() => {
    if (!suiteId) return;
    setRecords(null);
    setAgentId("");
    api
      .listSuiteRuns({ suiteIds: [suiteId] })
      .then(setRecords)
      .catch((err) => setLoadError(err.message));
  }, [suiteId]);

  const agentIds = useMemo(() => {
    if (!records) return [];
    return [...new Set(records.map((r) => r.agentId))].sort((a, b) => a.localeCompare(b));
  }, [records]);

  useEffect(() => {
    if (agentIds.length > 0 && !agentIds.includes(agentId)) setAgentId(agentIds[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentIds]);

  // One "point" per distinct cut version this agent has actually been benchmarked at (plus
  // "Current" if any run used the live config) — the latest recorded run per version, since a
  // version can accumulate more than one run over time and only the newest is meaningful to
  // compare against. Sorted oldest-to-newest, "Current" last (it has no fixed position in a cut
  // sequence — it's always the newest/ongoing state).
  const points = useMemo(() => {
    if (!records || !agentId) return [];
    const byVersion = new Map();
    for (const r of records) {
      if (r.agentId !== agentId) continue;
      const existing = byVersion.get(r.version);
      if (!existing || new Date(r.timestamp) > new Date(existing.timestamp)) byVersion.set(r.version, r);
    }
    return [...byVersion.values()].sort((a, b) => {
      if (a.version == null) return 1;
      if (b.version == null) return -1;
      return a.version - b.version;
    });
  }, [records, agentId]);

  // Default: oldest point is the baseline, every other point starts pre-selected as a candidate
  // — a full comparison out of the box, narrowed by hand from there.
  useEffect(() => {
    if (points.length === 0) {
      setBaselineVersion(undefined);
      setCandidateVersions(new Set());
      return;
    }
    setBaselineVersion(points[0].version);
    setCandidateVersions(new Set(points.slice(1).map((p) => p.version)));
  }, [points]);

  function setBaseline(version) {
    setBaselineVersion(version);
    setCandidateVersions((prev) => {
      if (!prev.has(version)) return prev;
      const next = new Set(prev);
      next.delete(version);
      return next;
    });
  }

  function toggleCandidate(version) {
    setCandidateVersions((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  }

  const baselinePoint = useMemo(
    () => points.find((p) => p.version === baselineVersion) ?? null,
    [points, baselineVersion]
  );
  const candidatePoints = useMemo(
    () => points.filter((p) => p.version !== baselineVersion && candidateVersions.has(p.version)),
    [points, candidateVersions, baselineVersion]
  );

  // sourceRunId/version/agentSnapshot are threaded through alongside the existing
  // label/color/summary/results — not used by every chart, but needed by the cross-navigation
  // links (regression matrix cells -> run detail, Pareto points -> agent config) and the
  // iteration-budget-utilization chart (agentSnapshot.maxIterations), which would otherwise have
  // no way to reach data that's already sitting on the raw SuiteRunRecord `points` come from.
  const chartData = useMemo(() => {
    if (!baselinePoint) return null;
    return {
      agentId,
      baseline: {
        label: pointLabel(baselinePoint.version),
        version: baselinePoint.version,
        sourceRunId: baselinePoint.sourceRunId,
        agentSnapshot: baselinePoint.agentSnapshot,
        timestamp: baselinePoint.timestamp,
        summary: baselinePoint.summary,
        results: baselinePoint.results,
      },
      candidates: candidatePoints.map((p, i) => ({
        label: pointLabel(p.version),
        version: p.version,
        sourceRunId: p.sourceRunId,
        agentSnapshot: p.agentSnapshot,
        timestamp: p.timestamp,
        color: colorForIndex(i),
        summary: p.summary,
        results: p.results,
      })),
      toolCosts,
    };
  }, [agentId, baselinePoint, candidatePoints, toolCosts]);

  if (loadError) return <p className="error-text">Failed to load: {loadError}</p>;

  async function handleExportCsv() {
    setExportError(null);
    setExporting("Exporting…");
    try {
      exportCompareCsv(suiteId, agentId, chartData);
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
      await exportComparePdf(agentId, contentRef.current);
    } catch (err) {
      setExportError(err.message || String(err));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <div className="report-view-header">
        {exportError && <p className="error-text">Export failed: {exportError}</p>}
        {chartData && <ExportMenu onExportCsv={handleExportCsv} onExportPdf={handleExportPdf} busy={exporting} />}
      </div>

      <div ref={contentRef}>
        <h2>Compare versions</h2>
        <p className="muted">
          Pick one agent and a set of its cut versions to compare — one baseline, any number of candidates, all
          benchmarked against the same suite.
        </p>

        <div className="card">
          <div className="field-row">
            <div>
              <label>Suite</label>
              <select value={suiteId} onChange={(e) => setSuiteId(e.target.value)}>
                {suites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.id}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Agent</label>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={agentIds.length === 0}>
                {agentIds.length === 0 && <option value="">No recorded runs for this suite yet</option>}
                {agentIds.map((id) => (
                  <option key={id} value={id}>
                    {agentsById[id]?.name || id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {records === null ? (
            <p className="muted">Loading…</p>
          ) : points.length === 0 ? (
            <p className="muted">No recorded runs for this suite/agent yet — run the suite first.</p>
          ) : (
            <>
              <label>Versions</label>
              <table className="version-picker-table">
                <thead>
                  <tr>
                    <th>Baseline</th>
                    <th>Candidate</th>
                    <th>Version</th>
                    <th>Last run</th>
                    <th>Pass rate</th>
                  </tr>
                </thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.version ?? "current"} className={p.version === baselineVersion ? "is-baseline" : undefined}>
                      <td>
                        <input
                          type="radio"
                          name="baseline"
                          checked={p.version === baselineVersion}
                          onChange={() => setBaseline(p.version)}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={candidateVersions.has(p.version) && p.version !== baselineVersion}
                          disabled={p.version === baselineVersion}
                          onChange={() => toggleCandidate(p.version)}
                        />
                      </td>
                      <td className="mono">
                        <Link to={agentConfigHref(agentId, p.version)} title="Open this version in the agent config editor">
                          {pointLabel(p.version)}
                        </Link>
                      </td>
                      <td className="mono">{fmtTimestamp(p.timestamp)}</td>
                      <td className="mono">{Math.round(p.summary.passRate * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>

        {chartData && (
          <ChartCard
            title={DELTA_HEADER_TITLE}
            filename={`delta-header-${agentId}`}
            data={chartData}
            render={renderDeltaHeader}
          />
        )}

        {chartData && (
          <ChartCard
            title={RELIABILITY_TITLE}
            filename={`reliability-delta-${agentId}`}
            data={chartData}
            render={renderReliabilityDelta}
          />
        )}

        {chartData && (
          <ChartCard
            title={PARETO_TITLE}
            filename={`pareto-scatter-${agentId}`}
            data={chartData}
            render={renderParetoScatter}
          />
        )}

        {chartData && (
          <ChartCard
            title={MATRIX_TITLE}
            filename={`regression-matrix-${agentId}`}
            data={chartData}
            render={renderRegressionMatrix}
          />
        )}

        {chartData && (
          <ChartCard
            title={ITERATION_BUDGET_TITLE}
            filename={`iteration-budget-${agentId}`}
            data={chartData}
            render={renderIterationBudget}
          />
        )}

        {/* The five distribution strips are small multiples of the same chart shape — grouped
            two-per-row (wrapping to one on a narrower viewport) instead of five stacked full-width
            rows, since each strip's actual content (a handful of horizontal lanes) doesn't need the
            full width of this page's wide main. */}
        {chartData && (
          <div className="viz-row">
            <ChartCard
              title={renderDurationStrip.TITLE}
              filename={`duration-strip-${agentId}`}
              data={chartData}
              render={renderDurationStrip}
            />
            <ChartCard
              title={renderInputTokensStrip.TITLE}
              filename={`input-tokens-strip-${agentId}`}
              data={chartData}
              render={renderInputTokensStrip}
            />
            <ChartCard
              title={renderOutputTokensStrip.TITLE}
              filename={`output-tokens-strip-${agentId}`}
              data={chartData}
              render={renderOutputTokensStrip}
            />
            <ChartCard
              title={renderCostStrip.TITLE}
              filename={`cost-strip-${agentId}`}
              data={chartData}
              render={renderCostStrip}
            />
            <ChartCard
              title={renderContextStrip.TITLE}
              filename={`context-strip-${agentId}`}
              data={chartData}
              render={renderContextStrip}
            />
          </div>
        )}

        {chartData && (
          <ChartCard
            title={TOOL_FLOW_TITLE}
            filename={`tool-usage-flow-${agentId}`}
            data={chartData}
            render={renderToolUsageFlow}
          />
        )}
      </div>
    </div>
  );
}
