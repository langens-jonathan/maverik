// Bar chart: average case duration (ms) per agent, one bar per SuiteRunRecord in `data`.
// See ../README.md for the function contract.
export default function (container, data, { d3 }) {
  if (data.length === 0) {
    container.textContent = "No runs selected.";
    return;
  }

  const width = 480;
  const height = 260;
  const margin = { top: 20, right: 16, bottom: 60, left: 56 };

  const bars = data.map((r) => ({
    label: `${r.agentId} (${new Date(r.timestamp).toLocaleDateString()})`,
    value: r.summary.avgDurationMs,
  }));

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  const x = d3
    .scaleBand()
    .domain(bars.map((b) => b.label))
    .range([margin.left, width - margin.right])
    .padding(0.2);

  const y = d3
    .scaleLinear()
    .domain([0, d3.max(bars, (b) => b.value) ?? 0])
    .nice()
    .range([height - margin.bottom, margin.top]);

  svg
    .append("g")
    .attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x))
    .selectAll("text")
    .attr("transform", "rotate(-30)")
    .style("text-anchor", "end");

  svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y));

  svg
    .append("g")
    .selectAll("rect")
    .data(bars)
    .join("rect")
    .attr("x", (b) => x(b.label))
    .attr("y", (b) => y(b.value))
    .attr("width", x.bandwidth())
    .attr("height", (b) => y(0) - y(b.value))
    .attr("fill", "steelblue");
}
