// The width/height/viewBox + title/subtitle boilerplate every chart opened with, written once
// instead of five times. `height` stays a required caller-supplied value — it's chart-specific
// (a fixed plot height vs. one that grows with row/lane count), not something this helper can
// know. Returns `{ svg, width }` since several charts need the resolved width again for scale
// ranges (e.g. `width - margin.right`).
import * as d3 from "d3";

export function createChartSvg(container, { minWidth = 480, height, title, subtitle, subtitleY = 38 }, theme) {
  const width = Math.max(container.clientWidth || 0, minWidth);
  const svg = d3.select(container).append("svg")
    .attr("width", width).attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`);

  if (title) {
    svg.append("text")
      .attr("x", 0).attr("y", 20)
      .attr("fill", theme.textStrong).attr("font-family", theme.fontDisplay || theme.fontSans)
      .attr("font-size", 15).attr("font-weight", 600)
      .text(title);
  }
  if (subtitle) {
    svg.append("text")
      .attr("x", 0).attr("y", subtitleY)
      .attr("fill", theme.muted).attr("font-family", theme.fontMono).attr("font-size", 11)
      .text(subtitle);
  }

  return { svg, width };
}
