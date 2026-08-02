# Chart design system

The shared toolkit behind MAVERIK's Compare Versions dashboard
(`frontend/src/pages/CompareVersionsPage.jsx`), extracted so its design decisions propagate by
reuse instead of copy-paste. **Any new or modified chart in this app must use this toolkit and
follow this document** — see the note in the repo's `CLAUDE.md`.

This governs `frontend/src/charts/` and the React host that mounts it
(`frontend/src/components/ChartCard.jsx`). It does **not** govern
`config/reporting/visualizations/*.js` — those are a deliberately separate, sandboxed system (no
imports allowed, container-only DOM access, data passed in as a flat array) built for a different
purpose: analyst-authored, drop-in charts for the generic Dashboards/Reports feature. This toolkit
is for first-party, purpose-built pages with real interactive state, like Compare Versions.

## Module layout

```
frontend/src/charts/
  core/              generic — zero MAVERIK or comparison-dashboard knowledge
    theme.js           readTheme(node) — resolve CSS custom properties to literal values
    palette.js          CATEGORICAL, colorForIndex — the validated categorical palette
    export.js            exportSvgAsSvg, exportSvgAsPng — self-contained PNG/SVG export
    svgFrame.js            createChartSvg — width/height/viewBox + title/subtitle boilerplate
    tooltip.js              createTooltip — floating-div tooltip chrome
    legend.js                renderLegend — swatch + label legend row
    axes.js                   drawHorizontalGridlines, drawVerticalGridlines, styleAxis
    labelCollision.js          placeLabels — greedy direct-label placement for scatter charts
    beeswarm.js                  beeswarm — one-shot d3-force beeswarm layout
    emptyState.js                 showEmptyState — styled "no data" container content
    barPath.js                     barPath — 4px top-rounded, baseline-anchored bar path
  comparison/        baseline/candidate vocabulary — reusable beyond MAVERIK, but assumes
                     a comparison framing a plain chart wouldn't
    palette.js         baselineColor, deltaDirection (re-exports core/palette.js's
                       CATEGORICAL/colorForIndex too, so one import gets the full set)
    metrics.js          MAVERIK-specific: the METRICS array (pass rate, cost/question, duration,
                       tokens, tool calls), computeDelta, spread — domain data, not chart
                       infrastructure, kept out of core/ deliberately
    links.js             agentConfigHref, runCaseHref, mcpServersHref — cross-navigation URL
                       builders shared between CompareVersionsPage.jsx (react-router <Link>) and
                       the chart modules below (raw SVG <a>) — see "Cross-navigation" below
  deltaHeader.js     chart-type modules — built on core/ + comparison/
  reliabilityDelta.js
  paretoScatter.js
  regressionMatrix.js
  iterationBudget.js
  distributionStrip.js
  toolUsageFlow.js
  criterionOutcomes.js   chart-type modules — built on core/ only (RunDetailPage's agents are
  toolUsageProfile.js    peers, not a baseline + candidates, so these deliberately don't pull
  costSplit.js           in comparison/'s vocabulary)

frontend/src/components/ChartCard.jsx   the React host — container, theme, PNG/SVG buttons
```

`renderLegend` also takes an optional `maxWidth` that wraps onto additional rows instead of
running items off the chart's right edge, with a matching `estimateLegendRows` for sizing an SVG's
height before anything is in the DOM to measure — see `core/legend.js`'s own doc comment. Needed
once a chart's series count isn't a small fixed list (e.g. one line per agent in
`runs-over-time-*.js`, below); a short, fixed-size legend can ignore it entirely.

### Bridging into the sandboxed visualization system

