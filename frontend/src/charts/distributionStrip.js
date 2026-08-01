// Chart 4 of the Compare Versions page: one beeswarm strip per version, every repetition as its
// own dot, mean marked separately from the dots themselves. The whole point is that this degrades
// honestly at small n — two repetitions renders as two real dots, not a fabricated distribution —
// and that a metric which happens to be bit-identical across every repetition (token counts,
// almost always) gets called out as "deterministic" rather than plotted as if it had spread.
//
// One module, parameterized by metric (duration / input tokens / output tokens / cost are all the
// same shape of chart) via makeDistributionStrip(metricKey) — a factory returning a bound
// render(container, data, theme), so `data` stays the same { baseline, candidates } shape every
// other Compare Versions chart uses.
//
// Built on the shared chart toolkit — see docs/chart-design-system.md. Keeps its dots directly
// interactive at their visible 4.5px radius rather than adding paretoScatter.js's oversized hit
// target — noted as a deliberate deferral (this refactor's acceptance test is zero visual/
// behavioral regression), not an oversight.
import * as d3 from "d3";
import { baselineColor } from "./comparison/palette.js";
import { createChartSvg } from "./core/svgFrame.js";
import { drawVerticalGridlines, styleAxis } from "./core/axes.js";
import { beeswarm } from "./core/beeswarm.js";
import { createTooltip } from "./core/tooltip.js";
import { showEmptyState } from "./core/emptyState.js";

const METRIC_DEFS = {
  durationMs: {
    label: "Duration",
    format: (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`),
    get: (c) => c.durationMs,
  },
  inputTokens: {
    label: "Input tokens",
    format: (v) => Math.round(v).toLocaleString(),
    get: (c) => c.inputTokens,
  },
  outputTokens: {
    label: "Output tokens",
    format: (v) => Math.round(v).toLocaleString(),
    get: (c) => c.outputTokens,
  },
  cost: {
    label: "Cost",
    format: (v) => `$${v.toFixed(4)}`,
    get: (c) => (c.estCost == null && c.estToolCost == null ? null : (c.estCost ?? 0) + (c.estToolCost ?? 0)),
  },
};

export function makeDistributionStrip(metricKey) {
  const def = METRIC_DEFS[metricKey];
  const TITLE = `${def.label} — per-repetition spread`;

  function render(container, data, theme) {
    const { baseline, candidates } = data;
    if (!baseline) {
      showEmptyState(container, "Pick a baseline version above to see its spread.");
      return;
    }
    const points = [{ ...baseline, isBaseline: true }, ...candidates.map((c) => ({ ...c, isBaseline: false }))];

    const perPoint = points.map((p) => ({
      ...p,
      values: (p.results ?? []).filter((c) => c.error == null).map(def.get).filter((v) => v != null),
    }));

    const allValues = perPoint.flatMap((p) => p.values);
    if (allValues.length === 0) {
      showEmptyState(container, `No ${def.label.toLowerCase()} data for the selected versions.`);
      return;
    }

    const labelColW = 130;
    const laneH = 40;
    const headerH = 56;
    const margin = { right: 20 };
    const height = headerH + points.length * laneH + 24;
    const subtitle = "Every repetition as its own point — a tight cluster is consistency, a wide one is noise";

    const { svg, width } = createChartSvg(container, { minWidth: 480, height, title: TITLE, subtitle }, theme);

    const [vMin, vMax] = d3.extent(allValues);
    const pad = (vMax - vMin) * 0.08 || Math.max(1, vMax * 0.1);
    const x = d3.scaleLinear()
      .domain([Math.max(0, vMin - pad), vMax + pad])
      .range([labelColW, width - margin.right])
      .nice();

    drawVerticalGridlines(svg, x, headerH, height - 16, theme, { tickCount: 6 });
    styleAxis(
      svg.append("g").attr("transform", `translate(0,${height - 16})`)
        .call(d3.axisBottom(x).ticks(6).tickFormat(def.format).tickSizeOuter(0)),
      theme,
      { fontSize: 10 }
    );

    const tooltip = createTooltip(container, theme, { padding: "0.4rem 0.6rem", fontSize: "0.75rem", fontFamily: theme.fontMono });

    perPoint.forEach((p, pi) => {
      const laneY = headerH + pi * laneH;
      const laneCenter = laneY + laneH / 2;
      const color = p.isBaseline ? baselineColor(theme) : p.color;

      const labelG = svg.append("g");
      if (p.isBaseline) {
        labelG.append("rect").attr("x", 0).attr("y", laneCenter - 4).attr("width", 8).attr("height", 8).attr("fill", color);
      } else {
        labelG.append("circle").attr("cx", 4).attr("cy", laneCenter).attr("r", 4).attr("fill", color);
      }
      labelG.append("text")
        .attr("x", 14).attr("y", laneCenter + 4)
        .attr("fill", theme.text).attr("font-family", theme.fontMono).attr("font-size", 11)
        .text(p.label);

      if (p.values.length === 0) {
        svg.append("text")
          .attr("x", labelColW + 8).attr("y", laneCenter + 4)
          .attr("fill", theme.muted).attr("font-family", theme.fontMono).attr("font-size", 10)
          .text("no data");
        return;
      }

      const uniqueValues = new Set(p.values);
      const deterministic = p.values.length > 1 && uniqueValues.size === 1;
      const mean = p.values.reduce((a, b) => a + b, 0) / p.values.length;

      // Mean marker — a vertical tick spanning most of the lane, drawn behind the dots so it
      // reads as a reference line, not another data point.
      svg.append("line")
        .attr("x1", x(mean)).attr("x2", x(mean))
        .attr("y1", laneY + 5).attr("y2", laneY + laneH - 5)
        .attr("stroke", color).attr("stroke-width", 2).attr("opacity", 0.4);

      const nodes = beeswarm(p.values, x, laneCenter, 4.5);
      const dotG = svg.selectAll(null).data(nodes).enter().append("circle")
        .attr("cx", (d) => d.x).attr("cy", (d) => d.y).attr("r", 4.5)
        .attr("fill", color).attr("stroke", theme.surface).attr("stroke-width", 1.5)
        .style("cursor", "pointer");

      dotG
        .on("mouseenter", function (event, d) {
          d3.select(this).attr("r", 6.5);
          tooltip.clear();
          tooltip.node.text(`${p.label}: ${def.format(d.value)}`);
          const [mx, my] = d3.pointer(event, container);
          tooltip.showAt(mx + 12, my - 10);
        })
        .on("mousemove", function (event) {
          const [mx, my] = d3.pointer(event, container);
          tooltip.moveTo(mx + 12, my - 10);
        })
        .on("mouseleave", function () {
          d3.select(this).attr("r", 4.5);
          tooltip.hide();
        });

      svg.append("text")
        .attr("x", width - margin.right).attr("y", laneY + 12)
        .attr("text-anchor", "end")
        .attr("fill", theme.muted).attr("font-family", theme.fontMono).attr("font-size", 9.5)
        .text(`n=${p.values.length} · mean ${def.format(mean)}`);

      if (deterministic) {
        svg.append("text")
          .attr("x", width - margin.right).attr("y", laneY + 24)
          .attr("text-anchor", "end")
          .attr("fill", theme.info).attr("font-family", theme.fontMono).attr("font-size", 9.5).attr("font-style", "italic")
          .text("deterministic — identical every repetition");
      }
    });
  }

  render.TITLE = TITLE;
  return render;
}
