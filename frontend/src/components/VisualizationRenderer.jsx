import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { api } from "../api.js";
import { exportSvgAsPng, exportSvgAsSvg } from "../charts/core/export.js";
import { readTheme } from "../charts/core/theme.js";
import { createChartSvg } from "../charts/core/svgFrame.js";
import { createTooltip } from "../charts/core/tooltip.js";
import { renderLegend, estimateLegendRows } from "../charts/core/legend.js";
import { drawHorizontalGridlines, drawVerticalGridlines, styleAxis } from "../charts/core/axes.js";
import { placeLabels } from "../charts/core/labelCollision.js";
import { beeswarm } from "../charts/core/beeswarm.js";
import { showEmptyState } from "../charts/core/emptyState.js";
import { CATEGORICAL, colorForIndex } from "../charts/core/palette.js";
import { barPath } from "../charts/core/barPath.js";

// The pure, MAVERIK-agnostic half of the chart toolkit (see docs/chart-design-system.md),
// injected into every sandboxed visualization alongside `d3` — this is what makes "the shared
// toolkit is the only permitted way to render charts" possible for files that can never `import`
// (config/reporting/README.md's container-only rule; see that file for why). Deliberately just
// `charts/core/*`, not `charts/comparison/*` — baseline/candidate vocabulary doesn't apply to a
// generic dashboard visualization. Existing files aren't required to switch to this immediately;
// it exists so new/modified visualizations have it instead of re-deriving the same gridline/
// tooltip/legend chrome inline.
const chartKit = {
  createChartSvg, createTooltip, renderLegend, estimateLegendRows, drawHorizontalGridlines, drawVerticalGridlines,
  styleAxis, placeLabels, beeswarm, showEmptyState, readTheme, CATEGORICAL, colorForIndex, barPath,
};

// Executes a visualization's default-exported function (see config/reporting/README.md for the
// (container, data, { d3 }) contract) by fetching its raw source and dynamically importing it
// from a Blob URL — no bundler involvement, so arbitrary files dropped into config/ work as-is.
// Cached per id so switching which run(s) are selected doesn't refetch/reimport; a page reload is
// what picks up an on-disk edit, since there's no in-app editor for these files.
const moduleCache = new Map();

function loadModule(id) {
  if (!moduleCache.has(id)) {
    moduleCache.set(
      id,
      (async () => {
        const code = await api.getVisualization(id);
        const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
        try {
          return await import(/* @vite-ignore */ url);
        } finally {
          URL.revokeObjectURL(url);
        }
      })()
    );
  }
  return moduleCache.get(id);
}

// fullWidth/halfWidth: pixel budgets for a "full row" vs. "half row" slot in whatever layout is
// hosting this visualization (see config/reporting/README.md) — forwarded into the module's
// default export so charts can size themselves. A module may export `layout = "full"` to claim
// the whole row (tables do, since HTML tables already fill their container); anything else
// defaults to "half". The layout is only known once the module has loaded, so it starts at the
// default and flips after mount — harmless for the common case (most visualizations are "half").
export function VisualizationRenderer({ id, data, title, fullWidth = 720, halfWidth = 560 }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);
  const [layout, setLayout] = useState("half");
  const [hasSvg, setHasSvg] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setHasSvg(false);
    const container = containerRef.current;
    if (container) container.innerHTML = "";

    loadModule(id)
      .then((mod) => {
        if (cancelled) return;
        if (typeof mod.default !== "function")
          throw new Error(`'${id}' has no default export function.`);
        setLayout(mod.layout === "full" ? "full" : "half");
        mod.default(container, data, { d3, fullWidth, halfWidth, chartKit });
        // Table-shaped visualizations render no root <svg> — export only makes sense for the
        // chart-shaped ones, same distinction ChartCard never has to make (every bespoke chart is
        // guaranteed to render exactly one <svg>, but a sandboxed file might build a <table>).
        if (!cancelled) setHasSvg(!!container?.querySelector("svg"));
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [id, data, fullWidth, halfWidth]);

  function handleExport(kind) {
    const svg = containerRef.current?.querySelector("svg");
    if (!svg) return;
    const background = getComputedStyle(containerRef.current).getPropertyValue("--surface").trim() || "#fff";
    const name = `${id}.${kind}`;
    if (kind === "svg") exportSvgAsSvg(svg, name, { background });
    else exportSvgAsPng(svg, name, { background });
  }

  return (
    <div className={`visualization layout-${layout}`}>
      {(title || hasSvg) && (
        <div className="visualization-header">
          {title && <p className="field-hint">{title}</p>}
          {hasSvg && (
            <div className="chart-card-actions">
              <button className="secondary" onClick={() => handleExport("png")}>
                PNG
              </button>
              <button className="secondary" onClick={() => handleExport("svg")}>
                SVG
              </button>
            </div>
          )}
        </div>
      )}
      {error && (
        <div className="notice bad">
          <span>
            Error rendering &lsquo;{id}&rsquo;: {error}
          </span>
        </div>
      )}
      <div ref={containerRef} className="visualization-container" />
    </div>
  );
}
