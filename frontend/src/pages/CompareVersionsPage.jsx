import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { ChartCard } from "../components/ChartCard.jsx";
import { colorForIndex } from "../charts/comparison/palette.js";
import renderDeltaHeader, { TITLE as DELTA_HEADER_TITLE } from "../charts/deltaHeader.js";
import renderParetoScatter, { TITLE as PARETO_TITLE } from "../charts/paretoScatter.js";
import renderRegressionMatrix, { TITLE as MATRIX_TITLE } from "../charts/regressionMatrix.js";
import { makeDistributionStrip } from "../charts/distributionStrip.js";
import renderToolUsageFlow, { TITLE as TOOL_FLOW_TITLE } from "../charts/toolUsageFlow.js";

const renderDurationStrip = makeDistributionStrip("durationMs");
const renderInputTokensStrip = makeDistributionStrip("inputTokens");
const renderOutputTokensStrip = makeDistributionStrip("outputTokens");
const renderCostStrip = makeDistributionStrip("cost");

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

  const chartData = useMemo(() => {
    if (!baselinePoint) return null;
    return {
      baseline: { label: pointLabel(baselinePoint.version), summary: baselinePoint.summary, results: baselinePoint.results },
      candidates: candidatePoints.map((p, i) => ({
        label: pointLabel(p.version),
        color: colorForIndex(i),
        summary: p.summary,
        results: p.results,
      })),
      toolCosts,
    };
  }, [baselinePoint, candidatePoints, toolCosts]);

  if (loadError) return <p className="error-text">Failed to load: {loadError}</p>;

  return (
    <div>
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
                    <td className="mono">{pointLabel(p.version)}</td>
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
          subtitle="Baseline vs. every selected candidate, five headline metrics, with per-repetition spread where it exists."
          filename={`delta-header-${agentId}`}
          data={chartData}
          render={renderDeltaHeader}
        />
      )}

      {chartData && (
        <ChartCard
          title={PARETO_TITLE}
          subtitle="Which version to ship — cost vs. pass rate, sized by duration, efficient set on the frontier."
          filename={`pareto-scatter-${agentId}`}
          data={chartData}
          render={renderParetoScatter}
        />
      )}

      {chartData && (
        <ChartCard
          title={MATRIX_TITLE}
          subtitle="The pre-ship safety check — every question, every selected version, sortable, with a diff-vs-baseline mode."
          filename={`regression-matrix-${agentId}`}
          data={chartData}
          render={renderRegressionMatrix}
        />
      )}

      {chartData && (
        <ChartCard
          title={renderDurationStrip.TITLE}
          subtitle="Every repetition's wall-clock duration, honest at any n."
          filename={`duration-strip-${agentId}`}
          data={chartData}
          render={renderDurationStrip}
        />
      )}

      {chartData && (
        <ChartCard
          title={renderInputTokensStrip.TITLE}
          subtitle="Per-repetition input token counts — usually the most deterministic metric here."
          filename={`input-tokens-strip-${agentId}`}
          data={chartData}
          render={renderInputTokensStrip}
        />
      )}

      {chartData && (
        <ChartCard
          title={renderOutputTokensStrip.TITLE}
          subtitle="Per-repetition output token counts."
          filename={`output-tokens-strip-${agentId}`}
          data={chartData}
          render={renderOutputTokensStrip}
        />
      )}

      {chartData && (
        <ChartCard
          title={renderCostStrip.TITLE}
          subtitle="Per-repetition cost (token + tool), same spread-not-average honesty as the other strips."
          filename={`cost-strip-${agentId}`}
          data={chartData}
          render={renderCostStrip}
        />
      )}

      {chartData && (
        <ChartCard
          title={TOOL_FLOW_TITLE}
          subtitle="Grouped bar, not a Sankey — one agent's versions rarely have enough distinct tool paths to earn one. Reveals behavioral drift in which tools get called."
          filename={`tool-usage-flow-${agentId}`}
          data={chartData}
          render={renderToolUsageFlow}
        />
      )}
    </div>
  );
}
