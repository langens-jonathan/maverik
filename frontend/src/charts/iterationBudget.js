// New chart for the Compare Versions page: how much of its configured iteration budget each
// selected version typically uses — avg(case.iterations / that version's own
// agentSnapshot.maxIterations) across every evaluated case. The version-scoped counterpart to
// config/reporting/visualizations/iteration-budget-utilization.js's cross-agent view: a low pass
// rate paired with utilization climbing toward 100% across versions usually means a prompt change
// is pushing the agent closer to the ceiling before it ever shows up as an outright
// hitIterationLimit — reliabilityDelta.js's iteration-limit-hit rate is the 0/1 event version of
// this same signal, this is the continuous one.
//
// Each point uses its OWN agentSnapshot.maxIterations rather than one assumed value for the whole
// chart, since a cut version can carry a different budget than "Current" or an earlier version.
//
// Built on the shared chart toolkit — see docs/chart-design-system.md.
import * as d3 from "d3";
import { baselineColor } from "./comparison/palette.js";
import { createChartSvg } from "./core/svgFrame.js";
import { drawHorizontalGridlines, styleAxis } from "./core/axes.js";
import { createTooltip } from "./core/tooltip.js";
import { barPath } from "./core/barPath.js";
import { showEmptyState } from "./core/emptyState.js";

export const TITLE = "Iteration-budget utilization";

function statsFor(point) {
  const maxIterations = point.agentSnapshot?.maxIterations;
  if (!maxIterations) return null;
  const evaluated = (point.results ?? []).filter((c) => c.error == null);
  if (evaluated.length === 0) return null;
  const values = evaluated.map((c) => Math.min(1, c.iterations / maxIterations));
  return { value: values.reduce((a, b) => a + b, 0) / values.length, n: values.length, maxIterations };
}

export default function render(container, data, theme) {
  const { baseline, candidates } = data;
  if (!baseline) {
    showEmptyState(container, "Pick a baseline version above to see its iteration budget.");
    return;
  }

  const points = [{ ...baseline, isBaseline: true }, ...candidates.map((c) => ({ ...c, isBaseline: false }))];
  const bars = points.map((p) => ({ ...p, stats: statsFor(p) })).filter((b) => b.stats != null);

  if (bars.length === 0) {
    showEmptyState(container, "No iteration-budget data (missing maxIterations or per-case results) for the selected versions.");
    return;
  }

  const height = 300;
  const margin = { top: 56, right: 20, bottom: 44, left: 52 };
  const subtitle = "Avg iterations used / that version's configured max — each point uses its own budget";
  const BAR_MAX_WIDTH = 56;

  const { svg, width } = createChartSvg(container, { minWidth: 460, height, title: TITLE, subtitle, subtitleY: 40 }, theme);

  const x = d3.scaleBand().domain(bars.map((b) => b.label)).range([margin.left, width - margin.right]).padding(0.35);
  const y = d3.scaleLinear().domain([0, 1]).range([height - margin.bottom, margin.top]);
  const barWidth = Math.min(x.bandwidth(), BAR_MAX_WIDTH);

  drawHorizontalGridlines(svg, y, margin.left, width - margin.right, theme, { tickCount: 5 });
  styleAxis(
    svg.append("g").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${Math.round(v * 100)}%`).tickSizeOuter(0)),
    theme
  );
  styleAxis(
    svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`)
      .call(d3.axisBottom(x).tickSizeOuter(0)),
    theme
  );

  const tooltip = createTooltip(container, theme);

  const bx = (b) => x(b.label) + (x.bandwidth() - barWidth) / 2;

  svg.append("g")
    .selectAll("path")
    .data(bars)
    .join("path")
    .attr("d", (b) => barPath(bx(b), y(b.stats.value), barWidth, height - margin.bottom, 4))
    .attr("fill", (b) => (b.isBaseline ? baselineColor(theme) : b.color))
    .attr("stroke", (b) => (b.isBaseline ? theme.text : "none"))
    .attr("stroke-width", (b) => (b.isBaseline ? 1 : 0))
    .attr("stroke-dasharray", (b) => (b.isBaseline ? "2,2" : null))
    .style("cursor", "pointer")
    .attr("tabindex", 0)
    .on("mouseenter focus", function (event, b) {
      d3.select(this).attr("opacity", 0.8);
      tooltip.clear();
      tooltip.node.append("div").style("font-weight", 600).style("color", theme.textStrong)
        .text(`${Math.round(b.stats.value * 100)}% of budget · ${b.label}${b.isBaseline ? " (baseline)" : ""}`);
      tooltip.node.append("div").style("margin-top", "0.15rem").style("color", theme.muted)
        .text(`max ${b.stats.maxIterations} iterations · n=${b.stats.n} cases`);
      tooltip.showAt(bx(b) + barWidth + 10, y(b.stats.value) - 10);
    })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event, container);
      tooltip.moveTo(mx + 14, my - 10);
    })
    .on("mouseleave blur", function () {
      d3.select(this).attr("opacity", 1);
      tooltip.hide();
    });
}
