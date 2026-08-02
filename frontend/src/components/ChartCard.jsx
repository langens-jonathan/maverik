import { useEffect, useRef, useState } from "react";
import { exportSvgAsPng, exportSvgAsSvg } from "../charts/core/export.js";
import { readTheme } from "../charts/core/theme.js";

// The one host every Compare Versions chart mounts through — gives every chart module the same
// three things (a container, its data, resolved theme tokens) and the same PNG/SVG export
// buttons, so no chart module has to wire up its own. A chart module's contract is just
// `(container, data, theme) => void`; it owns its own d3 import and is expected to render exactly
// one root <svg> (that's what gets exported) and clear+redraw from scratch on every call — this
// component clears `container` before each call, so a module never has to guard against stale
// children from a previous render.
//
// The `<h4>{title}</h4>` here only shows before an <svg> exists (loading, or a `showEmptyState`
// message — both render as plain HTML, not an svg, so hasSvg stays false). Once a chart mounts,
// its own title+subtitle are already baked into the SVG itself (required for self-contained
// PNG/SVG export, see docs/chart-design-system.md's "Export requirements") — that text is usually
// more accurate than a static caption here (several charts' SVG subtitle is state-aware, e.g.
// "Baseline: v1 vs. 3 candidates"), so this component deliberately doesn't render its own subtitle
// at all — a second, different caption stacked above the chart's own was pure duplication.
export function ChartCard({ title, filename, data, render, deps }) {
  const containerRef = useRef(null);
  const [hasSvg, setHasSvg] = useState(false);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    node.replaceChildren();
    render(node, data, readTheme(node));
    setHasSvg(!!node.querySelector("svg"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps ?? [data]);

  function handleExport(kind) {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;
    const background = getComputedStyle(containerRef.current).getPropertyValue("--surface").trim() || "#fff";
    const name = `${filename}.${kind}`;
    if (kind === "svg") exportSvgAsSvg(svg, name, { background });
    else exportSvgAsPng(svg, name, { background });
  }

  return (
    <div className="chart-card">
      <div className="chart-card-header">
        <div>{!hasSvg && <h4>{title}</h4>}</div>
        <div className="chart-card-actions">
          <button className="secondary" onClick={() => handleExport("png")}>
            PNG
          </button>
          <button className="secondary" onClick={() => handleExport("svg")}>
            SVG
          </button>
        </div>
      </div>
      <div className="chart-card-body" ref={containerRef} />
    </div>
  );
}
