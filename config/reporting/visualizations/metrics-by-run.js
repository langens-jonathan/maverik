// Table: all 9 outcome parameters, one row per SuiteRunRecord in `data` (no aggregation — each
// record's own summary values, as-is). See ../README.md for the function contract.
export const layout = "full";
export default function (container, data, { d3 }) {
  if (data.length === 0) {
    container.textContent = "No runs selected.";
    return;
  }

  const fmt = {
    pct: (v) => (v === null || v === undefined ? "-" : `${Math.round(v * 100)}%`),
    num: (v) => (v === null || v === undefined ? "-" : Math.round(v).toLocaleString()),
    num1: (v) => (v === null || v === undefined ? "-" : v.toFixed(1)),
    usd: (v) => (v === null || v === undefined ? "-" : `$${v.toFixed(4)}`),
  };

  const columns = [
    ["Suite", (r) => r.suiteId],
    ["Agent", (r) => r.agentId],
    ["Run at", (r) => new Date(r.timestamp).toLocaleString()],
    ["Pass rate", (r) => fmt.pct(r.summary.passRate)],
    ["Avg duration (ms)", (r) => fmt.num(r.summary.avgDurationMs)],
    ["Avg input tokens", (r) => fmt.num(r.summary.avgInputTokens)],
    ["Avg output tokens", (r) => fmt.num(r.summary.avgOutputTokens)],
    ["Avg tool calls", (r) => fmt.num1(r.summary.avgToolCalls)],
    ["Avg peak context tokens", (r) => fmt.num(r.summary.avgPeakContextTokens)],
    ["Token cost ($)", (r) => fmt.usd(r.summary.estCostTotal)],
    ["Tool cost ($)", (r) => fmt.usd(r.summary.estToolCostTotal)],
    ["Overall cost ($)", (r) => fmt.usd(r.summary.estOverallCostTotal)],
  ];

  const rows = [...data].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

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
