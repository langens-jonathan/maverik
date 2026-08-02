// Client-side export for CompareVersionsPage.jsx — no backend endpoint, everything needed (the
// current baseline/candidate selection, the already-rendered chart DOM) is already in the
// browser. Named pageExport.js (not export.js) to stay distinct from core/export.js, which is a
// different thing (per-chart SVG/PNG export via ChartCard's own buttons, not this page-level CSV/
// PDF pair).
import { triggerDownload, renderElementToPdf } from "../../reportExport.js";

function csvEscape(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// error rate / iteration-limit-hit rate / iteration-budget utilization aren't AgentSummary
// fields — same per-case computation reliabilityDelta.js and iterationBudget.js each already do,
// duplicated here as one-liners rather than exporting chart-internal helpers for a single CSV
// column apiece.
function errorRate(point) {
  const results = point.results ?? [];
  return results.length === 0 ? null : results.filter((c) => c.error != null).length / results.length;
}
function iterationLimitRate(point) {
  const evaluated = (point.results ?? []).filter((c) => c.error == null);
  return evaluated.length === 0 ? null : evaluated.filter((c) => c.hitIterationLimit).length / evaluated.length;
}
function iterationBudgetUtilization(point) {
  const maxIterations = point.agentSnapshot?.maxIterations;
  const evaluated = (point.results ?? []).filter((c) => c.error == null);
  if (!maxIterations || evaluated.length === 0) return null;
  const values = evaluated.map((c) => Math.min(1, c.iterations / maxIterations));
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// One row per selected point (baseline + every candidate currently shown on the page) — the same
// data every chart on this page is built from, as a real file instead of a screenshot.
export function exportCompareCsv(suiteId, agentId, chartData) {
  const columns = [
    ["suiteId", () => suiteId],
    ["agentId", () => agentId],
    ["version", (p) => (p.version == null ? "current" : p.version)],
    ["isBaseline", (p) => (p.isBaseline ? "true" : "false")],
    ["timestamp", (p) => p.timestamp],
    ["sourceRunId", (p) => p.sourceRunId],
    ["passRate", (p) => p.summary.passRate],
    ["avgDurationMs", (p) => p.summary.avgDurationMs],
    ["avgInputTokens", (p) => p.summary.avgInputTokens],
    ["avgOutputTokens", (p) => p.summary.avgOutputTokens],
    ["avgToolCalls", (p) => p.summary.avgToolCalls],
    ["avgPeakContextTokens", (p) => p.summary.avgPeakContextTokens],
    ["tokenCost", (p) => p.summary.estCostTotal],
    ["toolCost", (p) => p.summary.estToolCostTotal],
    ["overallCost", (p) => p.summary.estOverallCostTotal],
    ["errorRate", errorRate],
    ["iterationLimitHitRate", iterationLimitRate],
    ["avgIterationBudgetUtilization", iterationBudgetUtilization],
  ];

  const points = [
    { ...chartData.baseline, isBaseline: true },
    ...chartData.candidates.map((c) => ({ ...c, isBaseline: false })),
  ];

  const lines = [
    columns.map(([name]) => csvEscape(name)).join(","),
    ...points.map((p) => columns.map(([, get]) => csvEscape(get(p))).join(",")),
  ];

  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, `compare-${agentId}-${new Date().toISOString().slice(0, 10)}.csv`);
}

// Renders `element` (the version picker + every chart on the page, not the export button row
// itself) to a PDF via the shared html2canvas/jsPDF pipeline reportExport.js already established.
export async function exportComparePdf(agentId, element) {
  const pdf = await renderElementToPdf(element);
  pdf.save(`compare-${agentId}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
