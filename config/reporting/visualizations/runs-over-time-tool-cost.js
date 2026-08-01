// Line chart: Tool cost ($) over time, one point per SuiteRunRecord in `data`, x-axis = the
// run's timestamp. One of the 9 default per-run outcome charts (see ../README.md).
//
// Styled per the dataviz skill: CSS custom properties (frontend/src/styles.css) so this matches
// every MAVERIK theme; a single series needs no legend (marks-and-anatomy.md) so this uses the
// app's own accent color rather than a categorical palette. See cost-vs-correctness.js for the
// fuller writeup — this file is the single-series line-chart template applied consistently
// across all 9 agent-average-<metric>.js and 9 runs-over-time-<metric>.js files.
export default function (container, data, { d3, halfWidth }) {
  const format = (v) => `$${v.toFixed(4)}`;

  const points = data
    .map((r) => ({ x: new Date(r.timestamp), y: r.summary.estToolCostTotal, agentId: r.agentId, suiteId: r.suiteId }))
    .filter((p) => p.y !== null && p.y !== undefined && !Number.isNaN(p.x.getTime()))
    .sort((a, b) => a.x - b.x);

  if (points.length === 0) {
    container.textContent = "No data for Tool cost ($).";
    return;
  }

  const width = halfWidth ?? 560;
  const height = 280;
  const margin = { top: 16, right: 20, bottom: 44, left: 64 };

  const root = d3.select(container).append("div").style("position", "relative");
  const svg = root.append("svg").attr("width", width).attr("height", height).style("overflow", "visible");

  const x = d3.scaleTime().domain(d3.extent(points, (p) => p.x)).range([margin.left, width - margin.right]).nice();
  const y = d3.scaleLinear().domain([0, d3.max(points, (p) => p.y) ?? 0]).nice().range([height - margin.bottom, margin.top]);

  svg.append("g")
    .selectAll("line")
    .data(y.ticks(5))
    .join("line")
    .attr("x1", margin.left).attr("x2", width - margin.right)
    .attr("y1", (v) => y(v)).attr("y2", (v) => y(v))
    .attr("stroke", "var(--border-faint)").attr("stroke-width", 1);

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(Math.min(points.length, 6)).tickSizeOuter(0))
    .call((g) => g.select(".domain").attr("stroke", "var(--border)"))
    .call((g) => g.selectAll(".tick line").attr("stroke", "var(--border)"))
    .call((g) => g.selectAll("text").attr("fill", "var(--muted)").attr("font-size", 11).attr("font-family", "var(--font-mono)"));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickSizeOuter(0))
    .call((g) => g.select(".domain").attr("stroke", "var(--border)"))
    .call((g) => g.selectAll(".tick line").attr("stroke", "var(--border)"))
    .call((g) => g.selectAll("text").attr("fill", "var(--muted)").attr("font-size", 11).attr("font-family", "var(--font-mono)"));

  const line = d3.line().x((p) => x(p.x)).y((p) => y(p.y)).curve(d3.curveMonotoneX);
  svg.append("path").datum(points).attr("fill", "none")
    .attr("stroke", "var(--accent)").attr("stroke-width", 2)
    .attr("stroke-linejoin", "round").attr("stroke-linecap", "round")
    .attr("d", line);

  const tooltip = d3.select(container)
    .append("div")
    .style("position", "absolute").style("pointer-events", "none").style("opacity", 0)
    .style("background", "var(--surface-raised)").style("border", "1px solid var(--border)")
    .style("border-radius", "var(--radius)").style("box-shadow", "0 6px 18px rgba(0,0,0,0.25)")
    .style("padding", "0.5rem 0.65rem").style("font-size", "0.78rem").style("font-family", "var(--font-sans)")
    .style("color", "var(--text)").style("z-index", 10).style("transition", "opacity 0.1s");

  const point = svg.append("g").selectAll("g").data(points).join("g").style("cursor", "pointer");

  point.append("circle")
    .attr("class", "rot-dot")
    .attr("cx", (p) => x(p.x)).attr("cy", (p) => y(p.y))
    .attr("r", 5)
    .attr("fill", "var(--accent)").attr("stroke", "var(--surface)").attr("stroke-width", 2)
    .style("transition", "r 0.12s");

  point.append("circle")
    .attr("cx", (p) => x(p.x)).attr("cy", (p) => y(p.y))
    .attr("r", 14).attr("fill", "transparent").attr("tabindex", 0)
    .on("mouseenter focus", function (event, p) {
      d3.select(this.parentNode).select(".rot-dot").attr("r", 8);
      tooltip.selectAll("*").remove();
      tooltip.append("div").style("font-weight", 600).style("color", "var(--text-strong)").text(format(p.y));
      tooltip.append("div").style("margin-top", "0.15rem").style("color", "var(--muted)").text(p.x.toLocaleString());
      tooltip.append("div").style("margin-top", "0.15rem").style("font-family", "var(--font-mono)").style("font-size", "0.75rem")
        .text(`${p.suiteId} / ${p.agentId}`);
      tooltip.style("left", `${x(p.x) + 16}px`).style("top", `${y(p.y) - 10}px`).style("opacity", 1);
    })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event, container);
      tooltip.style("left", `${mx + 14}px`).style("top", `${my - 10}px`);
    })
    .on("mouseleave blur", function () {
      d3.select(this.parentNode).select(".rot-dot").attr("r", 5);
      tooltip.style("opacity", 0);
    });
}
