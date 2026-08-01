// Chart 1 of the Compare Versions page: a row of KPI panels, one per headline metric, each
// showing the baseline value and every candidate's value + delta vs. that baseline. Renders one
// self-contained <svg> — title, the "Baseline: vN" line, and the candidate legend are all drawn
// inside it (not just in the surrounding ChartCard header), since that's the whole point of a
// per-chart export: the PNG/SVG has to make sense with no page around it.
//
// Contract: render(container, data, theme) where data = { baseline, candidates, suiteLabel }.
// `baseline`/each entry of `candidates` is { label, color, summary: AgentSummary, results:
// QuestionRunResult[] }. `candidates` may be empty — see the single-version branch below.
import * as d3 from "d3";
import { colorForIndex, baselineColor, deltaDirection } from "./palette.js";

export const TITLE = "Delta vs. baseline";

const METRICS = [
  {
    key: "passRate",
    label: "Pass rate",
    format: (v) => `${Math.round(v * 100)}%`,
    upIsGood: true,
    get: (s) => s.passRate,
    perCase: null, // a rate, not a per-case quantity — no whisker
  },
  {
    key: "costPerQuestion",
    label: "Cost / question",
    format: (v) => `$${v.toFixed(4)}`,
    upIsGood: false,
    get: overallCostPerQuestion,
    perCase: null, // per-case cost doesn't exist yet (Phase 0 gap report, TODO A)
  },
  {
    key: "avgDurationMs",
    label: "Avg duration",
    format: fmtMs,
    upIsGood: false,
    get: (s) => s.avgDurationMs,
    perCase: (c) => c.durationMs,
  },
  {
    key: "avgInputTokens",
    label: "Avg input tokens",
    format: fmtTokens,
    upIsGood: false,
    get: (s) => s.avgInputTokens,
    perCase: (c) => c.inputTokens,
  },
  {
    key: "avgToolCalls",
    label: "Avg tool calls",
    format: (v) => v.toFixed(1),
    upIsGood: null, // neither direction is inherently better — shown without judgment coloring
    get: (s) => s.avgToolCalls,
    perCase: (c) => c.toolCallCount,
  },
];

function overallCostPerQuestion(summary) {
  const a = summary.estCostPerQuestion;
  const b = summary.estToolCostPerQuestion;
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

function fmtMs(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}
function fmtTokens(t) {
  return Math.round(t).toLocaleString();
}

function spread(results, perCaseFn) {
  if (!perCaseFn) return null;
  const values = (results ?? []).filter((c) => c.error == null).map(perCaseFn).filter((v) => v != null);
  if (values.length === 0) return null;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
}

export default function render(container, data, theme) {
  const { baseline, candidates } = data;

  if (!baseline) {
    container.textContent = "Pick a baseline version above to see its metrics.";
    return;
  }

  const width = Math.max(container.clientWidth || 0, 640);
  const panelGap = 14;
  const panelWidth = (width - panelGap * (METRICS.length - 1)) / METRICS.length;
  const rowHeight = 30;
  const headerH = 56; // title + subtitle
  const panelTop = headerH + 14;
  const panelHeaderH = 20;
  const rows = 1 + candidates.length; // baseline row + one per candidate
  const panelH = panelHeaderH + rows * rowHeight + 8;
  const legendH = 30;
  const height = panelTop + panelH + legendH + 16;

  const svg = d3.select(container).append("svg")
    .attr("width", width).attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`);

  // Title + subtitle, baked into the SVG so an exported image is self-explanatory alone.
  svg.append("text")
    .attr("x", 0).attr("y", 20)
    .attr("fill", theme.textStrong).attr("font-family", theme.fontDisplay || theme.fontSans)
    .attr("font-size", 15).attr("font-weight", 600)
    .text(TITLE);
  svg.append("text")
    .attr("x", 0).attr("y", 40)
    .attr("fill", theme.muted).attr("font-family", theme.fontMono).attr("font-size", 11)
    .text(
      candidates.length === 0
        ? `Baseline: ${baseline.label} — absolute values (pick a candidate to compare)`
        : `Baseline: ${baseline.label} vs. ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`
    );

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
      // color, carries identity — see engineering constraints).
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
      let deltaText = null, deltaColor = theme.muted, deltaGlyph = "";
      if (value != null && baseValue != null) {
        const delta = value - baseValue;
        const pct = baseValue !== 0 ? (delta / Math.abs(baseValue)) * 100 : null;
        deltaText = pct == null ? metric.format(Math.abs(delta)) : `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
        if (metric.upIsGood == null) {
          deltaGlyph = delta > 0 ? "▲" : delta < 0 ? "▼" : "•";
          deltaColor = theme.muted;
        } else {
          const dir = deltaDirection(delta, metric.upIsGood, theme);
          deltaGlyph = dir.glyph;
          deltaColor = dir.color;
        }
      }
      drawRow(
        panelHeaderH + rowHeight * (1.55 + ci),
        value, spreadInfo,
        cand.color, theme.text,
        deltaText, deltaColor, deltaGlyph,
        "circle"
      );
    });
  });

  // Legend — baseline square + every candidate's circle/label, the same shapes/colors used in
  // every row above, so this reads correctly even cropped out of the rest of the page.
  const legend = svg.append("g").attr("transform", `translate(0,${panelTop + panelH + 20})`);
  let lx = 0;
  const legendItem = (shape, color, label) => {
    const g = legend.append("g").attr("transform", `translate(${lx},0)`);
    if (shape === "square") g.append("rect").attr("y", -8).attr("width", 8).attr("height", 8).attr("fill", color);
    else g.append("circle").attr("cx", 4).attr("cy", -4).attr("r", 4).attr("fill", color);
    const t = g.append("text")
      .attr("x", 14).attr("y", -1)
      .attr("fill", theme.muted).attr("font-family", theme.fontMono).attr("font-size", 11)
      .text(label);
    lx += 14 + (t.node()?.getComputedTextLength?.() ?? label.length * 6.5) + 20;
  };
  legendItem("square", baselineColor(theme), `Baseline · ${baseline.label}`);
  candidates.forEach((c) => legendItem("circle", c.color, c.label));
}
