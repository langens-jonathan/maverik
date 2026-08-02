# Reporting: visualizations

Files under `visualizations/` are plain JavaScript modules, one file per visualization, id =
filename without `.js`. A visualization can render as a chart, a table, or anything else you draw
into the DOM — there's no separate "table" type; it's just a matter of what a given function
builds. They are **authored and edited directly on disk** — `config/` is already bind-mounted
read-write into the container, and there is no in-app editor for these; the dashboard only lists
what exists here and lets you preview it against real run data. Add a file, refresh the
Visualizations tab, it shows up.

## The function contract

Every file's default export is a function with this exact signature:

```js
export default function(container, data, { d3, fullWidth, halfWidth, chartKit }) {
  // container: an empty <div> the host created for this visualization. Render into it.
  // data: an array of SuiteRunRecord objects (see results/suite-runs/*.json for the shape).
  // { d3 }: libraries the host injects. Don't `import` anything yourself.
  // fullWidth/halfWidth: pixel budgets for a "full row" vs. "half row" slot in whatever layout
  // is hosting this visualization (see "Sizing & layout" below). Not every host passes real
  // values — treat both as optional and fall back to a sane hardcoded width if undefined.
  // chartKit: the pure, MAVERIK-agnostic half of frontend/src/charts/core/ — createChartSvg,
  // createTooltip, renderLegend (+ estimateLegendRows), drawHorizontalGridlines/
  // drawVerticalGridlines/styleAxis, placeLabels, beeswarm, showEmptyState, readTheme,
  // CATEGORICAL/colorForIndex, barPath. This is how the app's shared chart toolkit
  // (docs/chart-design-system.md) applies here despite the no-import rule below — reach for it
  // instead of hand-rolling gridline/tooltip/legend chrome inline. See
  // cost-per-question-distribution.js or iteration-budget-utilization.js for worked examples.
}
```

Each `SuiteRunRecord` also carries a `results` array — that agent's per-question detail
(`QuestionRunResult[]`: duration, tokens, tool calls, pass/fail, error, …) from the source run,
copied in at write time. It exists specifically so a per-question visualization (see
`question-details.js`) can flatten `data.flatMap(r => r.results)` without ever calling `fetch` —
the container-only rule below still holds. Records written before this field existed just have
`results: []`.

A table-shaped visualization follows the identical signature — it's just conventional to build a
`<table>` and append it to `container` instead of drawing SVG.

## Sizing & layout

A file may also export a named `layout`:

```js
export const layout = "full"; // default is "half" if this export is absent
```

