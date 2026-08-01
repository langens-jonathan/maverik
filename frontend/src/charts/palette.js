// The categorical palette for comparison charts, promoted out of
// config/reporting/visualizations/cost-vs-correctness.js so it has one home instead of being
// re-validated and copy-pasted per file (see the Phase 0 report's gap #4). Same 8 slots, same
// validation: CVD floor band (worst adjacent dE 10.3), >=3:1 contrast against this app's card
// surface. 8 is a hard ceiling per the dataviz skill (cycling hues past 8 is indistinguishable
// under CVD) — comparison pages here only ever chart one agent's versions at a time, so 8
// candidates is already a generous ceiling in practice.
export const CATEGORICAL = ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926"];

// Assigns candidate colors by POSITION (order within the selected candidate list), not a hash of
// the version number — unlike agent identity in cost-vs-correctness.js, a version's position in
// the candidate list is meaningful (usually oldest-to-newest) and stable for the duration of one
// page session, so a simple index is both simpler and gives a nicer "earlier candidate = earlier
// palette slot" reading.
export function colorForIndex(i) {
  return CATEGORICAL[i % CATEGORICAL.length];
}

// The baseline is never just "another series" — it's the thing everything else is measured
// against, so it gets a fixed, neutral treatment (never a palette color) plus a distinct MARK
// SHAPE (square vs. candidates' circles) so identity survives grayscale printing or a CVD
// simulation, not just color. Pass `theme.muted`/`theme.textStrong` from theme.js.
export function baselineColor(theme) {
  return theme.muted;
}

// Direction-of-goodness color for a delta, given whether "up is good" for this metric (e.g. pass
// rate) or "down is good" (cost, duration, tokens). Always pair with the returned `glyph` in the
// UI — never ship the color alone (see engineering constraints: never encode regression/
// improvement in color alone).
export function deltaDirection(delta, upIsGood, theme) {
  if (delta === 0 || !Number.isFinite(delta)) return { color: theme.muted, glyph: "•", good: null };
  const isIncrease = delta > 0;
  const good = isIncrease === upIsGood;
  return {
    color: good ? theme.ok : theme.bad,
    glyph: isIncrease ? "▲" : "▼",
    good,
  };
}
