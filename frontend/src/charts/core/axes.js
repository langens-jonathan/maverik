// Gridline + axis styling shared by every scaled chart — hairline recessive gridlines, axis
// domain/tick lines in `theme.border`, tick text in `theme.muted`/`theme.fontMono` (see
// docs/chart-design-system.md's mark spec). Class names on the gridline selections were dropped
// versus the original per-file copies — every chart module fully clears its container before
// redrawing (see components/ChartCard.jsx), so there's never a live re-render to target by class,
// and nothing else in the app queries these selectors.
export function drawHorizontalGridlines(svg, yScale, x1, x2, theme, opts = {}) {
  return svg.selectAll(null).data(yScale.ticks(opts.tickCount ?? 5)).join("line")
    .attr("x1", x1).attr("x2", x2)
    .attr("y1", (v) => yScale(v)).attr("y2", (v) => yScale(v))
    .attr("stroke", theme.borderFaint).attr("stroke-width", 1);
}

export function drawVerticalGridlines(svg, xScale, y1, y2, theme, opts = {}) {
  return svg.selectAll(null).data(xScale.ticks(opts.tickCount ?? 6)).join("line")
    .attr("y1", y1).attr("y2", y2)
    .attr("x1", (v) => xScale(v)).attr("x2", (v) => xScale(v))
    .attr("stroke", theme.borderFaint).attr("stroke-width", 1);
}

// Applied to a `d3.axisBottom(...)`/`d3.axisLeft(...)` call result.
export function styleAxis(axisSelection, theme, opts = {}) {
  axisSelection.select(".domain").attr("stroke", theme.border);
  axisSelection.selectAll(".tick line").attr("stroke", theme.border);
  axisSelection.selectAll("text")
    .attr("fill", theme.muted).attr("font-size", opts.fontSize ?? 11).attr("font-family", theme.fontMono);
  return axisSelection;
}
