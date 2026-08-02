// Bar chart: the *worst-case* peak context tokens per agent (AgentSummary.MaxPeakContextTokens,
// the max across every selected record) — a worst-case companion to
// agent-average-context-window.js, which only ever plots the average. An agent can look
// comfortably clear of the model's context limit on average while still having occasional cases
// that come close — the average alone hides exactly the near-miss cases worth knowing about
// before they become real failures. See ../README.md for the function contract.
//
// Built on the injected `chartKit` (see components/VisualizationRenderer.jsx).
export default function (container, data, { d3, halfWidth, chartKit }) {
  const byAgent = new Map();
  for (const r of data) {
    if (r.summary.maxPeakContextTokens == null) continue;
    const current = byAgent.get(r.agentId);
    if (current == null || r.summary.maxPeakContextTokens > current) byAgent.set(r.agentId, r.summary.maxPeakContextTokens);
  }

  const bars = [...byAgent.entries()]
    .map(([agentId, value]) => ({ agentId, value }))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  if (bars.length === 0) {
    chartKit.showEmptyState(container, "No peak-context-token data for the selected runs.");
    return;
  }

  const theme = chartKit.readTheme(container);
  const height = 280;
  const margin = { top: 20, right: 16, bottom: 64, left: 64 };
  const BAR_MAX_WIDTH = 40;

  const { svg, width } = chartKit.createChartSvg(container, { minWidth: halfWidth ?? 560, height }, theme);

  const x = d3.scaleBand().domain(bars.map((b) => b.agentId)).range([margin.left, width - margin.right]).padding(0.3);
  const y = d3.scaleLinear().domain([0, d3.max(bars, (b) => b.value) ?? 0]).nice().range([height - margin.bottom, margin.top]);
  const barWidth = Math.min(x.bandwidth(), BAR_MAX_WIDTH);

  chartKit.drawHorizontalGridlines(svg, y, margin.left, width - margin.right, theme, { tickCount: 5 });

  chartKit.styleAxis(
    svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).tickSizeOuter(0))
      .call((g) => g.selectAll("text").attr("transform", "rotate(-20)").style("text-anchor", "end")),
    theme
  );
  chartKit.styleAxis(
    svg.append("g").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => v.toLocaleString()).tickSizeOuter(0)),
    theme
  );

  const tooltip = chartKit.createTooltip(container, theme);

  svg.append("g")
    .selectAll("path")
    .data(bars)
    .join("path")
    .attr("d", (b) => chartKit.barPath(x(b.agentId) + (x.bandwidth() - barWidth) / 2, y(b.value), barWidth, height - margin.bottom, 4))
    .attr("fill", theme.accent)
    .style("cursor", "pointer")
    .style("transition", "opacity 0.12s")
    .attr("tabindex", 0)
    .on("mouseenter focus", function (event, b) {
      d3.select(this).style("opacity", 0.75);
      tooltip.clear();
      tooltip.node.append("div").style("font-weight", 600).style("color", theme.textStrong)
        .text(`${b.value.toLocaleString()} tokens (worst case)`);
      tooltip.node.append("div").style("margin-top", "0.15rem").style("color", theme.muted).text(b.agentId);
      const bx = x(b.agentId) + x.bandwidth() / 2;
      tooltip.showAt(bx + 12, y(b.value) - 10);
    })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event, container);
      tooltip.moveTo(mx + 14, my - 10);
    })
    .on("mouseleave blur", function () {
      d3.select(this).style("opacity", 1);
      tooltip.hide();
    });
}
