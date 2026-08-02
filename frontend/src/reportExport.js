// Client-side export for the report "Open" screen — no backend endpoint, since everything needed
// (the matching SuiteRunRecords, the already-rendered dashboard DOM) is already in the browser.

export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Minimal CSV quoting, matching MaverikResultsWriter.Escape on the backend: wrap when the value
// contains a delimiter/quote/newline, doubling embedded quotes.
function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per matching SuiteRunRecord, all 9 outcome parameters plus the identifying fields —
// the same data metrics-by-run.js renders, as a real file instead of a page you'd have to
// screenshot or retype.
export function exportReportCsv(report, runs) {
  const columns = [
    ["suiteId", (r) => r.suiteId],
    ["agentId", (r) => r.agentId],
    ["timestamp", (r) => r.timestamp],
    ["sourceRunId", (r) => r.sourceRunId],
    ["passRate", (r) => r.summary.passRate],
    ["avgDurationMs", (r) => r.summary.avgDurationMs],
    ["avgInputTokens", (r) => r.summary.avgInputTokens],
    ["avgOutputTokens", (r) => r.summary.avgOutputTokens],
    ["avgToolCalls", (r) => r.summary.avgToolCalls],
    ["avgPeakContextTokens", (r) => r.summary.avgPeakContextTokens],
    ["tokenCost", (r) => r.summary.estCostTotal],
    ["toolCost", (r) => r.summary.estToolCostTotal],
    ["overallCost", (r) => r.summary.estOverallCostTotal],
  ];

  const lines = [
    columns.map(([name]) => csvEscape(name)).join(","),
    ...runs.map((r) => columns.map(([, get]) => csvEscape(get(r))).join(",")),
  ];

  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, `${report.id}-${new Date().toISOString().slice(0, 10)}.csv`);
}

// Would `node`, rasterized at full page width with its own aspect ratio preserved, fit within one
// page's height? Used by collectPaginationUnits to decide whether a block is safe to keep whole.
function fitsOnOnePage(node, pageWidthMm, pageHeightMm) {
  if (!node.offsetWidth || !node.offsetHeight) return true; // nothing to measure/split — leave it
  const estimatedHeightMm = pageWidthMm * (node.offsetHeight / node.offsetWidth);
  return estimatedHeightMm <= pageHeightMm;
}

// Splits `root`'s content into "pagination units" — DOM nodes that get rasterized and placed as
// one atomic image each, so a page break can fall between two charts but never through the middle
// of one. Starts from root's direct children (already the right granularity for most content —
// a heading, a card, a single chart) and only expands a unit into its own children when it
// wouldn't fit on one page alone (e.g. a dashboard section with many stacked visualizations, or a
// `.viz-row` too tall to keep as one image) — bottoms out naturally once every remaining unit
// either fits, or has nothing left to split into (a single oversized chart/table, left for
// renderElementToPdf's own per-unit fallback slicing below).
function collectPaginationUnits(root, pageWidthMm, pageHeightMm) {
  let units = [...root.children];
  for (let pass = 0; pass < 4; pass++) {
    let expandedAny = false;
    units = units.flatMap((node) => {
      if (!fitsOnOnePage(node, pageWidthMm, pageHeightMm) && node.children.length > 1) {
        expandedAny = true;
        return [...node.children];
      }
      return [node];
    });
    if (!expandedAny) break;
  }
  return units.filter((u) => u.offsetWidth > 0 && u.offsetHeight > 0);
}

// Must match [data-pdf-export]'s overrides in styles.css exactly — this is the other half of that
// fix. That CSS attribute only repaints "chrome" set via a live var(--x) reference (a chart-card's
// own background/border, from its CSS class); most chart-*internal* chrome — panel fills,
// gridlines, axis/title/legend text — bakes a literal resolved color into an SVG fill/stroke
// attribute at render time instead (see charts/core/theme.js's readTheme), specifically so it
// still makes sense in a chart's own standalone PNG/SVG export, which has no stylesheet to resolve
// var(--x) against. That same baking means toggling the CSS attribute alone never reaches it — a
// chart's panel fills and axis text would stay whatever the live dark theme's colors are,
// including near-invisible light-on-dark text once the surrounding card goes white. See
// applyPrintSubstitution below for the other half of the fix.
const PRINT_CHROME = {
  bg: "#ffffff",
  surface: "#ffffff",
  "surface-raised": "#f4f4f5",
  border: "#d4d4d8",
  "border-faint": "#e4e4e7",
  text: "#27272a",
  "text-strong": "#09090b",
  muted: "#71717a",
  track: "#e4e4e7",
};

// Reads the *currently active* (dark) theme's chrome values and pairs each with its print
// replacement — must run before [data-pdf-export] is set, since that's what changes these very
// values on <html>.
function buildChromeSubstitutions() {
  const cs = getComputedStyle(document.documentElement);
  const map = new Map();
  for (const [token, printValue] of Object.entries(PRINT_CHROME)) {
    const liveValue = cs.getPropertyValue(`--${token}`).trim();
    if (liveValue && liveValue !== printValue) map.set(liveValue, printValue);
  }
  return map;
}

