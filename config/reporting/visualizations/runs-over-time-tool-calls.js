// Line chart: Avg tool calls over time — one line per agent (color + legend when more than one
// agent is in the current selection; a single agent renders as before, one accent-colored line,
// no legend), x-axis = the run's timestamp. One of the 9 default per-run outcome charts (see
// ../README.md).
//
// Two things changed from the original version of this file: (1) points from different agents no
// longer connect into one blended line just because they're timestamp-adjacent — grouping by
// agent first means a chart spanning several agents' history reads as several real trends instead
// of one line zig-zagging between unrelated series (a real latent bug found while building this,
// not something the original design intended); (2) each point is checked against that same
// agent's immediately-preceding point for a changed agentSnapshot (deep-equal via
// JSON.stringify — AgentSnapshot is a plain serializable AgentConfig copy, see
// maverik/src/maverik/MaverikModels.cs), and marked with a dashed ring + a tooltip note when the
// config changed since the last recorded run — a metric shift is a lot easier to explain when
// it's visually tied to "something changed here" instead of needing to cross-reference
// agentSnapshot by hand across records.
//
// Built on the injected chartKit (see components/VisualizationRenderer.jsx) — see
// cost-per-question-distribution.js for why this file can't `import` charts/core/* directly.
export default function (container, data, { d3, halfWidth, chartKit }) {
  const format = (v) => v.toFixed(1);

  const points = data
    .map((r) => ({
      x: new Date(r.timestamp),
      y: r.summary.avgToolCalls,
      agentId: r.agentId,
      suiteId: r.suiteId,
      snapshotKey: r.agentSnapshot ? JSON.stringify(r.agentSnapshot) : null,
    }))
    .filter((p) => p.y !== null && p.y !== undefined && !Number.isNaN(p.x.getTime()));

  if (points.length === 0) {
    container.textContent = "No data for Avg tool calls.";
    return;
  }

  const theme = chartKit.readTheme(container);
  const agentIds = [...new Set(points.map((p) => p.agentId))].sort((a, b) => a.localeCompare(b));
  const colorFor = (agentId) => (agentIds.length > 1 ? chartKit.colorForIndex(agentIds.indexOf(agentId)) : theme.accent);

  // Grouped and sorted per agent — both the per-agent line series and the "changed since
  // previous" check need a real chronological order within one agent's own history, not the
  // globally timestamp-sorted list.
  const byAgent = new Map(agentIds.map((id) => [id, []]));
  for (const p of points) byAgent.get(p.agentId).push(p);
  for (const pts of byAgent.values()) {
    pts.sort((a, b) => a.x - b.x);
    pts.forEach((p, i) => {
      p.changed = i > 0 && pts[i - 1].snapshotKey !== null && p.snapshotKey !== null && pts[i - 1].snapshotKey !== p.snapshotKey;
    });
  }

  const margin = { top: 16, right: 20, bottom: 44, left: 56 };

  // Estimating width up front (mirroring createChartSvg's own Math.max(clientWidth, minWidth)
  // formula) so the legend's row count — and therefore how tall the SVG needs to be — is known
  // before the SVG itself is created. See core/legend.js's maxWidth/estimateLegendRows doc.
  const estWidth = Math.max(container.clientWidth || 0, halfWidth ?? 560);
  const legendRows = agentIds.length > 1
    ? chartKit.estimateLegendRows(agentIds.map((id) => ({ label: id })), estWidth - margin.left - margin.right)
    : 0;
  const legendH = legendRows * 26;
  const height = 280 + legendH;

  const { svg, width } = chartKit.createChartSvg(container, { minWidth: halfWidth ?? 560, height }, theme);

  const x = d3.scaleTime().domain(d3.extent(points, (p) => p.x)).range([margin.left, width - margin.right]).nice();
  const y = d3.scaleLinear().domain([0, d3.max(points, (p) => p.y) ?? 0]).nice().range([height - margin.bottom - legendH, margin.top]);

  chartKit.drawHorizontalGridlines(svg, y, margin.left, width - margin.right, theme, { tickCount: 5 });
  chartKit.styleAxis(
    svg.append("g").attr("transform", `translate(0,${height - margin.bottom - legendH})`)
      .call(d3.axisBottom(x).ticks(Math.min(points.length, 6)).tickSizeOuter(0)),
    theme
  );
  chartKit.styleAxis(
    svg.append("g").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSizeOuter(0)),
    theme
  );

  const line = d3.line().x((p) => x(p.x)).y((p) => y(p.y)).curve(d3.curveMonotoneX);
  for (const id of agentIds) {
    svg.append("path").datum(byAgent.get(id)).attr("fill", "none")
      .attr("stroke", colorFor(id)).attr("stroke-width", 2)
      .attr("stroke-linejoin", "round").attr("stroke-linecap", "round")
      .attr("d", line);
  }

  const tooltip = chartKit.createTooltip(container, theme);

  const point = svg.append("g").selectAll("g").data(points).join("g").style("cursor", "pointer");

  point.append("circle")
    .attr("class", "rot-dot")
    .attr("cx", (p) => x(p.x)).attr("cy", (p) => y(p.y))
    .attr("r", 5)
    .attr("fill", (p) => colorFor(p.agentId)).attr("stroke", theme.surface).attr("stroke-width", 2)
    .style("transition", "r 0.12s");

  // A changed-config point gets a second, larger unfilled dashed ring in theme.warn — color is
  // never the only signal (the tooltip spells it out in words too), and the ring never covers the
  // dot underneath it.
  point.filter((p) => p.changed).append("circle")
    .attr("cx", (p) => x(p.x)).attr("cy", (p) => y(p.y))
    .attr("r", 9).attr("fill", "none").attr("stroke", theme.warn).attr("stroke-width", 1.5).attr("stroke-dasharray", "2,2");

  point.append("circle")
    .attr("cx", (p) => x(p.x)).attr("cy", (p) => y(p.y))
    .attr("r", 14).attr("fill", "transparent").attr("tabindex", 0)
    .on("mouseenter focus", function (event, p) {
      d3.select(this.parentNode).select(".rot-dot").attr("r", 8);
      tooltip.clear();
      tooltip.node.append("div").style("font-weight", 600).style("color", theme.textStrong).text(format(p.y));
      tooltip.node.append("div").style("margin-top", "0.15rem").style("color", theme.muted).text(p.x.toLocaleString());
      tooltip.node.append("div").style("margin-top", "0.15rem").style("font-family", theme.fontMono).style("font-size", "0.75rem")
        .text(`${p.suiteId} / ${p.agentId}`);
      if (p.changed) {
        tooltip.node.append("div").style("margin-top", "0.25rem").style("color", theme.warn)
          .text("⚠ config changed since previous run");
      }
      const [mx, my] = d3.pointer(event, container);
      tooltip.showAt(mx + 14, my - 10);
    })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event, container);
      tooltip.moveTo(mx + 14, my - 10);
    })
    .on("mouseleave blur", function () {
      d3.select(this.parentNode).select(".rot-dot").attr("r", 5);
      tooltip.hide();
    });

  if (agentIds.length > 1) {
    chartKit.renderLegend(
      svg,
      agentIds.map((id) => ({ shape: "circle", color: colorFor(id), label: id })),
      theme,
      { x: margin.left, y: height - legendH + 14, fontSize: 10, gap: 18, maxWidth: width - margin.left - margin.right }
    );
  }
}
