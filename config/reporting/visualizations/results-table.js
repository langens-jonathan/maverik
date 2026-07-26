// Plain <table> summary: one row per SuiteRunRecord in `data`.
// See ../README.md for the function contract.
export const layout = "full";
export default function (container, data, { d3 }) {
  const columns = [
    ["Suite", (r) => r.suiteId],
    ["Agent", (r) => r.agentId],
    ["Run at", (r) => new Date(r.timestamp).toLocaleString()],
    ["Pass rate", (r) => `${Math.round(r.summary.passRate * 100)}%`],
    ["Avg duration (ms)", (r) => Math.round(r.summary.avgDurationMs)],
    ["Avg tool calls", (r) => r.summary.avgToolCalls.toFixed(1)],
    ["Max peak context tokens", (r) => r.summary.maxPeakContextTokens ?? "-"],
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
    .data(data)
    .join("tr")
    .selectAll("td")
    .data((row) => columns.map(([, get]) => get(row)))
    .join("td")
    .text((value) => value);
}
