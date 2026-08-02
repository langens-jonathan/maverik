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
// visualizations can't, see docs/chart-design-system.md) and passes it in as data.toolCosts.
// Lookup is by tool name only, not (server, tool) — QuestionRunResult.ToolNames never recorded
// which server owned a call, so a name that exists on two different MCP servers with two
// different prices can't be disambiguated here; the backend's own per-run cost totals (computed
// server-side, scoped to the agent's actual allowed servers) remain the source of truth. This is
// a secondary, informational annotation, not a billing figure.
//
// Built on the shared chart toolkit — see docs/chart-design-system.md. The bottom (tool-name)
// axis keeps its custom rotated-label styling rather than going through core/axes.js's
// styleAxis — that helper covers the common case, not every axis variant.
//
// One plain-HTML link below the SVG (outside it, per the export rules — a link is a control, not
// chart content) to the baseline's configured MCP server set, not a per-bar link: the same
// tool-to-server ambiguity noted above (ToolNames never recorded which server owned a call) means
// a per-tool destination would overclaim precision this data doesn't support. Reads
// baseline.agentSnapshot.mcpServers (the frozen set actually used to produce this data) rather
// than looking up the agent's current live config, which may have drifted since.
import * as d3 from "d3";
import { baselineColor } from "./comparison/palette.js";
import { mcpServersHref } from "./comparison/links.js";
import { createChartSvg } from "./core/svgFrame.js";
import { drawHorizontalGridlines, styleAxis } from "./core/axes.js";
import { createTooltip } from "./core/tooltip.js";
import { renderLegend } from "./core/legend.js";
import { showEmptyState } from "./core/emptyState.js";

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
    showEmptyState(container, "Pick a baseline version above to see its tool usage.");
    return;
  }
  const points = [{ ...baseline, isBaseline: true }, ...candidates.map((c) => ({ ...c, isBaseline: false }))];
  const stats = points.map(toolStatsFor);

  const totalByTool = new Map();
  stats.forEach(({ counts }) => counts.forEach((n, name) => totalByTool.set(name, (totalByTool.get(name) ?? 0) + n)));
  const toolNames = [...totalByTool.keys()].sort((a, b) => totalByTool.get(b) - totalByTool.get(a));

  if (toolNames.length === 0) {
    showEmptyState(container, "No tool calls recorded for the selected versions.");
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

  const legendH = 26;
  const height = 340 + legendH;
  const margin = { top: 56, right: 20, bottom: 70 + legendH, left: 52 };
  const subtitle = "Avg calls per case, by tool and version — a shifted mix signals behavioral drift";

  const { svg, width } = createChartSvg(container, { minWidth: 520, height, title: TITLE, subtitle }, theme);

  const x0 = d3.scaleBand().domain(toolNames).range([margin.left, width - margin.right]).paddingInner(0.32);
  const x1 = d3.scaleBand().domain(points.map((p) => p.label)).range([0, x0.bandwidth()]).padding(0.12);
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

  const tooltip = createTooltip(container, theme);

  const groups = svg.selectAll(".tf-group").data(toolNames).join("g")
    .attr("class", "tf-group")
    .attr("transform", (name) => `translate(${x0(name)},0)`);

  groups.selectAll("rect").data((name) => bars.filter((b) => b.tool === name)).join("rect")
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
      tooltip.clear();
      tooltip.node.append("div").style("font-weight", 600).style("color", theme.textStrong).text(`${b.tool} · ${b.point.label}`);
      tooltip.node.append("div").style("margin-top", "0.15rem").text(`${b.calls} call${b.calls === 1 ? "" : "s"} · ${b.avgPerCase.toFixed(2)}/case`);
      if (b.cost != null) tooltip.node.append("div").style("margin-top", "0.1rem").style("color", theme.muted).text(`≈ $${b.cost.toFixed(4)} at configured pricing`);
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

  renderLegend(
    svg,
    [
      { shape: "square", color: baselineColor(theme), label: `Baseline · ${baseline.label}` },
      ...candidates.map((c) => ({ shape: "circle", color: c.color, label: c.label })),
    ],
    theme,
    { x: 0, y: height - legendH + 14, fontSize: 10, gap: 18, widthMultiplier: 6 }
  );

  const servers = baseline.agentSnapshot?.mcpServers ?? [];
  if (servers.length > 0) {
    // Not .field-hint — that class's --muted color would win over the global a{color:--accent}
    // rule by specificity, making this not read as a link at all.
    d3.select(container).append("a")
      .attr("href", mcpServersHref(servers))
      .style("display", "inline-block")
      .style("margin-top", "0.5rem")
      .style("font-size", "0.74rem")
      .text(`View this agent's MCP servers (${servers.length}) →`);
  }
}
