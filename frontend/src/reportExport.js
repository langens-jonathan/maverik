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

// Renders `element` to a raster image via html2canvas and slices it across A4 pages via jsPDF,
// returning the jsPDF document unsaved — callers pick their own filename via `.save(...)`.
// Dynamically imports both libraries (~350KB together) so they never load unless someone actually
// exports. Shared by the report "Open" screen (below) and Compare Versions
// (`charts/comparison/export.js`) — the html2canvas/jsPDF slicing has two real gotchas (JPEG not
// PNG, a stable `alias` for reuse across pages) worth having exactly once rather than re-derived
// per page that wants a PDF export.
export async function renderElementToPdf(element) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);

  const backgroundColor = getComputedStyle(document.body).backgroundColor || "#ffffff";
  const canvas = await html2canvas(element, { backgroundColor, scale: 2, useCORS: true });

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  // JPEG, not PNG: this is a screenshot of a dashboard, not vector art, and PNG's lossless
  // encoding of a tall, gradient/anti-aliasing-heavy canvas balloons into tens of MB. The `alias`
  // argument matters just as much — every addImage call below embeds the *same* full-page image
  // (only the y-offset changes per page); passing a stable alias tells jsPDF to embed it once and
  // reuse it, instead of re-embedding the whole image per page.
  const imgData = canvas.toDataURL("image/jpeg", 0.92);
  const alias = "export-page-image";

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

  return pdf;
}

// Renders `element` (the report's title + every dashboard card, not the app chrome around it) to
// a PDF and saves it under the report's own id.
export async function exportReportPdf(report, element) {
  const pdf = await renderElementToPdf(element);
  pdf.save(`${report.id}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
