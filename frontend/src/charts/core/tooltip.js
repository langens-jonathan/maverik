// The floating-div tooltip chrome shared by every hover-driven chart — position, surface, border,
// shadow, and font tokens were near-identical across three hand-rolled copies before this. Chrome
// only: each chart still builds its own content (a single line vs. a structured multi-row metric
// card vary a lot), via `tooltip.node` directly.
import * as d3 from "d3";

export function createTooltip(container, theme, opts = {}) {
  const tooltip = d3.select(container).append("div")
    .style("position", "absolute").style("pointer-events", "none").style("opacity", 0)
    .style("background", theme.surfaceRaised).style("border", `1px solid ${theme.border}`)
    .style("border-radius", theme.radius || "5px").style("box-shadow", "0 6px 18px rgba(0,0,0,0.25)")
    .style("padding", opts.padding ?? "0.5rem 0.65rem")
    .style("font-size", opts.fontSize ?? "0.78rem")
    .style("font-family", opts.fontFamily ?? theme.fontSans)
    .style("color", theme.text)
    .style("z-index", 10)
    .style("transition", "opacity 0.1s");
  if (opts.minWidth) tooltip.style("min-width", opts.minWidth);

  return {
    node: tooltip,
    clear() {
      tooltip.selectAll("*").remove();
    },
    showAt(x, y) {
      tooltip.style("left", `${x}px`).style("top", `${y}px`).style("opacity", 1);
    },
    moveTo(x, y) {
      tooltip.style("left", `${x}px`).style("top", `${y}px`);
    },
    hide() {
      tooltip.style("opacity", 0);
    },
  };
}
