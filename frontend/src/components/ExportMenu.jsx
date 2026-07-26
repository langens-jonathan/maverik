import { useEffect, useRef, useState } from "react";

// A single "Export" button that reveals a small dropdown with the actual format choices. Picking
// one closes the dropdown and fires the matching callback immediately — no confirmation step,
// since both exports are read-only and instant (or close to it) from the user's perspective.
export function ExportMenu({ onExportCsv, onExportPdf, busy }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  function pick(fn) {
    setOpen(false);
    fn();
  }

  return (
    <div className="export-menu" ref={rootRef}>
      <button className="secondary" onClick={() => setOpen((o) => !o)} disabled={busy}>
        {busy || "Export ▾"}
      </button>
      {open && (
        <div className="export-menu-dropdown">
          <button className="secondary" onClick={() => pick(onExportCsv)}>
            To CSV
          </button>
          <button className="secondary" onClick={() => pick(onExportPdf)}>
            To PDF
          </button>
        </div>
      )}
    </div>
  );
}
