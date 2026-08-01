// Beeswarm: per-case cost (token + tool) spread, one lane per agent, across every selected run —
// the Agent Comparison dashboard's other cost views (agent-average-overall-cost.js,
// cost-vs-correctness.js) only ever show an average, which hides whether an agent's cost is
// consistent or has a long tail of expensive outlier questions. See ../README.md for the
// function contract.
//
// Built on the injected `chartKit` (see components/VisualizationRenderer.jsx) — the pure,
// MAVERIK-agnostic half of frontend/src/charts/core/, the same modules Compare Versions'
// charts/distributionStrip.js is built on. This file can't `import` those directly (the
// container-only rule above), so chartKit is how "the shared toolkit is the only permitted way
// to render charts" applies here too. Low-n honesty follows the same rule as
// distributionStrip.js: real per-case dots, never a fabricated smooth distribution, and a mean
// tick drawn separately from the dots it summarizes.
export default function (container, data, { d3, halfWidth, chartKit }) {
  const cases = data.flatMap((r) => (r.results ?? []).map((c) => ({ ...c, agentId: r.agentId })));
  const byAgent = new Map();
  for (const c of cases) {
    if (c.error != null) continue;
    if (c.estCost == null && c.estToolCost == null) continue;
    const cost = (c.estCost ?? 0) + (c.estToolCost ?? 0);
    if (!byAgent.has(c.agentId)) byAgent.set(c.agentId, []);
    byAgent.get(c.agentId).push(cost);
  }

  const agentIds = [...byAgent.keys()].sort((a, b) => a.localeCompare(b));
  if (agentIds.length === 0) {
    chartKit.showEmptyState(container, "No per-case cost data for the selected runs.");
    return;
  }

  const allValues = agentIds.flatMap((id) => byAgent.get(id));
  const theme = chartKit.readTheme(container);

  const labelColW = 140;
  const laneH = 40;
  const headerH = 20;
  const margin = { right: 20 };
  const height = headerH + agentIds.length * laneH + 24;

  const fmt = (v) => `$${v.toFixed(4)}`;

  const { svg, width } = chartKit.createChartSvg(container, { minWidth: halfWidth ?? 560, height }, theme);

  const [vMin, vMax] = d3.extent(allValues);
  const pad = (vMax - vMin) * 0.08 || Math.max(0.0001, vMax * 0.1);
  const x = d3.scaleLinear()
    .domain([Math.max(0, vMin - pad), vMax + pad])
    .range([labelColW, width - margin.right])
    .nice();

  chartKit.drawVerticalGridlines(svg, x, headerH, height - 16, theme, { tickCount: 6 });
  chartKit.styleAxis(
    svg.append("g").attr("transform", `translate(0,${height - 16})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat(fmt).tickSizeOuter(0)),
    theme,
    { fontSize: 10 }
  );

  const tooltip = chartKit.createTooltip(container, theme, { padding: "0.4rem 0.6rem", fontSize: "0.75rem", fontFamily: theme.fontMono });

  agentIds.forEach((agentId, i) => {
    const values = byAgent.get(agentId);
    const laneY = headerH + i * laneH;
    const laneCenter = laneY + laneH / 2;
    const color = chartKit.colorForIndex(i);

    svg.append("text")
      .attr("x", 0).attr("y", laneCenter + 4)
      .attr("fill", theme.text).attr("font-family", theme.fontMono).attr("font-size", 11)
      .text(agentId.length > 20 ? agentId.slice(0, 19) + "…" : agentId)
      .append("title").text(agentId);

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    svg.append("line")
      .attr("x1", x(mean)).attr("x2", x(mean))
      .attr("y1", laneY + 5).attr("y2", laneY + laneH - 5)
      .attr("stroke", color).attr("stroke-width", 2).attr("opacity", 0.4);

    const nodes = chartKit.beeswarm(values, x, laneCenter, 4.5);
    svg.selectAll(null).data(nodes).enter().append("circle")
      .attr("cx", (d) => d.x).attr("cy", (d) => d.y).attr("r", 4.5)
      .attr("fill", color).attr("stroke", theme.surface).attr("stroke-width", 1.5)
      .style("cursor", "pointer")
      .on("mouseenter", function (event, d) {
        d3.select(this).attr("r", 6.5);
        tooltip.clear();
        tooltip.node.text(`${agentId}: ${fmt(d.value)}`);
        const [mx, my] = d3.pointer(event, container);
        tooltip.showAt(mx + 12, my - 10);
      })
      .on("mousemove", function (event) {
        const [mx, my] = d3.pointer(event, container);
        tooltip.moveTo(mx + 12, my - 10);
      })
      .on("mouseleave", function () {
        d3.select(this).attr("r", 4.5);
        tooltip.hide();
      });

    svg.append("text")
      .attr("x", width - margin.right).attr("y", laneY + 12)
      .attr("text-anchor", "end")
      .attr("fill", theme.muted).attr("font-family", theme.fontMono).attr("font-size", 9.5)
      .text(`n=${values.length} · mean ${fmt(mean)}`);
  });
}
