// Bar chart: total call count per tool name, summed across every case in every SuiteRunRecord's
// `results` in `data` — explains what's actually driving tool cost/behavior, not just the
// dollar total. See ../README.md for the function contract.
export default function (container, data, { d3 }) {
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

  const width = 560;
  const height = 280;
  const margin = { top: 20, right: 16, bottom: 76, left: 56 };
  const color = "#2a78d6";

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);

  const x = d3.scaleBand().domain(bars.map((b) => b.tool)).range([margin.left, width - margin.right]).padding(0.2);
  const y = d3.scaleLinear().domain([0, d3.max(bars, (b) => b.count) ?? 0]).nice().range([height - margin.bottom, margin.top]);

  svg
    .append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x))
    .call((g) => g.selectAll("path,line").attr("stroke", "#c3c2b7"))
    .selectAll("text")
    .attr("fill", "#52514e")
    .attr("transform", "rotate(-30)")
    .style("text-anchor", "end");

  svg
    .append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5))
    .call((g) => g.selectAll("text").attr("fill", "#52514e"))
    .call((g) => g.selectAll("path,line").attr("stroke", "#c3c2b7"));

  svg
    .append("g")
    .selectAll("rect")
    .data(bars)
    .join("rect")
    .attr("x", (b) => x(b.tool))
    .attr("y", (b) => y(b.count))
    .attr("width", x.bandwidth())
    .attr("height", (b) => y(0) - y(b.count))
    .attr("fill", color)
    .append("title")
    .text((b) => `${b.tool}: ${b.count} call${b.count === 1 ? "" : "s"}`);
}
