// One labeled horizontal bar — the only "chart" primitive in the app. `value`/`max` drive the
// fill width; `display` is the text shown at the end of the bar (already formatted by the
// caller, since "what does this number mean" varies per metric — ms, tokens, $, %).
export function BarRow({ label, value, max, display, color = "#1a56db" }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="bar-row">
      <div className="bar-row-label">{label}</div>
      <div className="bar-row-track">
        <div className="bar-row-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="bar-row-value">{display}</div>
    </div>
  );
}
