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
export default function(container, data, { d3 }) {
  // container: an empty <div> the host created for this visualization. Render into it.
  // data: an array of SuiteRunRecord objects (see results/suite-runs/*.json for the shape).
  // { d3 }: libraries the host injects. Don't `import` anything yourself.
}
```

A table-shaped visualization follows the identical signature — it's just conventional to build a
`<table>` and append it to `container` instead of drawing SVG.

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
