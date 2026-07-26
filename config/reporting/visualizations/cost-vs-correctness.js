// Scatter: overall cost vs. pass rate, one point per agent in `data` (both averaged across that
// agent's records in the current selection) — the accuracy-per-dollar tradeoff view none of the
// single-metric line charts show. See ../README.md for the function contract.
export default function (container, data, { d3, halfWidth }) {
  function avg(values) {
    const defined = values.filter((v) => v !== null && v !== undefined);
    return defined.length === 0 ? null : defined.reduce((a, b) => a + b, 0) / defined.length;
  }

  const byAgent = new Map();
  for (const r of data) {
    if (!byAgent.has(r.agentId)) byAgent.set(r.agentId, []);
    byAgent.get(r.agentId).push(r);
  }

  const points = [...byAgent.entries()]
    .map(([agentId, records]) => ({
      agentId,
      cost: avg(records.map((r) => r.summary.estOverallCostTotal)),
      passRate: avg(records.map((r) => r.summary.passRate)),
    }))
    .filter((p) => p.cost !== null && p.passRate !== null);

  if (points.length === 0) {
    container.textContent = "No cost/pass-rate data for the selected runs.";
    return;
  }

  const width = halfWidth ?? 560;
  const height = 320;
  const margin = { top: 16, right: 96, bottom: 44, left: 64 };
  const color = "#2a78d6";

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);

  const x = d3.scaleLinear().domain([0, d3.max(points, (p) => p.cost) ?? 0]).nice().range([margin.left, width - margin.right]);
  const y = d3.scaleLinear().domain([0, 1]).range([height - margin.bottom, margin.top]);

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
    .call(d3.axisBottom(x).ticks(6).tickFormat((v) => `$${v}`))
    .call((g) => g.selectAll("text").attr("fill", "#52514e"))
    .call((g) => g.selectAll("path,line").attr("stroke", "#c3c2b7"));

  svg.append("g")
    .attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${Math.round(v * 100)}%`))
    .call((g) => g.selectAll("text").attr("fill", "#52514e"))
    .call((g) => g.selectAll("path,line").attr("stroke", "#c3c2b7"));

  const points_ = svg.append("g").selectAll("g").data(points).join("g");

  points_
    .append("circle")
    .attr("cx", (p) => x(p.cost))
    .attr("cy", (p) => y(p.passRate))
    .attr("r", 5)
    .attr("fill", color)
    .attr("stroke", "#fcfcfb")
    .attr("stroke-width", 2)
    .append("title")
    .text((p) => `${p.agentId}\nCost: $${p.cost.toFixed(4)}\nPass rate: ${Math.round(p.passRate * 100)}%`);

  points_
    .append("text")
    .attr("x", (p) => x(p.cost) + 8)
    .attr("y", (p) => y(p.passRate) + 4)
    .attr("fill", "#0b0b0b")
    .attr("font-size", 12)
    .text((p) => p.agentId);
}
