// Table: the 9 outcome parameters plus prompt-caching token averages, one row per agent — each
// cell averaged across that agent's records in `data` (nullable metrics average only over the
// records that reported them; cache columns are null for agents without prompt caching enabled).
// See ../README.md for the function contract.
export const layout = "full";
export default function (container, data, { d3 }) {
  if (data.length === 0) {
    container.textContent = "No runs selected.";
    return;
  }

  function avg(values) {
    const defined = values.filter((v) => v !== null && v !== undefined);
    return defined.length === 0 ? null : defined.reduce((a, b) => a + b, 0) / defined.length;
  }

  const byAgent = new Map();
  for (const r of data) {
    if (!byAgent.has(r.agentId)) byAgent.set(r.agentId, []);
    byAgent.get(r.agentId).push(r);
  }

  const rows = [...byAgent.entries()]
    .map(([agentId, records]) => ({
      agentId,
      runs: records.length,
      passRate: avg(records.map((r) => r.summary.passRate)),
      avgDurationMs: avg(records.map((r) => r.summary.avgDurationMs)),
      avgInputTokens: avg(records.map((r) => r.summary.avgInputTokens)),
      avgOutputTokens: avg(records.map((r) => r.summary.avgOutputTokens)),
      avgToolCalls: avg(records.map((r) => r.summary.avgToolCalls)),
      avgPeakContextTokens: avg(records.map((r) => r.summary.avgPeakContextTokens)),
      avgCacheReadInputTokens: avg(records.map((r) => r.summary.avgCacheReadInputTokens)),
      avgCacheCreationInputTokens: avg(records.map((r) => r.summary.avgCacheCreationInputTokens)),
      tokenCost: avg(records.map((r) => r.summary.estCostTotal)),
      toolCost: avg(records.map((r) => r.summary.estToolCostTotal)),
      overallCost: avg(records.map((r) => r.summary.estOverallCostTotal)),
    }))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  const fmt = {
    pct: (v) => (v === null ? "-" : `${Math.round(v * 100)}%`),
    num: (v) => (v === null ? "-" : Math.round(v).toLocaleString()),
    num1: (v) => (v === null ? "-" : v.toFixed(1)),
    usd: (v) => (v === null ? "-" : `$${v.toFixed(4)}`),
  };

  const columns = [
    ["Agent", (r) => r.agentId],
    ["Runs", (r) => r.runs],
    ["Pass rate", (r) => fmt.pct(r.passRate)],
    ["Avg duration (ms)", (r) => fmt.num(r.avgDurationMs)],
    ["Avg input tokens", (r) => fmt.num(r.avgInputTokens)],
    ["Avg output tokens", (r) => fmt.num(r.avgOutputTokens)],
    ["Avg tool calls", (r) => fmt.num1(r.avgToolCalls)],
    ["Avg peak context tokens", (r) => fmt.num(r.avgPeakContextTokens)],
    ["Avg cache read tokens", (r) => fmt.num(r.avgCacheReadInputTokens)],
    ["Avg cache creation tokens", (r) => fmt.num(r.avgCacheCreationInputTokens)],
    ["Token cost ($)", (r) => fmt.usd(r.tokenCost)],
    ["Tool cost ($)", (r) => fmt.usd(r.toolCost)],
    ["Overall cost ($)", (r) => fmt.usd(r.overallCost)],
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
