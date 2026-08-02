// Bar chart: Tool cost ($) averaged per agent, one bar per agent in `data` (average of that
// agent's selected runs). One of the 9 default per-agent-average outcome charts (see
// ../README.md).
//
// Styled per the dataviz skill: CSS custom properties (frontend/src/styles.css) so this matches
// every MAVERIK theme; a single series needs no legend (marks-and-anatomy.md) so this uses the
// app's own accent color rather than a categorical palette. Bar chart, not a line — agent ids are
// discrete, unordered categories (alphabetically sorted here only for stable display), and
// connecting them with a line falsely implies a trend/order between agents that doesn't exist
// (the earlier version of this file did exactly that; see avg-duration-by-agent.js for the same
// bar-chart pattern applied to a different grouping). This file is the single-series bar-chart
// template applied consistently across all 9 agent-average-<metric>.js files —
// runs-over-time-<metric>.js stays a line chart, since there the x-axis really is a time series.
export default function (container, data, { d3, halfWidth }) {
  const format = (v) => `$${v.toFixed(4)}`;

  const byAgent = new Map();
  for (const r of data) {
    const value = r.summary.estToolCostTotal;
    if (value === null || value === undefined) continue;
    if (!byAgent.has(r.agentId)) byAgent.set(r.agentId, []);
    byAgent.get(r.agentId).push(value);
  }

  const bars = [...byAgent.entries()]
    .map(([agentId, values]) => ({ agentId, value: values.reduce((a, b) => a + b, 0) / values.length, count: values.length }))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  if (bars.length === 0) {
    container.textContent = "No data for Tool cost ($).";
    return;
  }

  const width = halfWidth ?? 560;
  const height = 280;
  const margin = { top: 20, right: 16, bottom: 64, left: 56 };
  const BAR_MAX_WIDTH = 40;

  const root = d3.select(container).append("div").style("position", "relative");
  const svg = root.append("svg").attr("width", width).attr("height", height).style("overflow", "visible");

  const x = d3.scaleBand().domain(bars.map((b) => b.agentId)).range([margin.left, width - margin.right]).padding(0.3);
  const y = d3.scaleLinear().domain([0, d3.max(bars, (b) => b.value) ?? 0]).nice().range([height - margin.bottom, margin.top]);
  const barWidth = Math.min(x.bandwidth(), BAR_MAX_WIDTH);

  svg.append("g")
    .selectAll("line")
    .data(y.ticks(5))
    .join("line")
    .attr("x1", margin.left).attr("x2", width - margin.right)
    .attr("y1", (v) => y(v)).attr("y2", (v) => y(v))
    .attr("stroke", "var(--border-faint)").attr("stroke-width", 1);

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).tickSizeOuter(0))
    .call((g) => g.select(".domain").attr("stroke", "var(--border)"))
    .call((g) => g.selectAll(".tick line").attr("stroke", "var(--border)"))
    .call((g) => g.selectAll("text")
      .attr("fill", "var(--muted)").attr("font-size", 11).attr("font-family", "var(--font-mono)")
      .attr("transform", "rotate(-20)").style("text-anchor", "end"));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickSizeOuter(0))
    .call((g) => g.select(".domain").attr("stroke", "var(--border)"))
    .call((g) => g.selectAll(".tick line").attr("stroke", "var(--border)"))
    .call((g) => g.selectAll("text").attr("fill", "var(--muted)").attr("font-size", 11).attr("font-family", "var(--font-mono)"));

  // Top-rounded, square-at-baseline bar path (4px radius) — see avg-duration-by-agent.js.
  function barPath(bx, by, bw, baselineY, radius) {
    const r = Math.min(radius, bw / 2, Math.max(0, baselineY - by));
    return `M${bx},${baselineY} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + bw - r} Q${bx + bw},${by} ${bx + bw},${by + r} V${baselineY} Z`;
  }

  const tooltip = d3.select(container)
    .append("div")
    .style("position", "absolute").style("pointer-events", "none").style("opacity", 0)
    .style("background", "var(--surface-raised)").style("border", "1px solid var(--border)")
    .style("border-radius", "var(--radius)").style("box-shadow", "0 6px 18px rgba(0,0,0,0.25)")
    .style("padding", "0.5rem 0.65rem").style("font-size", "0.78rem").style("font-family", "var(--font-sans)")
    .style("color", "var(--text)").style("z-index", 10).style("transition", "opacity 0.1s");

  svg.append("g")
    .selectAll("path")
    .data(bars)
    .join("path")
    .attr("d", (b) => barPath(x(b.agentId) + (x.bandwidth() - barWidth) / 2, y(b.value), barWidth, height - margin.bottom, 4))
    .attr("fill", "var(--accent)")
    .style("cursor", "pointer")
    .style("transition", "opacity 0.12s")
    .attr("tabindex", 0)
    .on("mouseenter focus", function (event, b) {
      d3.select(this).style("opacity", 0.75);
      tooltip.selectAll("*").remove();
      tooltip.append("div").style("font-weight", 600).style("color", "var(--text-strong)").text(format(b.value));
      tooltip.append("div").style("margin-top", "0.15rem").style("color", "var(--muted)")
        .text(`${b.agentId} · ${b.count} run${b.count === 1 ? "" : "s"}`);
      const bx = x(b.agentId) + x.bandwidth() / 2;
      tooltip.style("left", `${bx + 12}px`).style("top", `${y(b.value) - 10}px`).style("opacity", 1);
    })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event, container);
      tooltip.style("left", `${mx + 14}px`).style("top", `${my - 10}px`);
    })
    .on("mouseleave blur", function () {
      d3.select(this).style("opacity", 1);
      tooltip.style("opacity", 0);
    });
}
