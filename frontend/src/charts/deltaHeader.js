// Chart 1 of the Compare Versions page: a row of KPI panels, one per headline metric, each
// showing the baseline value and every candidate's value + delta vs. that baseline. Renders one
// self-contained <svg> — title, the "Baseline: vN" line, and the candidate legend are all drawn
// inside it (not just in the surrounding ChartCard header), since that's the whole point of a
// per-chart export: the PNG/SVG has to make sense with no page around it.
//
// Contract: render(container, data, theme) where data = { baseline, candidates, suiteLabel }.
// `baseline`/each entry of `candidates` is { label, color, summary: AgentSummary, results:
// QuestionRunResult[] }. `candidates` may be empty — see the single-version branch below.
//
// Built on the shared chart toolkit — see docs/chart-design-system.md.
import * as d3 from "d3";
import { baselineColor } from "./comparison/palette.js";
import { METRICS, computeDelta, spread } from "./comparison/metrics.js";
import { createChartSvg } from "./core/svgFrame.js";
import { renderLegend } from "./core/legend.js";
import { showEmptyState } from "./core/emptyState.js";

export const TITLE = "Delta vs. baseline";

export default function render(container, data, theme) {
  const { baseline, candidates } = data;

  if (!baseline) {
    showEmptyState(container, "Pick a baseline version above to see its metrics.");
    return;
  }

  const panelGap = 14;
  const rowHeight = 30;
  const headerH = 56; // title + subtitle
  const panelTop = headerH + 14;
  const panelHeaderH = 20;
  const rows = 1 + candidates.length; // baseline row + one per candidate
  const panelH = panelHeaderH + rows * rowHeight + 8;
  const legendH = 30;
  const height = panelTop + panelH + legendH + 16;

  const subtitle = candidates.length === 0
    ? `Baseline: ${baseline.label} — absolute values (pick a candidate to compare)`
    : `Baseline: ${baseline.label} vs. ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`;

  const { svg, width } = createChartSvg(container, { minWidth: 640, height, title: TITLE, subtitle, subtitleY: 40 }, theme);

  const panelWidth = (width - panelGap * (METRICS.length - 1)) / METRICS.length;

  METRICS.forEach((metric, i) => {
    const panel = svg.append("g").attr("transform", `translate(${i * (panelWidth + panelGap)},${panelTop})`);

    panel.append("rect")
      .attr("width", panelWidth).attr("height", panelH)
      .attr("fill", theme.surfaceRaised).attr("stroke", theme.borderFaint).attr("rx", 4);

    panel.append("text")
      .attr("x", 10).attr("y", 14)
      .attr("fill", theme.muted).attr("font-family", theme.fontMono).attr("font-size", 10)
      .attr("text-transform", "uppercase")
      .text(metric.label.toUpperCase());

    const baseValue = metric.get(baseline.summary);
    const baseSpread = spread(baseline.results, metric.perCase);

    // A shared mini-scale across every row in this panel, so whisker widths are visually
    // comparable to each other (a narrow bar in one row really does mean tighter spread).
    const allSpreadValues = [baseSpread, ...candidates.map((c) => spread(c.results, metric.perCase))]
      .filter(Boolean)
      .flatMap((s) => [s.min, s.max]);
    const whiskerScale = allSpreadValues.length > 0
      ? d3.scaleLinear().domain(d3.extent(allSpreadValues)).range([0, 64]).clamp(true)
      : null;

    function drawRow(y, value, spreadInfo, color, valueColor, deltaText, deltaColor, deltaGlyph, markerShape) {
      const row = panel.append("g").attr("transform", `translate(10,${y})`);

      // Identity marker — square for the baseline, circle for a candidate (shape, not just
      // color, carries identity — see docs/chart-design-system.md).
      if (markerShape === "square") {
        row.append("rect").attr("x", 0).attr("y", -5).attr("width", 8).attr("height", 8).attr("fill", color);
      } else {
        row.append("circle").attr("cx", 4).attr("cy", -1).attr("r", 4).attr("fill", color);
      }

      row.append("text")
        .attr("x", 14).attr("y", 3)
        .attr("fill", valueColor).attr("font-family", theme.fontMono).attr("font-size", 13).attr("font-weight", 600)
        .text(value == null ? "—" : metric.format(value));

      let cursorX = 14 + Math.max(46, String(value == null ? "—" : metric.format(value)).length * 7.2);

      if (deltaText) {
        row.append("text")
          .attr("x", cursorX).attr("y", 3)
          .attr("fill", deltaColor).attr("font-family", theme.fontMono).attr("font-size", 10.5)
          .text(`${deltaGlyph} ${deltaText}`);
      }

      // Mini whisker: min–max line + a mean tick, right-aligned in the panel.
      if (spreadInfo && whiskerScale && spreadInfo.max > spreadInfo.min) {
        const wx = panelWidth - 76;
        const w1 = whiskerScale(spreadInfo.min);
        const w2 = whiskerScale(spreadInfo.max);
        const wm = whiskerScale(spreadInfo.mean);
        row.append("line")
          .attr("x1", wx + w1).attr("x2", wx + w2).attr("y1", -1).attr("y2", -1)
          .attr("stroke", theme.borderFaint === color ? theme.muted : color).attr("stroke-width", 2)
          .attr("opacity", 0.55);
        row.append("circle").attr("cx", wx + wm).attr("cy", -1).attr("r", 2.5).attr("fill", color);
      }
    }

    drawRow(
      panelHeaderH + rowHeight * 0.55,
      baseValue, baseSpread,
      baselineColor(theme), theme.textStrong,
      null, null, null,
      "square"
    );

    candidates.forEach((cand, ci) => {
      const value = metric.get(cand.summary);
      const spreadInfo = spread(cand.results, metric.perCase);
      const d = computeDelta(metric, baseValue, value, theme);
      drawRow(
        panelHeaderH + rowHeight * (1.55 + ci),
        value, spreadInfo,
        cand.color, theme.text,
        d.text, d.color, d.glyph,
        "circle"
      );
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
