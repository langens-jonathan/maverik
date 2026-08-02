// Empty/no-data state for a chart's container. Every chart previously did `container.textContent
// = message` directly — plain text with no visual treatment. This applies styles.css's
// `.empty-chart-state` rule (centered, muted, a sane min-height), which existed unused before
// this toolkit extraction gave it a real caller. The one deliberate visual change in this
// refactor (see docs/chart-design-system.md) — every other path is byte-for-byte the same output
// as before.
export function showEmptyState(container, message) {
  container.textContent = "";
  const el = document.createElement("div");
  el.className = "empty-chart-state";
  el.textContent = message;
  container.appendChild(el);
}
