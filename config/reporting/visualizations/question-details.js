// Table: one row per individual question/case, flattened out of each SuiteRunRecord's `results`
// (that agent's slice of the source run.json's per-case detail, copied in at write time so this
// is available directly from `data` — no fetch back to run.json needed). See ../README.md.
export const layout = "full";
export default function (container, data, { d3 }) {
  const rows = data
    .flatMap((r) =>
      (r.results ?? []).map((q) => ({
        suiteId: r.suiteId,
        agentId: r.agentId,
        runAt: r.timestamp,
        ...q,
      }))
    )
    .sort((a, b) => new Date(b.runAt) - new Date(a.runAt) || a.questionId.localeCompare(b.questionId));

  if (rows.length === 0) {
    container.textContent = "No per-question data for the selected runs.";
    return;
  }

  const fmt = {
    num: (v) => (v === null || v === undefined ? "-" : Math.round(v).toLocaleString()),
  };

  const columns = [
    ["Suite", (q) => q.suiteId],
    ["Agent", (q) => q.agentId],
    ["Run at", (q) => new Date(q.runAt).toLocaleString()],
    ["Question", (q) => q.questionId],
    ["Rep", (q) => q.repetition],
    ["Passed", (q) => (q.error ? "error" : q.passed ? "yes" : "no")],
    ["Duration (ms)", (q) => fmt.num(q.durationMs)],
    ["Input tokens", (q) => fmt.num(q.inputTokens)],
    ["Output tokens", (q) => fmt.num(q.outputTokens)],
    ["Peak context tokens", (q) => fmt.num(q.peakContextTokens)],
    ["Iterations", (q) => q.iterations],
    ["Tool calls", (q) => q.toolCallCount],
    ["Error", (q) => q.error ?? ""],
  ];

  const table = d3.select(container).append("table");

  table
    .append("thead")
    .append("tr")
    .selectAll("th")
    .data(columns)
    .join("th")
    .text(([label]) => label);

  table
    .append("tbody")
    .selectAll("tr")
    .data(rows)
    .join("tr")
    .selectAll("td")
    .data((row) => columns.map(([, get]) => get(row)))
    .join("td")
    .text((value) => value);
}
