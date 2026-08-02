// The generic categorical palette — no comparison/baseline vocabulary here, see
// charts/comparison/palette.js for that layer. Promoted out of
// config/reporting/visualizations/cost-vs-correctness.js so it has one home instead of being
// re-validated and copy-pasted per file. 8 slots, CVD floor band (worst adjacent dE 10.3), >=3:1
// contrast against this app's card surface. 8 is a hard ceiling per the dataviz skill (cycling
// hues past 8 is indistinguishable under CVD).
export const CATEGORICAL = ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926"];

// Assigns a color by POSITION in whatever list the caller passes (not a hash of an id) — right
// when series order is meaningful and stable for a page session (e.g. oldest-to-newest
// candidates). Callers wanting hash-stable identity across re-filtering should hash their own key
// into an index instead (see cost-vs-correctness.js's colorFor for that alternative — it can't
// import this module since sandboxed visualizations can't import at all, so it stays a parallel
// copy there by necessity, not an oversight).
export function colorForIndex(i) {
  return CATEGORICAL[i % CATEGORICAL.length];
}
