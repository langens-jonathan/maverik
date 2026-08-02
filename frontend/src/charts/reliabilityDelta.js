// New chart for the Compare Versions page: error rate + iteration-limit-hit rate, baseline vs.
// every selected candidate — the reliability counterpart to deltaHeader.js's 5 headline metrics.
// Kept as its own small chart rather than folded into comparison/metrics.js's shared METRICS
// array on purpose: METRICS also drives paretoScatter.js's tooltip (every metric in that array
// shows up there), and reliability isn't part of the "which version to ship" cost/correctness
// framing that tooltip is about. Same computation reliability-by-agent.js already uses elsewhere
// (error rate over every case; iteration-limit rate over evaluated cases only, since an errored
// case never got the chance to hit the limit).
//
// Built on the shared chart toolkit — see docs/chart-design-system.md.
import { baselineColor } from "./comparison/palette.js";
import { computeDelta } from "./comparison/metrics.js";
import { createChartSvg } from "./core/svgFrame.js";
import { renderLegend } from "./core/legend.js";
import { showEmptyState } from "./core/emptyState.js";

export const TITLE = "Reliability delta";

const fmtPct = (v) => `${Math.round(v * 100)}%`;

// Metric-shaped objects (format/upIsGood/get) so computeDelta from comparison/metrics.js works
// unchanged — deliberately NOT added to the shared METRICS array, see header comment above.
const RELIABILITY_METRICS = [
  {
    label: "Error rate",
    format: fmtPct,
    upIsGood: false,
    get: (p) => {
      const results = p.results ?? [];
      return results.length === 0 ? null : results.filter((c) => c.error != null).length / results.length;
    },
  },
  {
    label: "Iteration-limit-hit rate",
    format: fmtPct,
    upIsGood: false,
    get: (p) => {
      const evaluated = (p.results ?? []).filter((c) => c.error == null);
      return evaluated.length === 0 ? null : evaluated.filter((c) => c.hitIterationLimit).length / evaluated.length;
    },
  },
];

export default function render(container, data, theme) {
  const { baseline, candidates } = data;

  if (!baseline) {
    showEmptyState(container, "Pick a baseline version above to see its reliability.");
    return;
  }
  if ((baseline.results ?? []).length === 0) {
    showEmptyState(container, "No per-case data for the selected versions.");
    return;
  }

  const panelGap = 14;
  const rowHeight = 30;
  const headerH = 56;
  const panelTop = headerH + 14;
  const panelHeaderH = 20;
  const rows = 1 + candidates.length;
  const panelH = panelHeaderH + rows * rowHeight + 8;
  const legendH = 30;
  const height = panelTop + panelH + legendH + 16;

  const subtitle = candidates.length === 0
    ? `Baseline: ${baseline.label} — absolute values (pick a candidate to compare)`
    : `Baseline: ${baseline.label} vs. ${candidates.length} candidate${candidates.length === 1 ? "" : "s"} — lower is better for both`;

  const { svg, width } = createChartSvg(container, { minWidth: 420, height, title: TITLE, subtitle, subtitleY: 40 }, theme);

  const panelWidth = (width - panelGap * (RELIABILITY_METRICS.length - 1)) / RELIABILITY_METRICS.length;

  RELIABILITY_METRICS.forEach((metric, i) => {
    const panel = svg.append("g").attr("transform", `translate(${i * (panelWidth + panelGap)},${panelTop})`);

    panel.append("rect")
      .attr("width", panelWidth).attr("height", panelH)
      .attr("fill", theme.surfaceRaised).attr("stroke", theme.borderFaint).attr("rx", 4);

    panel.append("text")
      .attr("x", 10).attr("y", 14)
      .attr("fill", theme.muted).attr("font-family", theme.fontMono).attr("font-size", 10)
      .text(metric.label.toUpperCase());

    const baseValue = metric.get(baseline);

    function drawRow(y, value, color, valueColor, deltaText, deltaColor, deltaGlyph, markerShape) {
      const row = panel.append("g").attr("transform", `translate(10,${y})`);

      if (markerShape === "square") {
        row.append("rect").attr("x", 0).attr("y", -5).attr("width", 8).attr("height", 8).attr("fill", color);
      } else {
        row.append("circle").attr("cx", 4).attr("cy", -1).attr("r", 4).attr("fill", color);
      }

      row.append("text")
        .attr("x", 14).attr("y", 3)
        .attr("fill", valueColor).attr("font-family", theme.fontMono).attr("font-size", 13).attr("font-weight", 600)
        .text(value == null ? "—" : metric.format(value));

      if (deltaText) {
        const cursorX = 14 + Math.max(46, String(value == null ? "—" : metric.format(value)).length * 7.2);
        row.append("text")
          .attr("x", cursorX).attr("y", 3)
          .attr("fill", deltaColor).attr("font-family", theme.fontMono).attr("font-size", 10.5)
          .text(`${deltaGlyph} ${deltaText}`);
      }
    }

    drawRow(panelHeaderH + rowHeight * 0.55, baseValue, baselineColor(theme), theme.textStrong, null, null, null, "square");

    candidates.forEach((cand, ci) => {
      const value = metric.get(cand);
      const d = computeDelta(metric, baseValue, value, theme);
      drawRow(panelHeaderH + rowHeight * (1.55 + ci), value, cand.color, theme.text, d.text, d.color, d.glyph, "circle");
    });
  });

  renderLegend(
    svg,
    [
      { shape: "square", color: baselineColor(theme), label: `Baseline · ${baseline.label}` },
      ...candidates.map((c) => ({ shape: "circle", color: c.color, label: c.label })),
    ],
    theme,
    { x: 0, y: panelTop + panelH + 20, fontSize: 11, gap: 20, widthMultiplier: 6.5 }
  );
}
