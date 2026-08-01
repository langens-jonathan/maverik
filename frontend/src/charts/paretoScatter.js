// Chart 2 of the Compare Versions page: cost vs. correctness — the "which version should I ship"
// view. One point per selected version (baseline + candidates), sized by avg duration. Computes
// the Pareto-efficient frontier (minimize cost, maximize pass rate) and mutes every dominated
// point, so the efficient set reads as the chart's actual subject rather than one series among
// equals. Direct, collision-avoided labels — no legend needed since every point is already
// individually labeled (unlike cost-vs-correctness.js's N-agent version, which dropped direct
// labels specifically because they collided; the point count here is small enough that placement
// dodging is workable, per marks-and-anatomy.md's "few points" branch of that same guidance).
//
// Contract: render(container, data, theme) where data = { baseline, candidates }, entries shaped
// like { label, color, summary, results }.
//
// Built on the shared chart toolkit — see docs/chart-design-system.md.
import * as d3 from "d3";
import { baselineColor } from "./comparison/palette.js";
import { METRICS, overallCostPerQuestion, computeDelta } from "./comparison/metrics.js";
import { createChartSvg } from "./core/svgFrame.js";
import { drawHorizontalGridlines, drawVerticalGridlines, styleAxis } from "./core/axes.js";
import { placeLabels } from "./core/labelCollision.js";
import { createTooltip } from "./core/tooltip.js";
import { showEmptyState } from "./core/emptyState.js";

export const TITLE = "Cost vs. correctness";

function pointsFrom(data) {
  const all = [{ ...data.baseline, isBaseline: true }, ...data.candidates.map((c) => ({ ...c, isBaseline: false }))];
  return all
    .map((p) => ({
      ...p,
      cost: overallCostPerQuestion(p.summary),
      passRate: p.summary.passRate,
      duration: p.summary.avgDurationMs,
    }))
    .filter((p) => p.cost != null && p.passRate != null);
}

// Efficient = no other point has both lower-or-equal cost AND higher-or-equal pass rate, with at
// least one strictly better. Sorting by cost asc / passRate desc (so cost ties resolve to the
// better passRate first) then keeping running-max-passRate points gives exactly that set.
function computeFrontier(points) {
  const sorted = [...points].sort((a, b) => a.cost - b.cost || b.passRate - a.passRate);
  const frontier = [];
  let maxPassRate = -Infinity;
  for (const p of sorted) {
    if (p.passRate > maxPassRate) {
      frontier.push(p);
      maxPassRate = p.passRate;
    }
  }
  return new Set(frontier.map((p) => p.label));
}

