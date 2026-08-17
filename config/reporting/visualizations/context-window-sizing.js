// Table: how large a context window each agent actually needs, for right-sizing a local model
// server's --ctx-size/n_ctx (and therefore its RAM). peak-context-ceiling-by-agent.js already
// charts the raw worst-case number; this turns it into an actionable recommendation and checks
// it against whatever window is currently configured (LLMModelConfig.ContextWindowTokens, via
// AgentSummary.configuredContextWindowTokens).
//
// One row per agentId, taken from the single selected SuiteRunRecord with the highest
// summary.maxPeakContextTokens (not averaged/summed — a sizing decision has to cover the worst
// case, not the typical one). Recommended window = that peak + 20% headroom (a suite is a sample
// of expected traffic, not exhaustive coverage), rounded up to the next power of two — the
// conventional way local inference servers' context-size knobs are set (4096/8192/16384/...).
// No RAM estimate: KV-cache bytes-per-token depends on model-specific architecture (layers,
// hidden size, attention heads, quantization) that nothing here can discover — feed the token
// count into your own model-specific hardware-sizing tool instead. See ../README.md.
export const layout = "full";
export default function (container, data, { d3 }) {
  const withPeak = data.filter((r) => r.summary.maxPeakContextTokens != null);
  if (withPeak.length === 0) {
    container.textContent = "No peak-context-token data for the selected runs.";
    return;
  }

  const byAgent = new Map();
  for (const r of withPeak) {
    const current = byAgent.get(r.agentId);
    if (!current || r.summary.maxPeakContextTokens > current.summary.maxPeakContextTokens) {
      byAgent.set(r.agentId, r);
    }
  }

  function recommendedWindow(maxPeak) {
    const withMargin = maxPeak * 1.2;
    return Math.pow(2, Math.ceil(Math.log2(Math.max(1, withMargin))));
  }

  function status(maxPeak, configured) {
    if (configured == null) return "not configured";
    return maxPeak > configured ? "exceeds configured window" : "ok";
  }

  const rows = [...byAgent.values()]
    .map((r) => ({
      agentId: r.agentId,
      maxPeak: r.summary.maxPeakContextTokens,
      recommended: recommendedWindow(r.summary.maxPeakContextTokens),
      configured: r.summary.configuredContextWindowTokens ?? null,
      status: status(r.summary.maxPeakContextTokens, r.summary.configuredContextWindowTokens),
      suiteId: r.suiteId,
      timestamp: r.timestamp,
    }))
    .sort((a, b) => b.maxPeak - a.maxPeak); // worst-first: what's worth acting on surfaces at the top

  const columns = [
    ["Agent", (r) => r.agentId],
    ["Max peak context observed", (r) => r.maxPeak.toLocaleString()],
    ["Recommended context window", (r) => r.recommended.toLocaleString()],
    ["Configured window", (r) => (r.configured == null ? "not configured" : r.configured.toLocaleString())],
    ["Status", (r) => r.status],
    ["Observed in", (r) => `${r.suiteId} · ${new Date(r.timestamp).toLocaleString()}`],
  ];

  // Resolved to a literal color via getComputedStyle, not a CSS class — this file can't `import`
  // core/theme.js's readTheme (see ../README.md's container-only rule), same reasoning
  // question-pass-rate-matrix.js documents for its own heatmap coloring.
  const badColor = getComputedStyle(container).getPropertyValue("--bad").trim();

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
    .data((row) => columns.map(([label, get]) => ({ label, value: get(row), row })))
    .join("td")
    .style("color", (d) => (d.label === "Status" && d.row.status === "exceeds configured window" ? badColor : null))
    .style("font-weight", (d) => (d.label === "Status" && d.row.status === "exceeds configured window" ? 600 : null))
    .text((d) => d.value);
}
