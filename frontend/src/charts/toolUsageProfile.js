// RunDetailPage chart: which tools this run's agent(s) actually called, weighted by call count —
// the single-run counterpart to Compare Versions' charts/toolUsageFlow.js. Deliberately a
// separate module rather than reusing toolUsageFlow.js directly: that chart renders its first
// series as a styled "baseline" (dashed border, square marker, "Baseline ·" legend prefix), which
// is the right framing for a baseline-vs-candidates comparison but would misrepresent an arbitrary
// first agent in a plain multi-agent run as a reference point it isn't. This module treats every
// agent as a peer — plain colorForIndex color, circle marker, no special-cased row.
//
// Built on the shared chart toolkit — see docs/chart-design-system.md.
import * as d3 from "d3";
import { createChartSvg } from "./core/svgFrame.js";
import { drawHorizontalGridlines, styleAxis } from "./core/axes.js";
import { createTooltip } from "./core/tooltip.js";
import { renderLegend } from "./core/legend.js";
import { showEmptyState } from "./core/emptyState.js";

export const TITLE = "Tool-usage profile";

function toolStatsFor(agent) {
  const evaluated = (agent.results ?? []).filter((c) => c.error == null);
  const counts = new Map();
  for (const c of evaluated) {
    for (const name of c.toolNames ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return { counts, caseCount: evaluated.length || 1 };
}

export default function render(container, data, theme) {
  const { agents } = data;
  if (!agents || agents.length === 0) {
    showEmptyState(container, "No agents in this run.");
    return;
  }

  const stats = agents.map(toolStatsFor);
  const totalByTool = new Map();
  stats.forEach(({ counts }) => counts.forEach((n, name) => totalByTool.set(name, (totalByTool.get(name) ?? 0) + n)));
  const toolNames = [...totalByTool.keys()].sort((a, b) => totalByTool.get(b) - totalByTool.get(a));

  if (toolNames.length === 0) {
    showEmptyState(container, "No tool calls recorded for this run.");
    return;
  }

  const bars = toolNames.flatMap((name) =>
    agents.map((a, ai) => {
      const { counts, caseCount } = stats[ai];
      const calls = counts.get(name) ?? 0;
      return { tool: name, agent: a, calls, avgPerCase: calls / caseCount };
    })
  );

  const legendH = agents.length > 1 ? 26 : 0;
  const height = 320 + legendH;
  const margin = { top: 20, right: 20, bottom: 66 + legendH, left: 48 };
  const subtitle = "Avg calls per case, by tool" + (agents.length > 1 ? " and agent" : "");

  const { svg, width } = createChartSvg(container, { minWidth: 460, height, title: TITLE, subtitle }, theme);

  const x0 = d3.scaleBand().domain(toolNames).range([margin.left, width - margin.right]).paddingInner(0.32);
  const x1 = d3.scaleBand().domain(agents.map((a) => a.label)).range([0, x0.bandwidth()]).padding(0.12);
  const y = d3.scaleLinear()
    .domain([0, d3.max(bars, (b) => b.avgPerCase) || 1])
    .nice()
    .range([height - margin.bottom, margin.top]);

  drawHorizontalGridlines(svg, y, margin.left, width - margin.right, theme, { tickCount: 5 });

  styleAxis(
    svg.append("g").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickSizeOuter(0)),
    theme,
    { fontSize: 10 }
  );
  svg.append("text")
    .attr("transform", `translate(14,${(margin.top + height - margin.bottom) / 2}) rotate(-90)`)
    .attr("text-anchor", "middle").attr("fill", theme.muted).attr("font-family", theme.fontSans).attr("font-size", 11)
    .text("Avg calls / case");

  const xAxis = svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x0).tickSizeOuter(0));
  xAxis.select(".domain").attr("stroke", theme.border);
  xAxis.selectAll(".tick line").remove();
  xAxis.selectAll("text")
    .attr("fill", theme.text).attr("font-size", 11).attr("font-family", theme.fontMono)
    .attr("transform", "rotate(-18)").attr("text-anchor", "end").attr("dx", "-0.3em").attr("dy", "0.6em");

  const tooltip = createTooltip(container, theme);

  const groups = svg.selectAll(".tup-group").data(toolNames).join("g")
    .attr("class", "tup-group")
    .attr("transform", (name) => `translate(${x0(name)},0)`);

  groups.selectAll("rect").data((name) => bars.filter((b) => b.tool === name)).join("rect")
    .attr("x", (b) => x1(b.agent.label))
    .attr("y", (b) => y(b.avgPerCase))
    .attr("width", x1.bandwidth())
    .attr("height", (b) => y(0) - y(b.avgPerCase))
    .attr("rx", 2)
    .attr("fill", (b) => b.agent.color)
    .style("cursor", "pointer")
    .on("mouseenter", function (event, b) {
      d3.select(this).attr("opacity", 0.8);
      tooltip.clear();
      tooltip.node.append("div").style("font-weight", 600).style("color", theme.textStrong).text(`${b.tool} · ${b.agent.label}`);
      tooltip.node.append("div").style("margin-top", "0.15rem").text(`${b.calls} call${b.calls === 1 ? "" : "s"} · ${b.avgPerCase.toFixed(2)}/case`);
      const [mx, my] = d3.pointer(event, container);
      tooltip.showAt(mx + 14, my - 10);
    })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event, container);
      tooltip.moveTo(mx + 14, my - 10);
    })
    .on("mouseleave", function () {
      d3.select(this).attr("opacity", 1);
      tooltip.hide();
    });

  if (agents.length > 1) {
    renderLegend(
      svg,
      agents.map((a) => ({ shape: "circle", color: a.color, label: a.label })),
      theme,
      { x: 0, y: height - legendH + 14, fontSize: 10, gap: 18, widthMultiplier: 6 }
    );
  }
}
