// Line chart: Avg peak context tokens averaged per agent, one point per agent in `data` (x-axis =
// agent id, y-axis = the average of avg peak context tokens across that agent's selected runs).
// One of the 9 default per-agent-average outcome charts (see ../README.md).
export default function (container, data, { d3 }) {
  const format = (v) => Math.round(v).toLocaleString();

  const byAgent = new Map();
  for (const r of data) {
    const value = r.summary.avgPeakContextTokens;
    if (value === null || value === undefined) continue;
    if (!byAgent.has(r.agentId)) byAgent.set(r.agentId, []);
    byAgent.get(r.agentId).push(value);
  }

  const points = [...byAgent.entries()]
    .map(([agentId, values]) => ({ agentId, y: values.reduce((a, b) => a + b, 0) / values.length, count: values.length }))
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  if (points.length === 0) {
    container.textContent = "No data for Avg peak context tokens.";
    return;
  }

  const width = 560;
  const height = 280;
  const margin = { top: 16, right: 20, bottom: 72, left: 64 };
  const color = "#2a78d6";

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);

  const x = d3.scalePoint().domain(points.map((p) => p.agentId)).range([margin.left, width - margin.right]).padding(0.5);
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
    .call(d3.axisBottom(x))
    .call((g) => g.selectAll("text").attr("fill", "#52514e").attr("transform", "rotate(-20)").style("text-anchor", "end"))
    .call((g) => g.selectAll("path,line").attr("stroke", "#c3c2b7"));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5))
    .call((g) => g.selectAll("text").attr("fill", "#52514e"))
    .call((g) => g.selectAll("path,line").attr("stroke", "#c3c2b7"));

  const line = d3.line().x((p) => x(p.agentId)).y((p) => y(p.y));
  svg.append("path").datum(points).attr("fill", "none").attr("stroke", color).attr("stroke-width", 2).attr("d", line);

  svg.append("g")
    .selectAll("circle")
    .data(points)
    .join("circle")
    .attr("cx", (p) => x(p.agentId))
    .attr("cy", (p) => y(p.y))
    .attr("r", 4)
    .attr("fill", color)
    .attr("stroke", "#fcfcfb")
    .attr("stroke-width", 2)
    .append("title")
    .text((p) => `${p.agentId} (${p.count} run${p.count === 1 ? "" : "s"})\nAvg peak context tokens: ${format(p.y)}`);
}
