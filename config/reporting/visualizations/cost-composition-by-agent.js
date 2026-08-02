// Stacked bar: token cost + tool cost, per agent, averaged across that agent's records in the
// current selection — the split the existing single-metric cost grid (agent-average-token-cost.js/
// agent-average-tool-cost.js/agent-average-overall-cost.js) can't show, since each only ever plots
// one number per agent. "Is this agent expensive because of tokens or tool calls?" is a different
// question than "how expensive is this agent," and needs both segments in one bar to answer at a
// glance. See ../README.md for the function contract.
//
// Built on the injected `chartKit` (see components/VisualizationRenderer.jsx).
export default function (container, data, { d3, halfWidth, chartKit }) {
  function avg(values) {
    const defined = values.filter((v) => v != null);
    return defined.length === 0 ? null : defined.reduce((a, b) => a + b, 0) / defined.length;
  }

  const byAgent = new Map();
  for (const r of data) {
    if (!byAgent.has(r.agentId)) byAgent.set(r.agentId, []);
    byAgent.get(r.agentId).push(r);
  }

  const bars = [...byAgent.entries()]
    .map(([agentId, records]) => ({
      agentId,
      tokenCost: avg(records.map((r) => r.summary.estCostTotal)),
      toolCost: avg(records.map((r) => r.summary.estToolCostTotal)),
    }))
    .filter((b) => b.tokenCost != null || b.toolCost != null)
    .map((b) => ({ ...b, tokenCost: b.tokenCost ?? 0, toolCost: b.toolCost ?? 0 }))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  if (bars.length === 0) {
    chartKit.showEmptyState(container, "No cost data for the selected runs.");
    return;
  }

  const theme = chartKit.readTheme(container);
  // theme.js's TOKENS->camelCase conversion only rewrites "-[a-z]" (a plain regex, not a real
  // camelCase library), so the "--accent-2" token stays keyed as theme["accent-2"] rather than
  // theme.accent2 — bracket access here, not a typo (see charts/costSplit.js for the same note).
  const accent2 = theme["accent-2"];

  const legendH = 26;
  const height = 320 + legendH;
  const margin = { top: 20, right: 20, bottom: 76 + legendH, left: 56 };
  const BAR_MAX_WIDTH = 56;

  const { svg, width } = chartKit.createChartSvg(container, { minWidth: halfWidth ?? 560, height }, theme);

  const x = d3.scaleBand().domain(bars.map((b) => b.agentId)).range([margin.left, width - margin.right]).padding(0.3);
  const y = d3.scaleLinear().domain([0, d3.max(bars, (b) => b.tokenCost + b.toolCost) ?? 0]).nice().range([height - margin.bottom, margin.top]);
  const barWidth = Math.min(x.bandwidth(), BAR_MAX_WIDTH);

  chartKit.drawHorizontalGridlines(svg, y, margin.left, width - margin.right, theme, { tickCount: 5 });
  chartKit.styleAxis(
    svg.append("g").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `$${v.toFixed(2)}`).tickSizeOuter(0)),
    theme
  );

  const xAxis = svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickSizeOuter(0));
  xAxis.select(".domain").attr("stroke", theme.border);
  xAxis.selectAll(".tick line").remove();
  xAxis.selectAll("text")
    .attr("fill", theme.text).attr("font-size", 11).attr("font-family", theme.fontMono)
    .attr("transform", "rotate(-20)").attr("dx", "-0.3em").attr("dy", "0.4em").style("text-anchor", "end");

  const tooltip = chartKit.createTooltip(container, theme);

  const groups = svg.selectAll(".cc-group").data(bars).join("g")
    .attr("class", "cc-group")
    .attr("transform", (b) => `translate(${x(b.agentId) + (x.bandwidth() - barWidth) / 2},0)`);

  // Two stacked segments (token cost bottom, tool cost top) with a 2px surface-color gap between
  // them, drawn on top rather than via stroke so it doesn't eat into either segment's height —
  // same spacer convention RunDetailPage's costSplit.js uses for its agent/judge split.
  groups.append("rect")
    .attr("x", 0).attr("y", (b) => y(b.tokenCost))
    .attr("width", barWidth).attr("height", (b) => y(0) - y(b.tokenCost))
    .attr("fill", theme.accent);

  groups.filter((b) => b.toolCost > 0).append("rect")
    .attr("x", 0).attr("y", (b) => y(b.tokenCost + b.toolCost))
    .attr("width", barWidth).attr("height", (b) => y(b.tokenCost) - y(b.tokenCost + b.toolCost))
    .attr("fill", accent2);

  groups.filter((b) => b.toolCost > 0 && b.tokenCost > 0).append("rect")
    .attr("x", 0).attr("y", (b) => y(b.tokenCost) - 1)
    .attr("width", barWidth).attr("height", 2)
    .attr("fill", theme.surface);

  groups.append("rect") // transparent hit target over the whole stacked bar
    .attr("x", 0).attr("y", (b) => y(b.tokenCost + b.toolCost))
    .attr("width", barWidth).attr("height", (b) => y(0) - y(b.tokenCost + b.toolCost))
    .attr("fill", "transparent")
    .style("cursor", "pointer")
    .attr("tabindex", 0)
    .on("mouseenter focus", function (event, b) {
      tooltip.clear();
      tooltip.node.append("div").style("font-weight", 600).style("color", theme.textStrong).text(b.agentId);
      tooltip.node.append("div").style("margin-top", "0.15rem").text(`Token cost: $${b.tokenCost.toFixed(4)}`);
      tooltip.node.append("div").text(`Tool cost: $${b.toolCost.toFixed(4)}`);
      tooltip.node.append("div").style("margin-top", "0.15rem").style("color", theme.muted)
        .text(`Total: $${(b.tokenCost + b.toolCost).toFixed(4)}`);
      const bx = x(b.agentId) + x.bandwidth() / 2;
      tooltip.showAt(bx + 12, y(b.tokenCost + b.toolCost) - 10);
    })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event, container);
      tooltip.moveTo(mx + 14, my - 10);
    })
    .on("mouseleave blur", () => tooltip.hide());

  chartKit.renderLegend(
    svg,
    [
      { shape: "square", color: theme.accent, label: "Token cost" },
      { shape: "square", color: accent2, label: "Tool cost" },
    ],
    theme,
    { x: margin.left, y: height - legendH + 14, fontSize: 10, gap: 18 }
  );
}
