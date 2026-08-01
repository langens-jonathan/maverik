// Chart 5 of the Compare Versions page: which tools each version actually reaches for, weighted
// by call count — the "did the new prompt start hammering a different tool" check.
//
// Built as a grouped bar (tool × version), not a Sankey: a Sankey earns its complexity with a lot
// of distinct flow paths, and a single agent's version comparison typically has a handful of
// tools at most — exactly the "grouped bar if Sankey is overkill for the data volume" case the
// spec calls out. It also avoids a new dependency: d3-sankey isn't part of the `d3` package this
// app already has (only d3-force/d3-scale/etc. are bundled in), so using it would mean adding a
// library beyond "d3 for the charts." If a future MAVERIK deployment routinely compares agents
// with many interdependent tool paths, a real Sankey (with d3-sankey added deliberately, not as a
// side effect of this chart) would be the natural upgrade.
//
// Cost-per-tool is real when config/tool-costs.json prices the tool — CompareVersionsPage.jsx
// fetches it directly (a real page can just call api.getToolCostsConfig(); the old sandboxed
// visualizations can't, see the Phase 0 report's decision 1) and passes it in as data.toolCosts.
// Lookup is by tool name only, not (server, tool) — QuestionRunResult.ToolNames never recorded
// which server owned a call, so a name that exists on two different MCP servers with two
// different prices can't be disambiguated here; the backend's own per-run cost totals (computed
// server-side, scoped to the agent's actual allowed servers) remain the source of truth. This is
// a secondary, informational annotation, not a billing figure.
import * as d3 from "d3";
import { baselineColor } from "./palette.js";

export const TITLE = "Tool-usage flow";