// Rewrites every fill/stroke attribute under `root` whose value exactly matches a baked dark
// chrome color (see PRINT_CHROME above) to its print equivalent. Scoped to fill/stroke
// *attributes* only (not inline `style` color properties, which the CSSOM can silently reformat
// to rgb() on read-back, breaking an exact string match) — every chrome color baked via a `.style`
// call in this toolkit lives inside a hover-only tooltip or a control button, neither of which is
// ever visible in a static capture, so there's nothing worth chasing there. Returns an undo list
// (`[element, attribute, originalValue]` triples) so the caller can restore the live DOM exactly
// afterward — same "brief live mutation, always restored in finally" pattern as
// [data-pdf-export] itself.
function applyPrintSubstitution(root, substitutions) {
  const restore = [];
  if (substitutions.size === 0) return restore;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let el = walker.currentNode;
  while (el) {
    for (const attr of ["fill", "stroke"]) {
      const value = el.getAttribute?.(attr);
      if (value && substitutions.has(value)) {
        restore.push([el, attr, value]);
        el.setAttribute(attr, substitutions.get(value));
      }
    }
    el = walker.nextNode();
  }
  return restore;
}

function undoPrintSubstitution(restore) {
  for (const [el, attr, original] of restore) el.setAttribute(attr, original);
}

// Renders `element`'s content to A4 pages via html2canvas + jsPDF, returning the jsPDF document
// unsaved — callers pick their own filename via `.save(...)`. Dynamically imports both libraries
// (~350KB together) so they never load unless someone actually exports. Shared by the report
// "Open" screen (below) and Compare Versions (`charts/comparison/pageExport.js`).
//
// Paginates per pagination unit (see collectPaginationUnits) rather than rasterizing the whole
// document as one canvas and slicing it into fixed-height chunks — the earlier version of this
// function did that, and a chart or table sitting across a chunk boundary got visibly cut in half.
// Each unit is placed at full page width (its own aspect ratio preserved), stacked top-to-bottom;
// a unit starts a fresh page instead of splitting if it wouldn't fully fit in what's left of the
// current one. A single unit that's still taller than a full page on its own (nothing left to
// break it on) falls back to the old fixed-height slicing, scoped to just that one image.
export async function renderElementToPdf(element) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();

  const units = collectPaginationUnits(element, pageWidth, pageHeight);

  // Print-friendly chrome (light background/surface/border/text, see styles.css) for the
  // duration of the capture only — every html2canvas call below rasterizes whatever the *live*
  // computed styles resolve to, so this has to be a real (if brief) DOM mutation, not something
  // that can be scoped to an offscreen clone without cloning + recapturing every unit's subtree.
  // The page will visibly flash into print styling while this runs; acceptable since ExportMenu
  // already shows a "Generating PDF…" busy state for the same duration. Order matters: the
  // substitution map has to be built from the *live* (dark) theme values before the CSS attribute
  // below changes them.
  const substitutions = buildChromeSubstitutions();
  const restoreFillsStrokes = applyPrintSubstitution(element, substitutions);
  document.documentElement.setAttribute("data-pdf-export", "");
  try {
    const backgroundColor = getComputedStyle(document.body).backgroundColor || "#ffffff";
    let cursor = 0; // mm already used on the current page

    for (let i = 0; i < units.length; i++) {
      const canvas = await html2canvas(units[i], { backgroundColor, scale: 2, useCORS: true });
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      // JPEG, not PNG: these are screenshots of dashboard content, not vector art, and PNG's
      // lossless encoding of tall, gradient/anti-aliasing-heavy canvases balloons into tens of MB.
      const imgData = canvas.toDataURL("image/jpeg", 0.92);
      const alias = `pdf-unit-${i}`; // a distinct image per unit — never reused across units

      if (imgHeight > pageHeight) {
        // No boundary left to break this one unit on — fall back to the original fixed-height
        // slicing (a stable alias here IS correct: every addImage call below re-embeds this same
        // oversized image at a different y-offset, not a different image).
        if (cursor > 0) {
          pdf.addPage();
          cursor = 0;
        }
        let heightLeft = imgHeight;
        let position = 0;
        pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight, alias);
        heightLeft -= pageHeight;
        while (heightLeft > 0) {
          position -= pageHeight;
          pdf.addPage();
          pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight, alias);
          heightLeft -= pageHeight;
        }
        // How much of the *last* page this unit's tail end used, so the next unit can keep
        // packing onto it instead of always starting fresh — heightLeft is <= 0 here by the
        // loop's exit condition, so this is the (non-negative) leftover height already consumed.
        cursor = pageHeight + heightLeft;
        continue;
      }

      if (cursor > 0 && cursor + imgHeight > pageHeight) {
        pdf.addPage();
        cursor = 0;
      }
      pdf.addImage(imgData, "JPEG", 0, cursor, imgWidth, imgHeight, alias);
      cursor += imgHeight;
    }

    return pdf;
  } finally {
    document.documentElement.removeAttribute("data-pdf-export");
    undoPrintSubstitution(restoreFillsStrokes);
  }
}

// Renders `element` (the report's title + every dashboard card, not the app chrome around it) to
// a PDF and saves it under the report's own id.
export async function exportReportPdf(report, element) {
  const pdf = await renderElementToPdf(element);
  pdf.save(`${report.id}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
