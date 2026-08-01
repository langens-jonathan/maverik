// Bar chart: total call count per tool name, summed across every case in every SuiteRunRecord's
// `results` in `data` — explains what's actually driving tool cost/behavior, not just the
// dollar total. See ../README.md for the function contract.
//
// Styled per the dataviz skill: CSS custom properties so this matches every MAVERIK theme.
// Nominal, unordered categories (tool names) get ONE color for every bar
// (marks-and-anatomy.md/anti-patterns.md — a per-bar rainbow on unordered categories is an
// anti-pattern), so no legend is needed.
export default function (container, data, { d3, halfWidth }) {
  const counts = new Map();
  for (const r of data) {
    for (const c of r.results ?? []) {
      for (const tool of c.toolNames ?? []) {
        counts.set(tool, (counts.get(tool) ?? 0) + 1);
      }
    }
  }

  const bars = [...counts.entries()]
    .map(([tool, count]) => ({ tool, count }))
    .sort((a, b) => b.count - a.count);

  if (bars.length === 0) {
    container.textContent = "No tool calls in the selected runs.";
    return;
  }

  const width = halfWidth ?? 560;
  const height = 280;
  const margin = { top: 20, right: 16, bottom: 76, left: 56 };
  const BAR_MAX_WIDTH = 24;

  const root = d3.select(container).append("div").style("position", "relative");
  const svg = root.append("svg").attr("width", width).attr("height", height).style("overflow", "visible");

  const x = d3.scaleBand().domain(bars.map((b) => b.tool)).range([margin.left, width - margin.right]).padding(0.25);
  const y = d3.scaleLinear().domain([0, d3.max(bars, (b) => b.count) ?? 0]).nice().range([height - margin.bottom, margin.top]);
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
      .attr("transform", "rotate(-30)").style("text-anchor", "end"));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickSizeOuter(0))
    .call((g) => g.select(".domain").attr("stroke", "var(--border)"))
    .call((g) => g.selectAll(".tick line").attr("stroke", "var(--border)"))
    .call((g) => g.selectAll("text").attr("fill", "var(--muted)").attr("font-size", 11).attr("font-family", "var(--font-mono)"));

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
    .attr("d", (b) => barPath(x(b.tool) + (x.bandwidth() - barWidth) / 2, y(b.count), barWidth, height - margin.bottom, 4))
    .attr("fill", "var(--accent)")
    .style("cursor", "pointer")
    .style("transition", "opacity 0.12s")
    .attr("tabindex", 0)
    .on("mouseenter focus", function (event, b) {
      d3.select(this).style("opacity", 0.75);
      tooltip.selectAll("*").remove();
      tooltip.append("div").style("font-weight", 600).style("color", "var(--text-strong)")
        .text(`${b.count} call${b.count === 1 ? "" : "s"}`);
      tooltip.append("div").style("margin-top", "0.15rem").style("font-family", "var(--font-mono)").style("color", "var(--muted)").text(b.tool);
      const bx = x(b.tool) + x.bandwidth() / 2;
      tooltip.style("left", `${bx + 12}px`).style("top", `${y(b.count) - 10}px`).style("opacity", 1);
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