Some hosts (currently the report "Open" screen) lay visualizations out in a two-column grid and
use this to decide whether an instance gets the whole row or shares it with a neighbor. Tables
don't need to do anything else — the global `table { width: 100% }` rule already fills whichever
slot they're given — so only `layout = "full"` needs setting on those; charts should instead size
their own SVG using the injected `halfWidth` (`const width = halfWidth ?? 560;`), since that's the
slot they'll actually get. Every shipped table visualization sets `layout = "full"`; every shipped
chart defaults to `"half"` and sizes off `halfWidth`. A host that doesn't lay things out in columns
(e.g. the Visualizations tab's single preview) just never passes a `fullWidth`/`halfWidth` that
differs from its own single-column width, so this is safe to ignore if you don't care about it —
your chart will just always render at whatever `halfWidth` fallback you hardcode.

## The one rule: container-only

**A visualization function may only read `data`, use the libraries it's given, and render into
`container`.** No `window`, no `document` outside `container`, no `fetch`, no reaching into the
rest of the page.

This isn't enforced by a sandbox today — MAVERIK is a self-hosted, single-user tool, and these
files are trusted the same way system prompts and suite JSON already are. But the rule is what
keeps a future move to iframe-sandboxed execution (isolating a broken/misbehaving visualization
from the rest of the app) a plumbing change instead of a rewrite of every visualization. Write
your functions as if they were already sandboxed.

## Examples

See `avg-duration-by-agent.js` (a D3 bar chart) and `results-table.js` (a plain `<table>`) for
minimal working examples — same contract, different rendering choice.

## Default visualizations

MAVERIK ships 35 default visualizations. 28 are chart-shaped — exportable one at a time as PNG or
SVG, same as any chart in the Visualizations tab. 7 are table-shaped (`metrics-by-agent.js`,
`metrics-by-run.js`, `question-details.js`, `question-pass-rate-matrix.js`,
`reliability-by-agent.js`, `capability-by-agent.js`, `results-table.js`) — exportable one at a time
too, but PNG only, since an HTML table has no natural vector-graphics form (see
docs/chart-design-system.md's `exportElementAsPng`).

### The 9 outcome parameters

Covering the 9 metrics every `AgentSummary` tracks (pass rate, duration, input/output tokens, tool
calls, peak context tokens, token/tool/overall cost):

- `runs-over-time-<metric>.js` (9 files) — line chart, one line per agent (color + legend once more
  than one agent is in the current selection), x-axis = each run's timestamp. A point is marked
  with a dashed ring + a tooltip note when that agent's config changed since its previous recorded
  run, so a metric shift reads as visually tied to "something changed here," not a mystery.
- `agent-average-<metric>.js` (9 files) — bar chart, one bar per distinct `agentId` in `data`,
  height = that metric averaged across the agent's records in the current selection. Bar, not
  line: agents are unordered categories, not a time series, and a connected line here would falsely
  imply order/trend between them.
- `metrics-by-agent.js` — table, all 9 metrics (plus Anthropic prompt-caching token averages, null
  for agents without `promptCaching` enabled) averaged per agent.
- `metrics-by-run.js` — table, all 9 metrics per individual run record (no aggregation).
- `question-details.js` — table, one row per question/case, flattened out of every record's
  `results` field (see above).

`<metric>` is one of: `correctness`, `duration`, `input-tokens`, `output-tokens`, `tool-calls`,
`context-window`, `token-cost`, `tool-cost`, `overall-cost`. These are plain files like any other
— edit or delete them the same way you would a hand-authored one.

### Beyond the 9-metric grid

Using the per-question `results` data directly, or reliability/capability/worst-case fields
outside the original 9 parameters:

- `question-pass-rate-matrix.js` — heatmap table, one row per question, one column per agent,
  cell = pass rate for that pair. Rows sort worst-first so the questions actually worth looking
  at surface at the top.
- `cost-vs-correctness.js` — scatter, one point per agent, x = overall cost, y = pass rate — the
  accuracy-per-dollar tradeoff none of the single-metric charts show.
- `cost-per-question-distribution.js` — beeswarm, one lane per agent, every case's own cost as its
  own point — an average alone hides whether an agent's cost is consistent or has a long tail of
  expensive outlier questions.
- `duration-per-question-distribution.js` — the same beeswarm treatment for duration, the direct
  counterpart to `agent-average-duration.js`'s average-only view.
- `cost-composition-by-agent.js` — stacked bar, token cost + tool cost per agent — the split none
  of `agent-average-token-cost.js`/`tool-cost.js`/`overall-cost.js` can show on its own, since each
  only ever plots one number per agent.
- `cache-effectiveness-by-agent.js` — bar chart, cache-read tokens as a share of average input
  tokens, per agent with `promptCaching` enabled — is caching actually paying off for this agent?
  Filters on each record's own `agentSnapshot.promptCaching`, not just whether
  `avgCacheReadInputTokens` is non-null (a non-caching agent can still report a literal `0` there).
- `peak-context-ceiling-by-agent.js` — bar chart, the *worst-case* (not average) peak context
  tokens per agent — an agent can look comfortably clear of the context limit on average while
  still having occasional near-miss cases the average hides.
- `tool-call-frequency.js` — bar chart, call count per tool name, summed across every case.
- `iteration-budget-utilization.js` — bar chart, avg(iterations / that record's own
  `agentSnapshot.maxIterations`) per agent — a near-miss signal before an agent ever actually hits
  its iteration limit.
- `runs-over-time-iteration-limit-rate.js` — line chart, the per-run counterpart to
  `reliability-by-agent.js`'s single collapsed number: fraction of evaluated cases that hit the
  iteration limit, one line per agent, over time, with the same config-change markers as the
  9-metric `runs-over-time-*.js` family.
- `reliability-by-agent.js` — table of error rate and iteration-limit-hit rate per agent, the
  reliability signals a pass-rate number alone doesn't explain.
- `capability-by-agent.js` — table, each agent's current tool-catalog identity (tool count + a
  content-hashed digest), plus whether that digest stayed stable or changed across the selection.

One more note on consistency: `avg-duration-by-agent.js` (see "Examples" above),
`cost-vs-correctness.js`, `tool-call-frequency.js`, and all 9 `agent-average-<metric>.js` files
predate `chartKit` and are still hand-rolled (`var(--x)` inline styling, no `chartKit` param) —
everything else listed above is `chartKit`-based. Not a bug, just something to know before copying
one of the hand-rolled files as a template for a new visualization; prefer a `chartKit`-based one
instead (see the function contract above for which files to copy).
