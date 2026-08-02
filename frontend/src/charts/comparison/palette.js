// The "baseline vs. candidates" color/shape conventions — kept separate from charts/core/palette.js
// because these assume a comparison framing (a baseline exists, deltas have a direction of
// goodness) a plain chart wouldn't. Re-exports the generic categorical assignment from core
// unchanged, so anything importing from here gets the full comparison vocabulary in one place.
export { CATEGORICAL, colorForIndex } from "../core/palette.js";

// The baseline is never just "another series" — it's the thing everything else is measured
// against, so it gets a fixed, neutral treatment (never a palette color) plus a distinct MARK
// SHAPE (square vs. candidates' circles) so identity survives grayscale printing or a CVD
// simulation, not just color. Pass `theme` from charts/core/theme.js's readTheme.
export function baselineColor(theme) {
  return theme.muted;
}

// Direction-of-goodness color for a delta, given whether "up is good" for this metric (e.g. pass
// rate) or "down is good" (cost, duration, tokens). Always pair with the returned `glyph` in the
// UI — never ship the color alone (see docs/chart-design-system.md's "never encode regression/
// improvement in color alone" rule).
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