function toolStatsFor(point) {
  const evaluated = (point.results ?? []).filter((c) => c.error == null);
  const counts = new Map();
  for (const c of evaluated) {
    for (const name of c.toolNames ?? []) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return { counts, caseCount: evaluated.length || 1 };
}

export default function render(container, data, theme) {
  const { baseline, candidates, toolCosts } = data;
  if (!baseline) {
    container.textContent = "Pick a baseline version above to see its tool usage.";
    return;
  }
  const points = [{ ...baseline, isBaseline: true }, ...candidates.map((c) => ({ ...c, isBaseline: false }))];
  const stats = points.map(toolStatsFor);

  const totalByTool = new Map();
  stats.forEach(({ counts }) => counts.forEach((n, name) => totalByTool.set(name, (totalByTool.get(name) ?? 0) + n)));
  const toolNames = [...totalByTool.keys()].sort((a, b) => totalByTool.get(b) - totalByTool.get(a));

  if (toolNames.length === 0) {
    container.textContent = "No tool calls recorded for the selected versions.";
    return;
  }

  function costFor(name) {
    return toolCosts?.find((t) => t.tool === name)?.costPerInvocation ?? null;
  }

  const bars = toolNames.flatMap((name) =>
    points.map((p, pi) => {
      const { counts, caseCount } = stats[pi];
      const calls = counts.get(name) ?? 0;
      return {
        tool: name,
        point: p,
        calls,
        avgPerCase: calls / caseCount,
        cost: costFor(name) != null ? calls * costFor(name) : null,
      };
    })
  );

  const width = Math.max(container.clientWidth || 0, 520);
  const legendH = 26;
  const height = 340 + legendH;
  const margin = { top: 56, right: 20, bottom: 70 + legendH, left: 52 };

  const svg = d3.select(container).append("svg")
    .attr("width", width).attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`);

  svg.append("text")
    .attr("x", 0).attr("y", 20)
    .attr("fill", theme.textStrong).attr("font-family", theme.fontDisplay || theme.fontSans)
    .attr("font-size", 15).attr("font-weight", 600)
    .text(TITLE);
  svg.append("text")
    .attr("x", 0).attr("y", 38)
    .attr("fill", theme.muted).attr("font-family", theme.fontMono).attr("font-size", 11)
    .text("Avg calls per case, by tool and version — a shifted mix signals behavioral drift");

  const x0 = d3.scaleBand().domain(toolNames).range([margin.left, width - margin.right]).paddingInner(0.32);
  const x1 = d3.scaleBand().domain(points.map((p) => p.label)).range([0, x0.bandwidth()]).padding(0.12);
  const y = d3.scaleLinear()
    .domain([0, d3.max(bars, (b) => b.avgPerCase) || 1])
    .nice()
    .range([height - margin.bottom, margin.top]);

  svg.selectAll(".tf-grid").data(y.ticks(5)).join("line").attr("class", "tf-grid")
    .attr("x1", margin.left).attr("x2", width - margin.right)
    .attr("y1", (v) => y(v)).attr("y2", (v) => y(v))
    .attr("stroke", theme.borderFaint).attr("stroke-width", 1);

  svg.append("g").attr("transform", `translate(${margin.left},0)`)
    .call(d3.axisLeft(y).ticks(5).tickSizeOuter(0))
    .call((g) => g.select(".domain").attr("stroke", theme.border))
    .call((g) => g.selectAll(".tick line").attr("stroke", theme.border))
    .call((g) => g.selectAll("text").attr("fill", theme.muted).attr("font-size", 10).attr("font-family", theme.fontMono));
  svg.append("text")
    .attr("transform", `translate(16,${(margin.top + height - margin.bottom) / 2}) rotate(-90)`)
    .attr("text-anchor", "middle").attr("fill", theme.muted).attr("font-family", theme.fontSans).attr("font-size", 11)
    .text("Avg calls / case");

  const xAxis = svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`)
    .call(d3.axisBottom(x0).tickSizeOuter(0));
  xAxis.select(".domain").attr("stroke", theme.border);
  xAxis.selectAll(".tick line").remove();
  xAxis.selectAll("text")
    .attr("fill", theme.text).attr("font-size", 11).attr("font-family", theme.fontMono)
    .attr("transform", "rotate(-18)").attr("text-anchor", "end").attr("dx", "-0.3em").attr("dy", "0.6em");

  const tooltip = d3.select(container).append("div")
    .style("position", "absolute").style("pointer-events", "none").style("opacity", 0)
    .style("background", theme.surfaceRaised).style("border", `1px solid ${theme.border}`)
    .style("border-radius", theme.radius || "5px").style("padding", "0.5rem 0.65rem")
    .style("font-size", "0.78rem").style("font-family", theme.fontSans).style("color", theme.text)
    .style("z-index", 10).style("box-shadow", "0 6px 18px rgba(0,0,0,0.25)");

  const groups = svg.selectAll(".tf-group").data(toolNames).join("g")
    .attr("class", "tf-group")
    .attr("transform", (name) => `translate(${x0(name)},0)`);

  const bar = groups.selectAll("rect").data((name) => bars.filter((b) => b.tool === name)).join("rect")
    .attr("x", (b) => x1(b.point.label))
    .attr("y", (b) => y(b.avgPerCase))
    .attr("width", x1.bandwidth())
    .attr("height", (b) => y(0) - y(b.avgPerCase))
    .attr("rx", 2)
    .attr("fill", (b) => (b.point.isBaseline ? baselineColor(theme) : b.point.color))
    .attr("stroke", (b) => (b.point.isBaseline ? theme.text : "none"))
    .attr("stroke-width", (b) => (b.point.isBaseline ? 1 : 0))
    .attr("stroke-dasharray", (b) => (b.point.isBaseline ? "2,2" : null))
    .style("cursor", "pointer")
    .on("mouseenter", function (event, b) {
      d3.select(this).attr("opacity", 0.8);
      tooltip.selectAll("*").remove();
      tooltip.append("div").style("font-weight", 600).style("color", theme.textStrong).text(`${b.tool} · ${b.point.label}`);
      tooltip.append("div").style("margin-top", "0.15rem").text(`${b.calls} call${b.calls === 1 ? "" : "s"} · ${b.avgPerCase.toFixed(2)}/case`);
      if (b.cost != null) tooltip.append("div").style("margin-top", "0.1rem").style("color", theme.muted).text(`≈ $${b.cost.toFixed(4)} at configured pricing`);
      const [mx, my] = d3.pointer(event, container);
      tooltip.style("left", `${mx + 14}px`).style("top", `${my - 10}px`).style("opacity", 1);
    })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event, container);
      tooltip.style("left", `${mx + 14}px`).style("top", `${my - 10}px`);
    })
    .on("mouseleave", function () {
      d3.select(this).attr("opacity", 1);
      tooltip.style("opacity", 0);
    });

  // Legend — drawn in its own reserved band below the (rotated) axis labels, not sharing space
  // with them.
  const legend = svg.append("g").attr("transform", `translate(0,${height - legendH + 14})`);
  let lx = 0;
  const legendItem = (isBaseline, color, label) => {
    const g = legend.append("g").attr("transform", `translate(${lx},0)`);
    if (isBaseline) g.append("rect").attr("y", -8).attr("width", 8).attr("height", 8).attr("fill", color);
    else g.append("circle").attr("cx", 4).attr("cy", -4).attr("r", 4).attr("fill", color);
    const t = g.append("text").attr("x", 14).attr("y", -1)
      .attr("fill", theme.muted).attr("font-family", theme.fontMono).attr("font-size", 10).text(label);
    lx += 14 + (t.node()?.getComputedTextLength?.() ?? label.length * 6) + 18;
  };
  legendItem(true, baselineColor(theme), `Baseline · ${baseline.label}`);
  candidates.forEach((c) => legendItem(false, c.color, c.label));
}
