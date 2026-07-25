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

export function VisualizationRenderer({ id, data }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);

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
        mod.default(container, data, { d3 });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [id, data]);

  return (
    <div className="visualization">
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
