import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { usePolling } from "../hooks/usePolling.js";
import { BarRow } from "../components/BarRow.jsx";
import { NotFound } from "../components/NotFound.jsx";
import { ChartCard } from "../components/ChartCard.jsx";
import { colorForIndex } from "../charts/core/palette.js";
import renderCriterionOutcomes, { TITLE as CRITERION_TITLE } from "../charts/criterionOutcomes.js";
import renderToolUsageProfile, { TITLE as TOOL_PROFILE_TITLE } from "../charts/toolUsageProfile.js";
import renderCostSplit, { TITLE as COST_SPLIT_TITLE } from "../charts/costSplit.js";

function fmtMs(ms) {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}
function fmtTokens(t) {
  return t == null ? "—" : Math.round(t).toLocaleString();
}
function fmtCost(c) {
  return c == null ? "—" : `$${c.toFixed(4)}`;
}
function fmtPct(p) {
  return `${Math.round(p * 100)}%`;
}
function fmtDigest(d) {
  if (!d) return "—";
  const short = d.startsWith("sha256:") ? d.slice(7, 15) : d.slice(0, 8);
  return short;
}

function isRunActive(run) {
  return !run || run.state === "queued" || run.state === "running";
}

export function RunDetailPage() {
  const { runId } = useParams();
  const { data: run, error: runError } = usePolling(() => api.getRun(runId), 1500, true);
  const active = isRunActive(run);
  const { data: summary, error: summaryError } = usePolling(
    () => api.getRunSummary(runId),
    2500,
    active || !!run
  );
  const [expanded, setExpanded] = useState(null);
  const [suite, setSuite] = useState(null);

  useEffect(() => {
    if (!run?.suiteId) return;
    setSuite(null);
    api.getSuite(run.suiteId).then(setSuite).catch(() => setSuite(null));
  }, [run?.suiteId]);

  // criteriaByQuestionId: only used by the per-criterion-outcomes chart — a suite that failed to
  // load (deleted since the run, or still loading) just means that one chart falls back to an
  // "unknown" bucket rather than breaking the whole page.
  const criteriaByQuestionId = useMemo(() => {
    if (!suite) return {};
    return Object.fromEntries(suite.questions.map((q) => [q.id, q.criterion.type]));
  }, [suite]);

  // One entry per agent in the Comparison card, each carrying its own slice of run.results —
  // the shared shape charts/criterionOutcomes.js and charts/toolUsageProfile.js both consume.
  // Every agent is a peer here (unlike Compare Versions' baseline/candidates), so color is plain
  // position-based colorForIndex, matching the Comparison card's own BarRow coloring above.
  const chartAgents = useMemo(() => {
    if (!summary || !run) return [];
    return summary.agents.map((a, i) => ({
      label: `${a.agentId}${a.version != null ? ` (v${a.version})` : ""}`,
      color: colorForIndex(i),
      results: run.results.filter((r) => r.agentId === a.agentId && r.version === a.version),
    }));
  }, [summary, run]);

  const costSplitData = useMemo(() => {
    if (!summary) return null;
    return {
      agentCost: summary.agents.reduce((sum, a) => sum + (a.estCostTotal ?? 0), 0),
      judgeCost: summary.judgeOverhead?.estCost ?? null,
    };
  }, [summary]);

  if (runError?.status === 404) return <NotFound message={`No run '${runId}'.`} />;
  if (runError) return <p className="error-text">Failed to load run: {runError.message}</p>;
  if (!run) return <p className="muted">Loading…</p>;

  const maxDuration = Math.max(1, ...(summary?.agents.map((a) => a.avgDurationMs) ?? [1]));
  const maxTokens = Math.max(
    1,
    ...(summary?.agents.flatMap((a) => [
      a.avgInputTokens ?? 0,
      a.avgOutputTokens ?? 0,
      a.avgCacheReadInputTokens ?? 0,
      a.avgCacheCreationInputTokens ?? 0,
    ]) ?? [1])
  );
  const maxCost = Math.max(1e-9, ...(summary?.agents.map((a) => a.estCostTotal ?? 0) ?? [1e-9]));

  return (
    <div>
      <p>
        <Link to="/runs">&larr; Runs</Link>
      </p>
      <h2 className="mono">{run.runId}</h2>
      <div className="card">
        <p>
          Suite <strong className="mono">{run.suiteId}</strong> ·{" "}
          <span className={`badge state-${run.state}`}>{run.state}</span>
        </p>
        <p>
          {run.completedCases}/{run.totalCases} cases
        </p>
        <progress value={run.completedCases} max={Math.max(1, run.totalCases)} />
      </div>

      {summaryError && <p className="error-text">Failed to load summary: {summaryError.message}</p>}

      {summary && summary.agents.length > 0 && (
        <div className="card">
          <h3>Comparison</h3>
          {summary.agents.map((a, i) => {
            const color = colorForIndex(i);
            return (
              <div className="agent-block" key={`${a.agentId}:${a.version ?? "live"}`}>
                <h4>
                  {a.agentId}
                  {a.version != null && <span className="version-badge">v{a.version}</span>}
                </h4>
                <BarRow label="Pass rate" value={a.passRate} max={1} display={fmtPct(a.passRate)} color={color} />
                <BarRow
                  label="Avg duration"
                  value={a.avgDurationMs}
                  max={maxDuration}
                  display={fmtMs(a.avgDurationMs)}
                  color={color}
                />
                <BarRow
                  label="Avg input tokens"
                  value={a.avgInputTokens ?? 0}
                  max={maxTokens}
                  display={fmtTokens(a.avgInputTokens)}
                  color={color}
                />
                <BarRow
                  label="Avg output tokens"
                  value={a.avgOutputTokens ?? 0}
                  max={maxTokens}
                  display={fmtTokens(a.avgOutputTokens)}
                  color={color}
                />
                {a.avgCacheReadInputTokens != null && (
                  <BarRow
                    label="Avg cache read tokens"
                    value={a.avgCacheReadInputTokens}
                    max={maxTokens}
                    display={fmtTokens(a.avgCacheReadInputTokens)}
                    color={color}
                  />
                )}
                {a.avgCacheCreationInputTokens != null && (
                  <BarRow
                    label="Avg cache creation tokens"
                    value={a.avgCacheCreationInputTokens}
                    max={maxTokens}
                    display={fmtTokens(a.avgCacheCreationInputTokens)}
                    color={color}
                  />
                )}
                <BarRow
                  label="Est. total cost"
                  value={a.estCostTotal ?? 0}
                  max={maxCost}
                  display={fmtCost(a.estCostTotal)}
                  color={color}
                />
                <p className="muted">
                  {a.errors} error{a.errors === 1 ? "" : "s"}
                  {a.casesWithoutUsage > 0 ? ` · ${a.casesWithoutUsage} case(s) without usage data` : ""}
                  {a.capabilityDigest != null && (
                    <>
                      {" · "}
                      {a.capabilityToolCount} tools (digest{" "}
                      <span className="mono" title={a.capabilityDigest}>
                        {fmtDigest(a.capabilityDigest)}
                      </span>
                      )
                    </>
                  )}
                </p>
              </div>
            );
          })}
          {(summary.judgeOverhead.inputTokens > 0 || summary.judgeOverhead.outputTokens > 0) && (
            <p className="muted">
              Judge overhead: {fmtTokens(summary.judgeOverhead.inputTokens)} in /{" "}
              {fmtTokens(summary.judgeOverhead.outputTokens)} out
              {summary.judgeOverhead.estCost != null ? ` · ${fmtCost(summary.judgeOverhead.estCost)}` : ""}
            </p>
          )}
        </div>
      )}

      {chartAgents.length > 0 && (
        <ChartCard
          title={CRITERION_TITLE}
          subtitle="Which kind of check this run's failures cluster on."
          filename={`criterion-outcomes-${run.runId}`}
          data={{ agents: chartAgents, criteriaByQuestionId }}
          render={renderCriterionOutcomes}
        />
      )}

      {chartAgents.length > 0 && (
        <ChartCard
          title={TOOL_PROFILE_TITLE}
          subtitle="Which tools this run actually reached for."
          filename={`tool-usage-profile-${run.runId}`}
          data={{ agents: chartAgents }}
          render={renderToolUsageProfile}
        />
      )}

      {costSplitData && (
        <ChartCard
          title={COST_SPLIT_TITLE}
          subtitle="Evaluation overhead vs. agent work, split out of one combined total."
          filename={`cost-split-${run.runId}`}
          data={costSplitData}
          render={renderCostSplit}
        />
      )}

      <div className="card">
        <h3>Cases ({run.results.length})</h3>
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Question</th>
              <th>Rep</th>
              <th>Duration</th>
              <th>Tokens</th>
              <th>Cache Tokens</th>
              <th>Tools</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {run.results.map((c, i) => {
              const key = `${c.agentId}:${c.version ?? "live"}:${c.questionId}:${c.repetition}`;
              const isOpen = expanded === key;
              return (
                <Fragment key={key}>
                  <tr onClick={() => setExpanded(isOpen ? null : key)} style={{ cursor: "pointer" }}>
                    <td className="mono">
                      {c.agentId}
                      {c.version != null ? ` (v${c.version})` : ""}
                    </td>
                    <td className="mono">{c.questionId}</td>
                    <td className="mono">{c.repetition}</td>
                    <td className="mono">{fmtMs(c.durationMs)}</td>
                    <td className="mono">
                      {fmtTokens(c.inputTokens)}/{fmtTokens(c.outputTokens)}
                    </td>
                    <td className="mono">
                      {fmtTokens(c.cacheReadInputTokens)}/{fmtTokens(c.cacheCreationInputTokens)}
                    </td>
                    <td className="mono">{c.toolCallCount}</td>
                    <td>
                      {c.error ? (
                        <span className="badge error">error</span>
                      ) : (
                        <span className={`badge ${c.passed ? "pass" : "fail"}`}>
                          {c.passed ? "pass" : "fail"}
                        </span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={8}>
                        <details className="case-detail" open>
                          {c.error && (
                            <>
                              <summary>Error</summary>
                              <pre>{c.error}</pre>
                            </>
                          )}
                          {!c.error && (
                            <>
                              <summary>Final answer & evaluation</summary>
                              <pre>{c.finalAnswer}</pre>
                              {c.evaluationDetail && <pre>{c.evaluationDetail}</pre>}
                            </>
                          )}
                        </details>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
