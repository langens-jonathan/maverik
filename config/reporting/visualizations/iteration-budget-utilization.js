// Bar chart: how much of its configured iteration budget an agent typically uses, per agent —
// avg(case.iterations / that record's agentSnapshot.maxIterations) across every evaluated case in
// the selected runs. A low pass rate paired with utilization near 100% usually means "raise
// maxIterations," while a low pass rate with low utilization means the ceiling isn't the problem.
// reliability-by-agent.js already reports the iteration-*limit-hit rate* (a 0/1 event per case);
// this is the continuous version, so a near-miss agent (finishing at iteration 7 of 8) is visible
// even though it never actually hit the limit.
//
// Uses each record's own agentSnapshot.maxIterations rather than a single assumed value per agent
// id, since two records for the same agentId can carry different snapshots (a version bump, or a
// live-config edit between runs) with different budgets.
//
// Built on the injected chartKit (see components/VisualizationRenderer.jsx) — see
// cost-per-question-distribution.js for why this file can't `import` charts/core/* directly.
export default function (container, data, { d3, halfWidth, chartKit }) {
  const byAgent = new Map();
  for (const r of data) {
    const maxIterations = r.agentSnapshot?.maxIterations;
    if (!maxIterations) continue;
    for (const c of r.results ?? []) {
      if (c.error != null) continue;
      if (!byAgent.has(r.agentId)) byAgent.set(r.agentId, []);
      byAgent.get(r.agentId).push(Math.min(1, c.iterations / maxIterations));
    }
  }

  const bars = [...byAgent.entries()]
    .map(([agentId, values]) => ({ agentId, value: values.reduce((a, b) => a + b, 0) / values.length, count: values.length }))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  if (bars.length === 0) {
    container.textContent = "No iteration-budget data for the selected runs.";
    return;
  }

  const theme = chartKit.readTheme(container);
  const height = 280;
  const margin = { top: 20, right: 16, bottom: 64, left: 56 };
  const BAR_MAX_WIDTH = 40;

  const { svg, width } = chartKit.createChartSvg(container, { minWidth: halfWidth ?? 560, height }, theme);

  const x = d3.scaleBand().domain(bars.map((b) => b.agentId)).range([margin.left, width - margin.right]).padding(0.3);
  const y = d3.scaleLinear().domain([0, 1]).range([height - margin.bottom, margin.top]);
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
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${Math.round(v * 100)}%`).tickSizeOuter(0)),
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
        .text(`${Math.round(b.value * 100)}% of iteration budget`);
      tooltip.node.append("div").style("margin-top", "0.15rem").style("color", theme.muted)
        .text(`${b.agentId} · n=${b.count} cases`);
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
