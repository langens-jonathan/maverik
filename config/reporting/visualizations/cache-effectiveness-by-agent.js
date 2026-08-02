// Bar chart: cache-read tokens as a share of average input tokens, per agent — is Anthropic
// prompt-caching (AgentConfig.PromptCaching) actually paying off for this agent? That data exists
// today only as two extra columns (avgCacheReadInputTokens/avgCacheCreationInputTokens) in
// metrics-by-agent.js's wide table, easy to scroll past; this is the one number that answers the
// caching question directly. Agents without cache data (promptCaching disabled, or no cache reads
// reported) are simply absent from the chart rather than shown as a 0% bar — a bar at 0% would
// misleadingly read as "caching is on but not helping" instead of "caching isn't in play here."
// See ../README.md for the function contract.
//
// Filters on each record's own agentSnapshot.promptCaching rather than just checking
// avgCacheReadInputTokens for null — confirmed against real data that a non-caching agent can
// still report a literal 0 (not null) for that field, which would otherwise draw a misleading
// 0%-effective bar for an agent that was never caching in the first place.
//
// Built on the injected `chartKit` (see components/VisualizationRenderer.jsx).
export default function (container, data, { d3, halfWidth, chartKit }) {
  function avg(values) {
    const defined = values.filter((v) => v != null);
    return defined.length === 0 ? null : defined.reduce((a, b) => a + b, 0) / defined.length;
  }

  const byAgent = new Map();
  for (const r of data) {
    if (!r.agentSnapshot?.promptCaching) continue;
    if (!byAgent.has(r.agentId)) byAgent.set(r.agentId, []);
    byAgent.get(r.agentId).push(r);
  }

  const bars = [...byAgent.entries()]
    .map(([agentId, records]) => {
      const cacheRead = avg(records.map((r) => r.summary.avgCacheReadInputTokens));
      const input = avg(records.map((r) => r.summary.avgInputTokens));
      return cacheRead == null || !input ? null : { agentId, value: Math.min(1, cacheRead / input), cacheRead, input };
    })
    .filter(Boolean)
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  if (bars.length === 0) {
    chartKit.showEmptyState(container, "No agents with prompt-caching data in the selected runs.");
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
        .text(`${Math.round(b.value * 100)}% of input tokens served from cache`);
      tooltip.node.append("div").style("margin-top", "0.15rem").style("color", theme.muted)
        .text(`${b.agentId} · ${Math.round(b.cacheRead).toLocaleString()} / ${Math.round(b.input).toLocaleString()} avg tokens`);
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
