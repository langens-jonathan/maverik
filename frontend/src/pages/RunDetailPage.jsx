import { Fragment, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { usePolling } from "../hooks/usePolling.js";
import { BarRow } from "../components/BarRow.jsx";

const AGENT_COLORS = ["#1a56db", "#057a55", "#9333ea", "#c2410c", "#0e7490", "#be123c"];

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

  if (runError) return <p className="error-text">Failed to load run: {runError.message}</p>;
  if (!run) return <p className="muted">Loading…</p>;

  const maxDuration = Math.max(1, ...(summary?.agents.map((a) => a.avgDurationMs) ?? [1]));
  const maxTokens = Math.max(
    1,
    ...(summary?.agents.flatMap((a) => [a.avgInputTokens ?? 0, a.avgOutputTokens ?? 0]) ?? [1])
  );
  const maxCost = Math.max(1e-9, ...(summary?.agents.map((a) => a.estCostTotal ?? 0) ?? [1e-9]));

  return (
    <div>
      <p>
        <Link to="/runs">&larr; Runs</Link>
      </p>
      <h2>{run.runId}</h2>
      <div className="card">
        <p>
          Suite <strong>{run.suiteId}</strong> · <span className={`badge state-${run.state}`}>{run.state}</span>
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
            const color = AGENT_COLORS[i % AGENT_COLORS.length];
            return (
              <div className="agent-block" key={a.agentId}>
                <h4>{a.agentId}</h4>
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
              <th>Tools</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {run.results.map((c, i) => {
              const key = `${c.agentId}:${c.questionId}:${c.repetition}`;
              const isOpen = expanded === key;
              return (
                <Fragment key={key}>
                  <tr onClick={() => setExpanded(isOpen ? null : key)} style={{ cursor: "pointer" }}>
                    <td>{c.agentId}</td>
                    <td>{c.questionId}</td>
                    <td>{c.repetition}</td>
                    <td>{fmtMs(c.durationMs)}</td>
                    <td>
                      {fmtTokens(c.inputTokens)}/{fmtTokens(c.outputTokens)}
                    </td>
                    <td>{c.toolCallCount}</td>
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
                      <td colSpan={7}>
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
