// Chart 3 of the Compare Versions page — the pre-ship safety check and stated centerpiece: rows
// = suite questions, columns = baseline + candidates, cells = pass fraction across repetitions.
// Three interactive modes, all handled as internal chart state (same pattern
// cost-vs-correctness.js already established for its legend collapse/deselect — a local redraw()
// closure, not a React re-render) so toggling doesn't require new data from the page:
//   - Annotation: fraction (always shown) plus an optional tokens or cost line. Cost reads
//     QuestionRunResult.EstCost/EstToolCost (per-case cost — see docs/chart-design-system.md's
//     low-n rules for why per-case, not just per-agent-aggregate, data matters here).
//   - Diff vs. baseline: recolors candidate cells by CHANGE from baseline instead of absolute
//     pass rate — unchanged cells recede, regressions (red) and fixes (green) are what's left to
//     look at.
//   - Sort: regressions-first, by how much each row's candidates fell vs. baseline.
//
// Contract: render(container, data, theme) where data = { agentId, baseline, candidates }.
//
// Every cell with at least one recorded case (evaluated or errored) is wrapped in a real SVG <a>
// to runCaseHref(point.sourceRunId, data.agentId, point.version, questionId) — the "pre-ship
// safety check" chart's whole point is drilling into a specific failure, so this is the marquee
// cross-navigation link on the page. A cell with zero cases at all (the "–" empty state) stays a
// plain <g>; there's nothing to open. Same full-page-navigation trade-off as paretoScatter.js's
// point links — see that file's header comment.
//
// Built on the shared chart toolkit — see docs/chart-design-system.md. This chart doesn't use
// axes/gridlines/beeswarm/label-collision (it's a cell grid, not a scaled plot) and keeps its one
// native SVG <title> tooltip (the error-count badge) as-is rather than converting it to the
// floating-div tooltip used elsewhere — noted as a deliberate deferral, not an oversight, since
// this refactor's acceptance test is zero visual/behavioral regression.
import * as d3 from "d3";
import { baselineColor } from "./comparison/palette.js";
import { runCaseHref } from "./comparison/links.js";
import { createChartSvg } from "./core/svgFrame.js";
import { showEmptyState } from "./core/emptyState.js";

export const TITLE = "Per-question regression matrix";

function avg(values) {
  const defined = values.filter((v) => v != null);
  return defined.length === 0 ? null : defined.reduce((a, b) => a + b, 0) / defined.length;
}

// Same luminance-based contrast switch config/reporting/visualizations/question-pass-rate-matrix.js
// already uses for its heatmap cells — a fill-color-dependent text color, not a fixed guess, so
// text stays legible across the full bad→ok ramp and across diff-mode's solid fills alike.
function textColorFor(fillColor) {
  const c = d3.color(fillColor);
  if (!c) return "#111";
  const { r, g, b } = c.rgb();
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? "#111" : "#fff";
}

function cellFor(point, questionId) {
  const cases = (point.results ?? []).filter((c) => c.questionId === questionId);
  const evaluated = cases.filter((c) => c.error == null);
  const passed = evaluated.filter((c) => c.passed).length;
  return {
    passFraction: evaluated.length === 0 ? null : passed / evaluated.length,
    passed,
    n: evaluated.length,
    total: cases.length,
    errors: cases.length - evaluated.length,
    tokens: avg(evaluated.map((c) => (c.inputTokens != null && c.outputTokens != null ? c.inputTokens + c.outputTokens : null))),
    cost: avg(evaluated.map((c) => (c.estCost == null && c.estToolCost == null ? null : (c.estCost ?? 0) + (c.estToolCost ?? 0)))),
  };
}

