// Per-visualization PNG/SVG export — the generic mechanism every chart module's export button
// goes through (see components/ChartCard.jsx and components/VisualizationRenderer.jsx, the two
// callers). Every *chart* renders one root <svg> containing its own title/axis labels/legend, so
// exporting that node — verbatim for SVG, or rasterized for PNG — is enough to make the image
// self-contained out of context; exportElementAsPng below is the separate fallback for a
// table-shaped visualization, which has no <svg> to work with at all.
//
// The one non-trivial part of the SVG path: a downloaded file has no access to this app's
// stylesheet, so every element's *actually-applied* colors/fonts (most of which are set via
// `var(--x)` so charts stay theme-live on screen) have to be baked into inline style/attribute
// values on a clone before serializing. Walking getComputedStyle per node is the only reliable way
// to do that — there's no API that resolves custom-property-driven attr()/style() values into a
// portable stylesheet.
import { triggerDownload } from "../../reportExport.js";

const STYLE_PROPS = [
  "fill", "stroke", "stroke-width", "color", "font-family", "font-size", "font-weight",
  "opacity", "text-anchor", "dominant-baseline",
];

function inlineComputedStyles(liveRoot, cloneRoot) {
  const liveNodes = [liveRoot, ...liveRoot.querySelectorAll("*")];
  const cloneNodes = [cloneRoot, ...cloneRoot.querySelectorAll("*")];
  liveNodes.forEach((liveNode, i) => {
    const cloneNode = cloneNodes[i];
    if (!(cloneNode instanceof Element)) return;
    const cs = getComputedStyle(liveNode);
    const declarations = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";");
    cloneNode.setAttribute("style", declarations);
  });
}

function serializeSvg(svgEl, { background } = {}) {
  const clone = svgEl.cloneNode(true);
  inlineComputedStyles(svgEl, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (background) {
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("x", "0");
    rect.setAttribute("y", "0");
    rect.setAttribute("width", "100%");
    rect.setAttribute("height", "100%");
    rect.setAttribute("fill", background);
    clone.insertBefore(rect, clone.firstChild);
  }
  return new XMLSerializer().serializeToString(clone);
}

export function exportSvgAsSvg(svgEl, filename, opts) {
  const src = `<?xml version="1.0" standalone="no"?>\r\n${serializeSvg(svgEl, opts)}`;
  triggerDownload(new Blob([src], { type: "image/svg+xml;charset=utf-8" }), filename);
}

export async function exportSvgAsPng(svgEl, filename, { scale = 2, background } = {}) {
  const width = svgEl.viewBox?.baseVal?.width || svgEl.clientWidth || svgEl.getBBox().width;
  const height = svgEl.viewBox?.baseVal?.height || svgEl.clientHeight || svgEl.getBBox().height;
  const src = serializeSvg(svgEl, { background });

  const img = new Image();
  const url = URL.createObjectURL(new Blob([src], { type: "image/svg+xml;charset=utf-8" }));
  try {
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    triggerDownload(blob, filename);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// The fallback for a visualization that isn't fundamentally a plot — a table-shaped sandboxed
// visualization (config/reporting/visualizations/*.js, see components/VisualizationRenderer.jsx)
// renders a plain <table>, not an <svg>, so the two functions above (which only know how to
// rasterize/serialize an <svg> node) can't export it. html2canvas rasterizes arbitrary DOM
// instead, at the cost of needing a real (if brief) render pass rather than the instant
// canvas-drawImage trick exportSvgAsPng uses. No SVG-export equivalent exists for this case
// deliberately: an HTML table has no natural vector-graphics representation, so
// VisualizationRenderer only ever offers PNG for a table-shaped visualization, never SVG.
// Dynamically imports html2canvas (~200KB) so it never loads unless a table is actually exported
// — every chart-shaped visualization's export never touches this function or that import.
export async function exportElementAsPng(element, filename, { scale = 2, background } = {}) {
  const { default: html2canvas } = await import("html2canvas");
  const canvas = await html2canvas(element, { backgroundColor: background || null, scale, useCORS: true });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  triggerDownload(blob, filename);
}
