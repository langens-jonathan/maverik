// Top-rounded, square-at-baseline bar path (mark spec: 4px rounded data-ends anchored to the
// baseline) — a plain `rect` with `rx` rounds all four corners, which isn't the spec, so this
// builds the SVG path by hand. Extracted from avg-duration-by-agent.js's original inline version,
// which had been copy-pasted once already into the agent-average-<metric>.js bar-chart template —
// promoted here so a third copy (and beyond) reuses one function instead.
export function barPath(bx, by, bw, baselineY, radius) {
  const r = Math.min(radius, bw / 2, Math.max(0, baselineY - by));
  return `M${bx},${baselineY} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + bw - r} Q${bx + bw},${by} ${bx + bw},${by + r} V${baselineY} Z`;
}
