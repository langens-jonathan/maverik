// MAVERIK-specific metric definitions + formatting/delta logic for the Compare Versions charts —
// domain data (AgentSummary/QuestionRunResult fields), not generic chart infrastructure, so this
// stays in the comparison layer rather than charts/core. Factored out once a second chart
// (paretoScatter.js) needed the exact same "format this AgentSummary field, compute a delta vs.
// baseline, color it by direction-of-goodness" logic deltaHeader.js already had.
import { deltaDirection } from "./palette.js";

export function overallCostPerQuestion(summary) {
  const a = summary.estCostPerQuestion;
  const b = summary.estToolCostPerQuestion;
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

// Per-case counterpart of overallCostPerQuestion, for whisker/spread computation — reads
// QuestionRunResult.EstCost/EstToolCost directly. Both exist as of the per-case cost
// instrumentation (see MaverikRunner.cs/MaverikSummary.cs); this was `perCase: null` on the
// costPerQuestion metric below until that landed, which silently left the delta header's cost
// panel as the one KPI card with no whisker even after the data existed to draw one.
export function overallCostPerCase(c) {
  if (c.estCost == null && c.estToolCost == null) return null;
  return (c.estCost ?? 0) + (c.estToolCost ?? 0);
}

export function fmtMs(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}
export function fmtTokens(t) {
  return Math.round(t).toLocaleString();
}
export function fmtCost(c) {
  return `$${c.toFixed(4)}`;
}
export function fmtPct(p) {
  return `${Math.round(p * 100)}%`;
}

export const METRICS = [
  {
    key: "passRate",
    label: "Pass rate",
    format: fmtPct,
    upIsGood: true,
    get: (s) => s.passRate,
    perCase: null, // a rate, not a per-case quantity — no whisker
  },
  {
    key: "costPerQuestion",
    label: "Cost / question",
    format: fmtCost,
    upIsGood: false,
    get: overallCostPerQuestion,
    perCase: overallCostPerCase,
  },
  {
    key: "avgDurationMs",
    label: "Avg duration",
    format: fmtMs,
    upIsGood: false,
    get: (s) => s.avgDurationMs,
    perCase: (c) => c.durationMs,
  },
  {
    key: "avgInputTokens",
    label: "Avg input tokens",
    format: fmtTokens,
    upIsGood: false,
    get: (s) => s.avgInputTokens,
    perCase: (c) => c.inputTokens,
  },
  {
    key: "avgToolCalls",
    label: "Avg tool calls",
    format: (v) => v.toFixed(1),
    upIsGood: null, // neither direction is inherently better — shown without judgment coloring
    get: (s) => s.avgToolCalls,
    perCase: (c) => c.toolCallCount,
  },
];

// { text, color, glyph, good } — good is null for a neutral (upIsGood: null) metric, so callers
// can tell "no verdict" apart from "verdict is exactly neutral/zero".
export function computeDelta(metric, baseValue, value, theme) {
  if (value == null || baseValue == null) return { text: null, color: theme.muted, glyph: "", good: null };
  const delta = value - baseValue;
  const pct = baseValue !== 0 ? (delta / Math.abs(baseValue)) * 100 : null;
  const text = pct == null ? metric.format(Math.abs(delta)) : `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
  if (metric.upIsGood == null) {
    return { text, color: theme.muted, glyph: delta > 0 ? "▲" : delta < 0 ? "▼" : "•", good: null };
  }
  const dir = deltaDirection(delta, metric.upIsGood, theme);
  return { text, color: dir.color, glyph: dir.glyph, good: dir.good };
}

export function spread(results, perCaseFn) {
  if (!perCaseFn) return null;
  const values = (results ?? []).filter((c) => c.error == null).map(perCaseFn).filter((v) => v != null);
  if (values.length === 0) return null;
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
}