export default function render(container, data, theme) {
  const points = pointsFrom(data);
  if (points.length === 0) {
    showEmptyState(container, "No cost/pass-rate data for the selected versions.");
    return;
  }

  const height = 380;
  const margin = { top: 56, right: 28, bottom: 44, left: 56 };
  const subtitle = "Bubble size = avg duration · muted points are cost/correctness-dominated by another version";

  const { svg, width } = createChartSvg(container, { minWidth: 560, height, title: TITLE, subtitle, subtitleY: 40 }, theme);

  const x = d3.scaleLinear().domain([0, (d3.max(points, (p) => p.cost) ?? 0) * 1.1 || 1]).range([margin.left, width - margin.right]).nice();
  const yMin = Math.min(0.9, Math.min(...points.map((p) => p.passRate)) - 0.05);
  const y = d3.scaleLinear().domain([Math.max(0, yMin), 1]).range([height - margin.bottom, margin.top]);
  const radius = d3.scaleSqrt()
    .domain([0, d3.max(points, (p) => p.duration) ?? 1])
    .range([7, 24]);

  drawHorizontalGridlines(svg, y, margin.left, width - margin.right, theme, { tickCount: 5 });
  drawVerticalGridlines(svg, x, margin.top, height - margin.bottom, theme, { tickCount: 6 });

  styleAxis(
    svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).ticks(6).tickFormat((v) => `$${v}`).tickSizeOuter(0)),
    theme
  );
  styleAxis(
    svg.append("g").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${Math.round(v * 100)}%`).tickSizeOuter(0)),
    theme
  );

  svg.append("text")
    .attr("x", (margin.left + width - margin.right) / 2).attr("y", height - 6)
    .attr("text-anchor", "middle").attr("fill", theme.muted).attr("font-family", theme.fontSans).attr("font-size", 11)
    .text("Overall cost per question");
  svg.append("text")
    .attr("transform", `translate(14,${(margin.top + height - margin.bottom) / 2}) rotate(-90)`)
    .attr("text-anchor", "middle").attr("fill", theme.muted).attr("font-family", theme.fontSans).attr("font-size", 11)
    .text("Pass rate");

  const frontierLabels = computeFrontier(points);
  const frontierPoints = points.filter((p) => frontierLabels.has(p.label)).sort((a, b) => a.cost - b.cost);

  // The frontier line itself — a step path through the efficient set, drawn behind the points.
  if (frontierPoints.length > 1) {
    const line = d3.line().x((p) => x(p.cost)).y((p) => y(p.passRate)).curve(d3.curveStepAfter);
    svg.append("path")
      .attr("d", line(frontierPoints))
      .attr("fill", "none").attr("stroke", theme.accent).attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "3,3").attr("opacity", 0.55);
  }

  const cx = (p) => x(p.cost), cy = (p) => y(p.passRate);
  const placed = placeLabels(points, cx, cy, radius);

  const tooltip = createTooltip(container, theme, { minWidth: "180px" });

  function metricRow(container_, label, value, formatFn, delta) {
    const row = container_.append("div").style("display", "flex").style("justify-content", "space-between").style("gap", "0.75rem").style("margin-top", "0.15rem");
    row.append("span").style("color", theme.muted).text(label);
    const v = row.append("span").style("font-family", theme.fontMono).style("color", theme.textStrong);
    v.append("span").text(value == null ? "—" : formatFn(value));
    if (delta && delta.text) {
      v.append("span").style("color", delta.color).style("margin-left", "0.4rem").style("font-size", "0.72rem").text(`${delta.glyph} ${delta.text}`);
    }
  }

  function showTooltip(p, atX, atY) {
    tooltip.clear();
    const head = tooltip.node.append("div").style("display", "flex").style("align-items", "center").style("gap", "0.4rem").style("margin-bottom", "0.3rem");
    head.append("span").style("width", "8px").style("height", "8px").style("border-radius", p.isBaseline ? "0" : "50%").style("background", p.isBaseline ? baselineColor(theme) : p.color).style("flex-shrink", 0);
    head.append("span").style("font-weight", 600).style("color", theme.textStrong).style("font-family", theme.fontMono).text(p.label + (p.isBaseline ? " (baseline)" : ""));
    if (!frontierLabels.has(p.label)) {
      tooltip.node.append("div").style("font-size", "0.7rem").style("color", theme.warn).style("margin-bottom", "0.25rem").text("Dominated — another version costs less and/or scores higher");
    }
    const baseSummary = data.baseline.summary;
    METRICS.forEach((m) => {
      const value = m.get(p.summary);
      const delta = p.isBaseline ? null : computeDelta(m, m.get(baseSummary), value, theme);
      metricRow(tooltip.node, m.label, value, m.format, delta);
    });
    tooltip.showAt(atX, atY);
  }

  const g = svg.selectAll(".pf-point").data(placed).join("g").attr("class", "pf-point");

  g.append("circle")
    .attr("cx", cx).attr("cy", cy).attr("r", radius)
    .attr("fill", (p) => (p.isBaseline ? baselineColor(theme) : p.color))
    .attr("stroke", theme.surface).attr("stroke-width", 2)
    .attr("opacity", (p) => (frontierLabels.has(p.label) ? 1 : 0.35));

  // Baseline gets a distinguishing shape too (a ring), not just its neutral color, matching the
  // square-vs-circle convention used in the delta header.
  g.filter((p) => p.isBaseline).append("circle")
    .attr("cx", cx).attr("cy", cy).attr("r", (p) => radius(p) + 4)
    .attr("fill", "none").attr("stroke", baselineColor(theme)).attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "2,2").attr("opacity", (p) => (frontierLabels.has(p.label) ? 0.8 : 0.3));

  g.append("text")
    .attr("x", (p) => p.labelX).attr("y", (p) => p.labelY)
    .attr("text-anchor", "middle")
    .attr("fill", (p) => (frontierLabels.has(p.label) ? theme.text : theme.muted))
    .attr("font-family", theme.fontMono).attr("font-size", 10.5)
    .style("pointer-events", "none")
    .text((p) => p.label);

  g.append("circle") // oversized hit target
    .attr("cx", cx).attr("cy", cy).attr("r", (p) => radius(p) + 8)
    .attr("fill", "transparent").attr("tabindex", 0)
    .on("mouseenter focus", function (event, p) {
      showTooltip(p, cx(p) + radius(p) + 12, cy(p) - 10);
    })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event, container);
      tooltip.moveTo(mx + 14, my - 10);
    })
    .on("mouseleave blur", () => tooltip.hide());
}