export default function render(container, data, theme) {
  const { baseline, candidates } = data;
  if (!baseline) {
    showEmptyState(container, "Pick a baseline version above to see its questions.");
    return;
  }

  const points = [{ ...baseline, isBaseline: true }, ...candidates.map((c) => ({ ...c, isBaseline: false }))];
  const questionIds = [...new Set(points.flatMap((p) => (p.results ?? []).map((c) => c.questionId)))];

  if (questionIds.length === 0) {
    showEmptyState(container, "No per-question results for the selected versions.");
    return;
  }

  const rowsBase = questionIds.map((questionId) => ({
    questionId,
    cells: points.map((p) => cellFor(p, questionId)),
  }));

  function regressionScore(row) {
    const baseFrac = row.cells[0].passFraction ?? 0;
    return row.cells.slice(1).reduce((acc, cell) => acc + Math.max(0, baseFrac - (cell.passFraction ?? 0)), 0);
  }

  // --- controls (plain HTML, sit above the exported SVG — same "meta-UI outside the chart
  // image" split cost-vs-correctness.js's legend-collapse button already uses) ---
  const state = { annotation: "fraction", diffMode: false, sortRegressions: false };

  const controls = d3.select(container).append("div")
    .style("display", "flex").style("gap", "0.5rem").style("margin-bottom", "0.6rem").style("flex-wrap", "wrap");

  // Every toggle button's active/inactive style is re-applied from `state` after any click (not
  // just the clicked button's own) — several buttons here are part of the same mutually-exclusive
  // group (annotation: fraction/tokens/cost), so clicking one has to visually deactivate another.
  const buttons = [];
  function toggleButton(label, isActive, onClick, opts = {}) {
    const btn = controls.append("button")
      .attr("type", "button")
      .style("font", "inherit").style("font-family", theme.fontSans).style("font-size", "0.72rem")
      .style("padding", "0.25rem 0.6rem").style("border-radius", theme.radius || "5px")
      .style("cursor", opts.disabled ? "not-allowed" : "pointer")
      .attr("title", opts.title ?? null)
      .text(label);
    if (!opts.disabled) btn.on("click", () => { onClick(); refreshButtons(); redraw(); });
    buttons.push({ btn, isActive, disabled: !!opts.disabled });
    return btn;
  }
  function refreshButtons() {
    for (const { btn, isActive, disabled } of buttons) {
      const active = !disabled && isActive();
      btn.style("border", `1px solid ${active ? theme.accent : theme.border}`)
        .style("background", active ? theme.accentWash : "transparent")
        .style("color", disabled ? theme.muted : active ? theme.accentStrong : theme.text)
        .style("opacity", disabled ? 0.5 : 1);
    }
  }

  toggleButton("Tokens", () => state.annotation === "tokens", () => {
    state.annotation = state.annotation === "tokens" ? "fraction" : "tokens";
  });
  toggleButton("Cost", () => state.annotation === "cost", () => {
    state.annotation = state.annotation === "cost" ? "fraction" : "cost";
  });
  toggleButton("Diff vs. baseline", () => state.diffMode, () => {
    state.diffMode = !state.diffMode;
  });
  toggleButton("Regressions first", () => state.sortRegressions, () => {
    state.sortRegressions = !state.sortRegressions;
  }, { disabled: candidates.length === 0, title: candidates.length === 0 ? "Needs at least one candidate" : undefined });

  refreshButtons();

  const svgHost = d3.select(container).append("div");

  function redraw() {
    svgHost.selectAll("*").remove();

    const rows = state.sortRegressions
      ? [...rowsBase].sort((a, b) => regressionScore(b) - regressionScore(a))
      : rowsBase;

    const labelColW = 150;
    const headerH = 74; // title + subtitle + column header row
    const rowH = 36;
    const height = headerH + rows.length * rowH + 12;
    const subtitle = state.diffMode
      ? "Diff vs. baseline — only changed cells are colored · click a cell to open its case"
      : "Pass fraction per question, across repetitions · click a cell to open its case";

    const { svg, width } = createChartSvg(svgHost.node(), { minWidth: 480, height, title: TITLE, subtitle }, theme);
    const colW = Math.max(76, (width - labelColW) / points.length);

    // Column headers.
    const headerY = 58;
    points.forEach((p, ci) => {
      const cx = labelColW + ci * colW;
      const g = svg.append("g").attr("transform", `translate(${cx},${headerY})`);
      if (p.isBaseline) {
        g.append("rect").attr("x", 2).attr("y", -9).attr("width", 8).attr("height", 8).attr("fill", baselineColor(theme));
      } else {
        g.append("circle").attr("cx", 6).attr("cy", -5).attr("r", 4).attr("fill", p.color);
      }
      g.append("text")
        .attr("x", 14).attr("y", 0)
        .attr("fill", theme.textStrong).attr("font-family", theme.fontMono).attr("font-size", 11).attr("font-weight", 600)
        .text(p.label + (p.isBaseline ? " (baseline)" : ""));
    });

    const gridTop = headerH;
    const cellPad = 2;

    const rowGroups = svg.selectAll(".rm-row").data(rows, (d) => d.questionId).join("g")
      .attr("class", "rm-row")
      .attr("transform", (d, i) => `translate(0,${gridTop + i * rowH})`);

    rowGroups.append("text")
      .attr("x", 0).attr("y", rowH / 2 + 4)
      .attr("fill", theme.text).attr("font-family", theme.fontMono).attr("font-size", 11)
      .text((d) => d.questionId)
      .append("title")
      .text((d) => d.questionId);

    rowGroups.each(function (row) {
      const rg = d3.select(this);
      const baseFrac = row.cells[0].passFraction;

      row.cells.forEach((cell, ci) => {
        const cx = labelColW + ci * colW;
        const point = points[ci];
        const isBaseline = point.isBaseline;
        const delta = isBaseline || baseFrac == null || cell.passFraction == null ? null : cell.passFraction - baseFrac;
        const changed = delta != null && Math.abs(delta) > 1e-9;

        let fill = theme.surfaceRaised;
        if (cell.passFraction == null) {
          fill = theme.surfaceRaised;
        } else if (!state.diffMode || isBaseline) {
          fill = d3.interpolateRgb(theme.bad, theme.ok)(cell.passFraction);
        } else if (changed) {
          fill = delta < 0 ? theme.bad : theme.ok;
        }

        const linkable = !!point.sourceRunId && cell.total > 0;
        const cellG = rg.append(linkable ? "a" : "g").attr("transform", `translate(${cx + cellPad},${cellPad})`);
        if (linkable) {
          cellG
            .attr("href", runCaseHref(point.sourceRunId, data.agentId, point.version, row.questionId))
            .attr("tabindex", 0)
            .style("cursor", "pointer")
            .on("mouseenter focus", function () {
              d3.select(this).select("rect").attr("stroke", theme.accent).attr("stroke-width", 1.5);
            })
            .on("mouseleave blur", function () {
              d3.select(this).select("rect").attr("stroke", "none");
            });
        }
        cellG.append("rect")
          .attr("width", colW - cellPad * 2).attr("height", rowH - cellPad * 2)
          .attr("rx", 3)
          .attr("fill", fill)
          .attr("opacity", state.diffMode && !isBaseline && !changed ? 0.35 : 1);

        if (cell.passFraction == null) {
          cellG.append("text")
            .attr("x", (colW - cellPad * 2) / 2).attr("y", (rowH - cellPad * 2) / 2 + 4)
            .attr("text-anchor", "middle").attr("fill", theme.muted).attr("font-family", theme.fontMono).attr("font-size", 10)
            .text("–");
          return;
        }

        if (state.diffMode && !isBaseline && !changed) {
          cellG.append("text")
            .attr("x", (colW - cellPad * 2) / 2).attr("y", (rowH - cellPad * 2) / 2 + 4)
            .attr("text-anchor", "middle").attr("fill", theme.muted).attr("font-family", theme.fontMono).attr("font-size", 10)
            .text("=");
          return;
        }

        const primary = state.diffMode && !isBaseline
          ? `${delta < 0 ? "▼" : "▲"} ${cell.passed}/${cell.n}`
          : `${cell.passed}/${cell.n}`;
        const textColor = textColorFor(fill);
        const hasSecondaryLine = state.annotation !== "fraction";

        cellG.append("text")
          .attr("x", (colW - cellPad * 2) / 2).attr("y", (rowH - cellPad * 2) / 2 - (hasSecondaryLine ? 3 : -4))
          .attr("text-anchor", "middle").attr("fill", textColor).attr("font-family", theme.fontMono)
          .attr("font-size", 11).attr("font-weight", 600)
          .text(primary);

        if (state.annotation === "tokens" && cell.tokens != null) {
          cellG.append("text")
            .attr("x", (colW - cellPad * 2) / 2).attr("y", (rowH - cellPad * 2) / 2 + 10)
            .attr("text-anchor", "middle").attr("fill", textColor).attr("font-family", theme.fontMono)
            .attr("font-size", 8.5).attr("opacity", 0.85)
            .text(`${Math.round(cell.tokens).toLocaleString()} tok`);
        }
        if (state.annotation === "cost" && cell.cost != null) {
          cellG.append("text")
            .attr("x", (colW - cellPad * 2) / 2).attr("y", (rowH - cellPad * 2) / 2 + 10)
            .attr("text-anchor", "middle").attr("fill", textColor).attr("font-family", theme.fontMono)
            .attr("font-size", 8.5).attr("opacity", 0.85)
            .text(`$${cell.cost.toFixed(4)}`);
        }

        if (cell.errors > 0) {
          cellG.append("circle")
            .attr("cx", colW - cellPad * 2 - 6).attr("cy", 6).attr("r", 3)
            .attr("fill", theme.warn)
            .append("title").text(`${cell.errors} errored case(s), excluded from pass rate`);
        }
      });
    });
  }

  redraw();
}
