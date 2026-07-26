// Line chart: Avg duration (ms) over time, one point per SuiteRunRecord in `data`, x-axis = the
// run's timestamp. One of the 9 default per-run outcome charts (see ../README.md).
export default function (container, data, { d3, halfWidth }) {
  const format = (v) => Math.round(v).toLocaleString();

  const points = data
    .map((r) => ({ x: new Date(r.timestamp), y: r.summary.avgDurationMs, agentId: r.agentId, suiteId: r.suiteId }))
    .filter((p) => p.y !== null && p.y !== undefined && !Number.isNaN(p.x.getTime()))
    .sort((a, b) => a.x - b.x);

  if (points.length === 0) {
    container.textContent = "No data for Avg duration (ms).";
    return;
  }

  const width = halfWidth ?? 560;
  const height = 280;
  const margin = { top: 16, right: 20, bottom: 44, left: 64 };
  const color = "#2a78d6";

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);

  const x = d3.scaleTime().domain(d3.extent(points, (p) => p.x)).range([margin.left, width - margin.right]).nice();
  const y = d3.scaleLinear().domain([0, d3.max(points, (p) => p.y) ?? 0]).nice().range([height - margin.bottom, margin.top]);

  svg.append("g")
    .attr("stroke", "#e1e0d9")
    .selectAll("line")
    .data(y.ticks(5))
    .join("line")
    .attr("x1", margin.left)
    .attr("x2", width - margin.right)
    .attr("y1", (v) => y(v))
    .attr("y2", (v) => y(v));

  svg.append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x).ticks(Math.min(points.length, 6)))
    .call((g) => g.selectAll("text").attr("fill", "#52514e"))
    .call((g) => g.selectAll("path,line").attr("stroke", "#c3c2b7"));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5))
    .call((g) => g.selectAll("text").attr("fill", "#52514e"))
    .call((g) => g.selectAll("path,line").attr("stroke", "#c3c2b7"));

  const line = d3.line().x((p) => x(p.x)).y((p) => y(p.y));
  svg.append("path").datum(points).attr("fill", "none").attr("stroke", color).attr("stroke-width", 2).attr("d", line);

  svg.append("g")
    .selectAll("circle")
    .data(points)
    .join("circle")
    .attr("cx", (p) => x(p.x))
    .attr("cy", (p) => y(p.y))
    .attr("r", 4)
    .attr("fill", color)
    .attr("stroke", "#fcfcfb")
    .attr("stroke-width", 2)
    .append("title")
    .text((p) => `${p.suiteId} / ${p.agentId}\n${p.x.toLocaleString()}\nAvg duration (ms): ${format(p.y)}`);
}