`config/reporting/visualizations/*.js` (see `config/reporting/README.md`) can never `import`
anything — that's a deliberate, permanent constraint (groundwork for future iframe sandboxing),
not something this toolkit works around. Instead, `components/VisualizationRenderer.jsx` imports
`charts/core/*` normally (it's a real bundled component, not sandboxed) and passes the pure
functions through as `chartKit` in the object every sandboxed file already receives alongside
`d3`/`fullWidth`/`halfWidth`. This is deliberately just `core/`, not `comparison/` — a generic
dashboard visualization has no baseline/candidate framing to draw on. A sandboxed file that wants
gridlines, a tooltip, a legend, a categorical color, or an empty state reaches for
`chartKit.drawHorizontalGridlines`/`chartKit.createTooltip`/etc. instead of hand-rolling the same
chrome inline — see `config/reporting/visualizations/cost-per-question-distribution.js` or
`iteration-budget-utilization.js` for worked examples. Existing sandboxed files aren't required to
switch over immediately; this exists so new/modified ones don't re-derive what's already here.

### Cross-navigation

A chart's marks can double as links to wherever their data actually lives — Compare Versions'
Pareto scatter points and regression-matrix cells both do this (`charts/comparison/links.js`'s
`agentConfigHref`/`runCaseHref`, landing on `AgentsConfigPage.jsx`/`RunDetailPage.jsx`
respectively), and `toolUsageFlow.js` links out to `McpServersConfigPage.jsx`. Two conventions to
follow if you add another:

- **Wrap the mark in a real SVG `<a>`** (`.join("a")` instead of `.join("g")`, with `.attr("href",
  ...)`), not a synthetic `onClick` + programmatic navigation. This gets keyboard focus,
  open-in-new-tab, and right-click "copy link" for free. Put `tabindex="0"` on the `<a>` itself,
  never also on an inner hit-target circle/rect — that would create two tab stops for one point.
  **Trade-off, accepted deliberately**: a plain `<a>` inside a hand-rolled SVG is outside
  react-router's tree, so a click is a full page navigation, not a client-side route transition.
  Every page here already fetches its own data fresh on mount, so nothing meaningful is lost —
  this is simpler than threading a `navigate()` callback through every chart module's
  `(container, data, theme)` contract. A plain HTML control (not a data mark — e.g.
  `toolUsageFlow.js`'s "View this agent's MCP servers" link) can just be a real `<a>` appended
  outside the `<svg>` the same way; same trade-off, same reasoning.
- **Don't overclaim precision the data doesn't have.** `toolUsageFlow.js` links to the agent's
  whole configured server *set*, not a per-tool-bar link to "the" server that owns that tool —
  `QuestionRunResult.ToolNames` never recorded which server a call went to, so a per-segment link
  would imply an answer this data can't give. When in doubt, link at the coarsest level the data
  actually supports.

The landing page on the other end needs to accept an anchor/query param and make the target
findable — see `AgentsConfigPage.jsx`'s `parseAgentHash`/`highlightedAgentId`,
`McpServersConfigPage.jsx`'s `?servers=` handling, and `RunDetailPage.jsx`'s
`?agent=&version=&question=` handling for the three existing patterns (scroll into view + a
temporary `.is-highlighted` style). Reuse one of those rather than inventing a fourth.

## The chart module interface

Every chart-type module exports a function shaped `(container, data, theme) => void` — either as
the default export, or (when one chart is parameterized by a field, like the four distribution
strips) as a factory returning that shape:

```js
export default function render(container, data, theme) { ... }

// or, parameterized:
export function makeSomeChart(metricKey) {
  function render(container, data, theme) { ... }
  render.TITLE = `...`;
  return render;
}
```

Rules:

- **Own your own `import * as d3 from "d3"`.** Unlike the sandboxed visualizations, these are
  real ES modules — import whatever you need directly.
- **Render exactly one root `<svg>`.** `ChartCard`'s export buttons find it via
  `container.querySelector("svg")`. A chart that isn't fundamentally a plot (a KPI card row, say)
  still renders as an SVG grid of shapes/text, not HTML — see `deltaHeader.js`. This is
  deliberate: it makes PNG/SVG export uniform across every chart type with one mechanism, and it
  means every mark gets the same theming/spec treatment a "real" chart gets.
- **Redraw from scratch every call.** `ChartCard` clears the container (`node.replaceChildren()`)
  before calling `render`, so a module never has to guard against stale children from a previous
  render. A chart with internal interactive state (toggles, sort — see `regressionMatrix.js`)
  manages its own re-render via a local `redraw()` closure, the same pattern the sandboxed
  `cost-vs-correctness.js` established for its legend collapse button; it still starts from a
  fully-cleared sub-container each time.
- **Bake the title, subtitle, and any legend into the SVG itself**, not just the surrounding
  `ChartCard` header — see "Export requirements" below.
- **Handle `!data.baseline` (and "baseline present but zero usable data points") explicitly** —
  see "Empty, loading, and single-selection states."

`ChartCard` is the one host. It supplies `container`, calls `render(node, data, readTheme(node))`,
and renders the PNG/SVG export buttons plus a title/subtitle in its own header (in HTML, outside
the SVG — that header is for on-screen navigation, not part of what gets exported).

## Theming contract

Four dark themes share one CSS custom-property vocabulary (`frontend/src/styles.css`): `--bg`,
`--surface`, `--surface-raised`, `--border`, `--border-faint`, `--text`, `--text-strong`,
`--muted`, `--accent`, `--accent-strong`, `--accent-wash`, `--accent-2`, `--ok`/`--bad`/`--warn`/
`--info` (each with a `-wash` variant), `--track`, `--font-mono`, `--font-sans`, `--font-display`,
`--radius`.

Two ways a chart touches these, and when to use which:

1. **Set `var(--x)` directly** via `.style()`/`.attr()` — the default, for almost everything. The
   mark stays theme-live on screen if the user switches themes without a re-render.
2. **Use the resolved value from `theme` (via `core/theme.js`'s `readTheme`)** — only when
   something can't resolve a CSS custom property itself: `d3.interpolateRgb` needs literal hex
   (see the regression matrix's bad→ok ramp), and an exported SVG/PNG has no stylesheet once
   downloaded, so anything baked into an export needs a real value, not `"var(--x)"`.

`ChartCard` calls `readTheme(node)` once per render and hands the result to your module as the
third argument — never call `readTheme` yourself inside a chart module.

## Palette

`core/palette.js`'s `CATEGORICAL` — 8 hex values, CVD floor band (worst adjacent ΔE 10.3), ≥3:1
contrast against this app's card surface. 8 is a hard ceiling (cycling hues past 8 is
indistinguishable under CVD) — fold a 9th+ series into "Other," small multiples, or composite
encoding instead of adding a 9th color. `colorForIndex(i)` assigns by **position** in whatever
list you pass, not a hash — appropriate when series order is meaningful and stable for a page
session (e.g. candidates in the order they were selected). If you need hash-stable identity across
re-filtering instead (so a surviving series never repaints), hash your own key into an index.

`comparison/palette.js` adds the baseline/candidate layer:

- **`baselineColor(theme)`** — always `theme.muted`. The baseline is never "another series"; it's
  the fixed reference everything else is measured against. Pair it with a distinct **mark shape**
  (square, vs. candidates' circles) everywhere it appears — identity has to survive grayscale
  printing or a CVD simulation, not just live in the color.
- **`deltaDirection(delta, upIsGood, theme)`** — returns `{ color, glyph, good }`. `glyph` is
  ▲/▼/•. **Never render the color without the glyph.** That pairing is the actual mechanism behind
  the "never encode regression/improvement in color alone" rule — the rule lives in call-site
  discipline as much as in the function itself. For a metric with no inherent direction of
  goodness (e.g. tool-call count — more isn't better or worse on its own), don't call
  `deltaDirection` at all; show the glyph in `theme.muted` with no verdict color, the way
  `avgToolCalls` does in `comparison/metrics.js`.

## Export requirements

Every `ChartCard` gets a PNG and an SVG export button (`core/export.js`, via `ChartCard.jsx`).
Both clone the live root `<svg>`, walk every descendant, and bake `getComputedStyle` values for a
fixed property list (fill, stroke, stroke-width, color, font-family, font-size, font-weight,
opacity, text-anchor, dominant-baseline) into inline attributes — a downloaded file has no
stylesheet to resolve `var(--x)` against. SVG export serializes the clone directly; PNG
rasterizes it via an offscreen `<img>` + `<canvas>` at 2x scale, with a `--surface`-colored
background rect so there's no transparent hole where the app's background would have shown.

**What this means for a chart module**: the exported image is *exactly* what's in your `<svg>` —
nothing more. So:

- Draw the chart's **title and subtitle inside the SVG** (`core/svgFrame.js`'s `createChartSvg`
  does this for you — pass `title`/`subtitle` and it's handled).
- Draw any **legend inside the SVG** too (`core/legend.js`'s `renderLegend`), not as a sibling
  HTML element — an exported image with no legend is unreadable out of context.
- Interactive **controls** (toggle buttons, sort switches — see `regressionMatrix.js`) belong
  *outside* the SVG, as plain HTML siblings. They aren't part of "the chart," and exporting a
  screenshot of a button serves no one. The chart's *current state* (which toggle is active) is
  still reflected correctly, since that state drives what gets drawn inside the SVG.

## Low-n honesty rules

MAVERIK benchmark runs often have 1–3 repetitions per case. Every chart here is built around that
reality rather than around what looks smoothest:

- **Show individual points, never a fabricated distribution.** `distributionStrip.js` plots every
  repetition as its own dot via a one-shot beeswarm (`core/beeswarm.js`) — at n=2 that's two
  honest dots, not an interpolated curve.
- **A whisker only draws when there's real spread to show.** `deltaHeader.js`'s min–max whisker is
  skipped when `max === min` (n=1, or a metric that happened to be identical across reps) — a
  zero-width bar would misleadingly read as "measured and found to be exactly zero variance"
  rather than "nothing to show."
- **Call out determinism explicitly**, don't just let it look accidental. A metric that's
  bit-identical across every repetition (`values.length > 1 && new Set(values).size === 1` — see
  `distributionStrip.js`) gets a dedicated "deterministic" annotation. Token counts are usually
  deterministic; wall-clock duration essentially never is — that contrast is the point.
- **An average is never shown without its sample size next to it.** Every distribution strip lane
  labels `n=` and `mean` together.

## Empty, loading, and single-selection states

- **Loading / no data at the page level** (no suite selected, no runs recorded yet) is handled by
  `CompareVersionsPage.jsx` directly, above the chart grid — not a chart-module concern.
- **A chart with no baseline selected**, or a baseline but zero usable data points for that
  specific chart's metric, calls `core/emptyState.js`'s `showEmptyState(container, message)`
  instead of drawing anything. Write a message specific to what's missing (`"Pick a baseline
  version above..."` vs. `"No cost/pass-rate data for the selected versions."`) — don't reuse one
  generic string across every chart.
- **Single selection (baseline only, zero candidates) shows the absolute view, not an empty
  delta.** There's no central switch for this — it falls out of each chart's own logic naturally
  (an empty `candidates` array just means loops over it produce nothing), but every chart's
  subtitle should say so explicitly when relevant (see `deltaHeader.js`'s subtitle branching) so
  it reads as an intentional state, not a broken one.

## Adding a new chart

1. Decide the form first (per the dataviz skill — magnitude, identity, polarity, a single
   headline?), same as any chart in this app.
2. Create `frontend/src/charts/yourChart.js`. Export `TITLE` (a string) and a default
   `render(container, data, theme)` — or a `makeYourChart(param)` factory if the same chart shape
   gets reused parameterized by a field (copy `distributionStrip.js`'s pattern).
3. Build the SVG frame with `createChartSvg` from `core/svgFrame.js` — pass your computed
   `height`, `title`, `subtitle`. Use the returned `width` for your scales' ranges.
4. Reach for `core/axes.js`, `core/legend.js`, `core/tooltip.js`, `core/labelCollision.js`,
   `core/beeswarm.js` as your chart's shape calls for them — don't hand-roll gridlines, a tooltip,
   or a legend from scratch; if none of the existing helpers fit, that's a signal the toolkit
   needs a new one, not that this chart should go its own way.
5. Use `comparison/palette.js` (`baselineColor`, `deltaDirection`, `colorForIndex`) for any
   baseline/candidate or direction-of-goodness encoding. Use `comparison/metrics.js`'s `METRICS`
   if you're showing one of the 5 headline metrics — don't redefine formatting/delta logic per
   chart.
6. Guard the empty state with `core/emptyState.js`'s `showEmptyState`.
7. If a mark's data has an obvious landing page elsewhere in the app, wrap it in a real SVG `<a>`
   using/extending `comparison/links.js` — see "Cross-navigation" above. Not every chart needs
   this; skip it if there's nothing sensible to link to.
8. Wire it into `CompareVersionsPage.jsx` (or whatever page you're building) via a `<ChartCard
   title=... subtitle=... filename=... data={chartData} render={renderYourChart} />`. `filename`
   should be unique and descriptive — it's the downloaded file's base name.
9. Verify against real data before calling it done — this toolkit's charts were all checked by
   replicating each chart's pure-JS math in Node against real `/api/maverik/suite-runs` output,
   not just eyeballed. A chart that can't be verified this way at all is a signal its logic
   belongs in a testable module, not inline in the render function.
