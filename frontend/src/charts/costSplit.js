// RunDetailPage chart: agent cost vs. judge cost, shown as one split horizontal bar instead of
// the two costs sitting in unrelated places (previously: a per-agent BarRow for agent cost, and a
// single "Judge overhead: ..." text line elsewhere on the page with no visual link between them).
// A run's LLM-judge overhead isn't attributable to a specific agent (MaverikSummary.JudgeOverhead
// is a run-level total, not per-agent), so this deliberately shows one bar for the whole run
// rather than per-agent segments — showing it broken out per agent would imply a precision the
// backend data doesn't have.
//
// Built on the shared chart toolkit — see docs/chart-design-system.md.
import * as d3 from "d3";
import { createChartSvg } from "./core/svgFrame.js";
import { createTooltip } from "./core/tooltip.js";
import { renderLegend } from "./core/legend.js";
import { showEmptyState } from "./core/emptyState.js";

export const TITLE = "Agent cost vs. judge cost";

export default function render(container, data, theme) {
  const { agentCost, judgeCost } = data;
  const total = (agentCost ?? 0) + (judgeCost ?? 0);
  if (!judgeCost || total <= 0) {
    showEmptyState(container, "No llm-judge criteria in this run — nothing to split.");
    return;
  }

  const height = 108;
  const margin = { top: 44, right: 20, bottom: 20, left: 20 };
  const barH = 28;
  const subtitle = "What fraction of run cost is evaluation overhead, not agent work";

  const { svg, width } = createChartSvg(container, { minWidth: 420, height, title: TITLE, subtitle }, theme);

  // theme.js's TOKENS->camelCase conversion only rewrites "-[a-z]" (a plain regex, not a real
  // camelCase library), so the "--accent-2" token stays keyed as theme["accent-2"] rather than
  // theme.accent2 — bracket access here, not a typo.
  const accent2 = theme["accent-2"];

  const barW = width - margin.left - margin.right;
  const x = d3.scaleLinear().domain([0, total]).range([0, barW]);
  const agentW = x(agentCost ?? 0);
  const judgeW = barW - agentW;
  const barY = margin.top;

  const segments = [
    { key: "agent", color: theme.accent, x: 0, w: agentW, value: agentCost ?? 0, label: "Agent cost" },
    { key: "judge", color: accent2, x: agentW, w: judgeW, value: judgeCost, label: "Judge cost" },
  ].filter((s) => s.w > 0);

  const g = svg.append("g").attr("transform", `translate(${margin.left},0)`);

  g.selectAll("rect").data(segments).join("rect")
    .attr("x", (s) => s.x).attr("y", barY).attr("width", (s) => s.w).attr("height", barH)
    .attr("fill", (s) => s.color)
    .style("cursor", "pointer");

  // 2px surface-color separator between the two segments (marks-and-anatomy.md's spacer rule),
  // drawn on top rather than relying on stroke so it doesn't eat into either segment's width.
  if (segments.length === 2) {
    g.append("rect").attr("x", agentW - 1).attr("y", barY).attr("width", 2).attr("height", barH)
      .attr("fill", theme.surface);
  }

  const tooltip = createTooltip(container, theme);
  g.selectAll("rect").filter((s) => !!s.key)
    .on("mouseenter", function (event, s) {
      d3.select(this).attr("opacity", 0.85);
      tooltip.clear();
      tooltip.node.append("div").style("font-weight", 600).style("color", theme.textStrong)
        .text(`$${s.value.toFixed(4)}`);
      tooltip.node.append("div").style("margin-top", "0.15rem")
        .text(`${s.label} · ${Math.round((s.value / total) * 100)}% of run cost`);
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
      { shape: "square", color: theme.accent, label: `Agent · $${(agentCost ?? 0).toFixed(4)}` },
      { shape: "square", color: accent2, label: `Judge · $${judgeCost.toFixed(4)}` },
    ],
    theme,
    { x: margin.left, y: barY + barH + 22, fontSize: 11, gap: 20 }
  );
}
