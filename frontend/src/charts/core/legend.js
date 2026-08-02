// The swatch-plus-label legend row shared by every multi-series chart — a square/circle marker
// (shape carries identity, not just color) followed by real-measured text, laid out left to right
// via getComputedTextLength() (falls back to a rough character estimate if a node isn't
// measurable yet). `items`: [{ shape: "square" | "circle", color, label }].
//
// `maxWidth` (optional): wraps onto additional rows instead of running items off the chart's
// right edge — needed once a series count isn't bounded by a small fixed list (e.g. one row per
// agent in a dataset that might span many agents). Row-break decisions use the same character-
// count estimate as the width-tracking fallback below, not live measurement, so a caller sizing
// its SVG height in advance (before anything is in the real DOM to measure) can predict the row
// count with estimateLegendRows() using an identical formula. Callers with a short, fixed-size
// legend (the common case) can leave this unset and get the original single-row behavior.
export function renderLegend(svg, items, theme, { x = 0, y = 0, fontSize = 11, gap = 20, widthMultiplier = 6.5, maxWidth = Infinity } = {}) {
  const legend = svg.append("g").attr("transform", `translate(${x},${y})`);
  const rowHeight = fontSize + 10;
  let lx = 0;
  let ly = 0;
  for (const { shape, color, label } of items) {
    const estWidth = 14 + label.length * widthMultiplier;
    if (lx > 0 && lx + estWidth > maxWidth) {
      lx = 0;
      ly += rowHeight;
    }
    const g = legend.append("g").attr("transform", `translate(${lx},${ly})`);
    if (shape === "square") {
      g.append("rect").attr("y", -8).attr("width", 8).attr("height", 8).attr("fill", color);
    } else {
      g.append("circle").attr("cx", 4).attr("cy", -4).attr("r", 4).attr("fill", color);
    }
    const t = g.append("text")
      .attr("x", 14).attr("y", -1)
      .attr("fill", theme.muted).attr("font-family", theme.fontMono).attr("font-size", fontSize)
      .text(label);
    lx += 14 + (t.node()?.getComputedTextLength?.() ?? label.length * widthMultiplier) + gap;
  }
  return legend;
}

// The same row-break estimate renderLegend() uses internally, exposed so a caller can size its
// SVG height before rendering anything (see the maxWidth doc above).
export function estimateLegendRows(items, maxWidth, { widthMultiplier = 6.5, gap = 20 } = {}) {
  if (maxWidth === Infinity) return 1;
  let lx = 0;
  let rows = 1;
  for (const { label } of items) {
    const estWidth = 14 + label.length * widthMultiplier;
    if (lx > 0 && lx + estWidth > maxWidth) {
      lx = 0;
      rows += 1;
    }
    lx += estWidth + gap;
  }
  return rows;
}
