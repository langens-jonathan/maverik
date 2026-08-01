// Per-chart PNG/SVG export, shared by every chart module on the Compare Versions page (see
// ChartCard.jsx, the one place these are called from). Every chart here renders one root <svg>
// containing its own title/axis labels/legend, so exporting that node — verbatim for SVG, or
// rasterized for PNG — is enough to make the image self-contained out of context.
//
// The one non-trivial part: a downloaded file has no access to this app's stylesheet, so every
// element's *actually-applied* colors/fonts (most of which are set via `var(--x)` so charts stay
// theme-live on screen) have to be baked into inline style/attribute values on a clone before
// serializing. Walking getComputedStyle per node is the only reliable way to do that — there's no
// API that resolves custom-property-driven attr()/style() values into a portable stylesheet.
import { triggerDownload } from "../reportExport.js";

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
