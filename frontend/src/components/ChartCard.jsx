import { useEffect, useRef } from "react";
import { exportSvgAsPng, exportSvgAsSvg } from "../charts/core/export.js";
import { readTheme } from "../charts/core/theme.js";

// The one host every Compare Versions chart mounts through — gives every chart module the same
// three things (a container, its data, resolved theme tokens) and the same PNG/SVG export
// buttons, so no chart module has to wire up its own. A chart module's contract is just
// `(container, data, theme) => void`; it owns its own d3 import and is expected to render exactly
// one root <svg> (that's what gets exported) and clear+redraw from scratch on every call — this
// component clears `container` before each call, so a module never has to guard against stale
// children from a previous render.
export function ChartCard({ title, subtitle, filename, data, render, deps }) {
  const containerRef = useRef(null);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    node.replaceChildren();
    render(node, data, readTheme(node));
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
        <div>
          <h4>{title}</h4>
          {subtitle && <p className="chart-card-subtitle">{subtitle}</p>}
        </div>
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
