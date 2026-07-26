import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { api } from "../api.js";

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

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const container = containerRef.current;
    if (container) container.innerHTML = "";

    loadModule(id)
      .then((mod) => {
        if (cancelled) return;
        if (typeof mod.default !== "function")
          throw new Error(`'${id}' has no default export function.`);
        setLayout(mod.layout === "full" ? "full" : "half");
        mod.default(container, data, { d3, fullWidth, halfWidth });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [id, data, fullWidth, halfWidth]);

  return (
    <div className={`visualization layout-${layout}`}>
      {title && <p className="field-hint">{title}</p>}
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
