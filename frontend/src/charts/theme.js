// Resolves the app's CSS custom properties (frontend/src/styles.css) to literal values off a
// live DOM node — real values are needed (not "var(--x)" strings) anywhere a chart module has to
// hand a color to something that can't resolve CSS vars itself: d3.interpolateRgb, canvas/PNG
// export, or an exported SVG that has to make sense opened outside this app (no stylesheet).
// Everything else in a chart should still just set `var(--x)` directly via .style()/.attr() so it
// stays live if the user switches themes without a re-render.
const TOKENS = [
  "bg", "surface", "surface-raised", "border", "border-faint",
  "text", "text-strong", "muted",
  "accent", "accent-strong", "accent-wash", "accent-2",
  "ok", "ok-wash", "bad", "bad-wash", "warn", "warn-wash", "info", "info-wash",
  "track", "font-mono", "font-sans", "font-display", "radius",
];

export function readTheme(node) {
  const cs = getComputedStyle(node);
  const theme = {};
  for (const token of TOKENS) {
    theme[toCamel(token)] = cs.getPropertyValue(`--${token}`).trim();
  }
  return theme;
}

function toCamel(token) {
  return token.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
