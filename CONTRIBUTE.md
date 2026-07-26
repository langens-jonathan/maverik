# Contributing to MAVERIK

Thanks for considering a contribution. Most contributions to MAVERIK fall into one of four
buckets, roughly ordered from "smallest, most self-contained" to "touches the most code":

1. [A new visualization](#1-a-new-visualization) — a chart or table under `config/reporting/visualizations/`.
2. [A new dashboard](#2-a-new-dashboard) — a composition of visualizations under `config/reporting/dashboards/`.
3. [Backend changes](#3-backend-changes) — the ASP.NET Core host under `maverik/`.
4. [Frontend changes](#4-frontend-changes) — the React dashboard under `frontend/`.

If you're not sure which bucket your idea fits, open an issue first and describe what you want
to do — happy to help place it.

## 1. A new visualization

Visualizations are the easiest way to contribute: a single file, no build step, no in-app
editor to fight — you write it directly on disk and refresh the page. The full contract (the
exact function signature, the `layout` export, the container-only execution discipline, why it's
deliberately not sandboxed) is documented in
[`config/reporting/README.md`](config/reporting/README.md); read that before you start. The
short version: every file under `config/reporting/visualizations/<id>.js` default-exports
`function(container, data, { d3, fullWidth, halfWidth })`, where `data` is always an array of
`SuiteRunRecord` (see `results/suite-runs/*.json` for the shape), and the function may only
touch `container`, its arguments, and `d3` — no `window`/`document`/`fetch`.

There's no distinct "chart" vs. "table" type — a table is just a visualization that builds a
`<table>` instead of an SVG. Here's a minimal, working example of each (trimmed for this doc;
the real, fuller versions ship at `config/reporting/visualizations/avg-duration-by-agent.js` and
`results-table.js` — read those for the complete picture, including axis styling and the
`layout` export).

### Example: a graph

```js
// config/reporting/visualizations/avg-duration-by-agent.js
export default function (container, data, { d3, halfWidth }) {
  if (data.length === 0) {
    container.textContent = "No runs selected.";
    return;
  }

  const width = halfWidth ?? 480;
  const height = 260;
  const margin = { top: 20, right: 16, bottom: 60, left: 56 };

  const bars = data.map((r) => ({ label: r.agentId, value: r.summary.avgDurationMs }));

  const svg = d3.select(container).append("svg").attr("width", width).attr("height", height);
  const x = d3.scaleBand().domain(bars.map((b) => b.label)).range([margin.left, width - margin.right]).padding(0.2);
  const y = d3.scaleLinear().domain([0, d3.max(bars, (b) => b.value) ?? 0]).nice().range([height - margin.bottom, margin.top]);

  svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(x));
  svg.append("g").attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(y));

  svg.append("g").selectAll("rect").data(bars).join("rect")
    .attr("x", (b) => x(b.label))
    .attr("y", (b) => y(b.value))
    .attr("width", x.bandwidth())
    .attr("height", (b) => y(0) - y(b.value))
    .attr("fill", "steelblue");
}
```

A chart-shaped visualization defaults to `layout: "half"` (it shares a row with a neighbor on
the report "Open" screen) unless you export `layout = "full"` — size your SVG off the injected
`halfWidth`, with a hardcoded fallback for hosts that don't pass one.

### Example: a table

```js
// config/reporting/visualizations/results-table.js
export const layout = "full"; // tables want the whole row, not half of it
export default function (container, data, { d3 }) {
  const columns = [
    ["Suite", (r) => r.suiteId],
    ["Agent", (r) => r.agentId],
    ["Pass rate", (r) => `${Math.round(r.summary.passRate * 100)}%`],
  ];

  const table = d3.select(container).append("table");
  table.append("thead").append("tr").selectAll("th").data(columns).join("th").text(([label]) => label);
  table.append("tbody").selectAll("tr").data(data).join("tr")
    .selectAll("td").data((row) => columns.map(([, get]) => get(row))).join("td").text((v) => v);
}
```

Tables don't need to size themselves — the global `table { width: 100% }` rule fills whatever
row they're given; `layout = "full"` is the only thing that matters.

**To submit one:** drop the file under `config/reporting/visualizations/<id>.js`, preview it
against real run data in the dashboard's `Reporting > Visualizations` tab, and open a PR. No
backend or frontend code changes are needed for a visualization-only contribution.

## 2. A new dashboard

A dashboard composes existing visualizations into titled sections — one JSON file under
`config/reporting/dashboards/<id>.json`:

```json
{
  "id": "reliability-diagnostics",
  "title": "Reliability & Diagnostics",
  "sections": [
    {
      "title": "Where it's failing",
      "visualizations": [
        { "ref": "question-pass-rate-matrix", "title": "Pass rate by question & agent" },
        { "ref": "reliability-by-agent", "title": "Error rate & iteration-limit hits by agent" }
      ]
    },
    {
      "title": "Tool usage",
      "visualizations": [{ "ref": "tool-call-frequency", "title": "Tool call frequency" }]
    }
  ]
}
```

`ref` is a visualization id (the filename minus `.js`); `title` is an optional per-instance
caption override — set it, the report view is much easier to read at a glance than an unlabeled
grid of charts. Every `ref` has to resolve to a real visualization file, which is checked on
save.

You can build one two ways: through the dashboard's `Reporting > Dashboards` tab (full CRUD, plus
a live preview against real runs before you save), or by hand-authoring the JSON file directly
and refreshing the tab — same result either way, since the UI is just reading and writing that
file. See `config/reporting/dashboards/agent-comparison.json`,
`trends-over-time.json`, and `reliability-diagnostics.json` for the three shipped defaults — a
good dashboard usually groups a handful of related visualizations under a few clearly-titled
sections rather than dumping everything into one.

**To submit one:** add the JSON file, preview it against real runs, open a PR. Like
visualizations, no backend/frontend code changes needed.

## 3. Backend changes

The backend (`maverik/`, ASP.NET Core / .NET 9) is the smaller, more architecturally opinionated
half of the codebase — read [`CLAUDE.md`](CLAUDE.md) first, it's the authoritative source on
*why* things are built the way they are, not just what's there. A few load-bearing points worth
knowing before you touch anything:

- **The chat client is registered without `.UseFunctionInvocation()`.** `ChatWorker` and
  `MaverikRunner` both drive the tool-call loop by hand through the shared `ILoopStrategy`
  implementations — that's what makes a run's tool calls, iterations, and timing actually
  measurable instead of hidden inside SDK middleware. Don't re-add that middleware.
- **Chat and the MAVERIK benchmark runner share the same loop code.** A new loop strategy, a new
  criterion type, a new tool-cost rule — it should work identically whether you're poking an
  agent by hand in the Chat REPL or running it through a suite.
- **Namespace follows folder**: everything under `maverik/src/<domain>/` maps to
  `McpHost.<Domain>` (see CLAUDE.md's Conventions section for the exact list). Put new code in
  the domain folder it belongs to rather than growing `Program.cs`.
- **There is no test project.** Verify changes by running `dotnet build` (clean compile), then
  `docker compose up -d --build` and actually exercising the change — start a run, hit the
  endpoint with `curl`, check `docker compose logs maverik`. This project leans hard on "does it
  actually work end-to-end," not on a test suite catching you.

Good first backend contributions: a new criterion type (alongside `exact`/`contains`/`regex`/
`llm-judge`), a new `ILoopStrategy`, or a results exporter for a format MAVERIK doesn't already
write.

## 4. Frontend changes

The frontend (`frontend/`, React + Vite) is a separate app/container that talks to the backend
purely over `/api/*` — see `frontend/src/api.js` for the full request surface. Conventions:

- `pages/` — one file per route, matching `main.jsx`'s route table.
- `components/` — shared pieces used by more than one page (`VisualizationRenderer`,
  `SaveNotice`, `NotFound`, ...).
- `hooks/` — small reusable hooks (`usePolling`, `useTheme`).
- Styling is plain CSS in `styles.css` using theme-scoped custom properties (`var(--accent)`,
  `var(--surface)`, `var(--muted)`, ...) rather than hardcoded colors, so a new component works
  across every theme in `hooks/useTheme.js` without extra effort. Reuse existing classes
  (`.card`, `.field-row`, `.field-hint`, `.muted`, `.error-text`, `button.secondary`) before
  inventing new ones.
- **There is no test project here either.** Verify with `npm run build` (clean build), then
  `docker compose up -d --build maverik-frontend` and click through the actual change in a
  browser — the golden path and at least one edge case (empty state, error state).

Good first frontend contributions: a new page for a backend capability that only has a `curl`
story today, a UX improvement to an existing config editor, or a new theme in `useTheme.js`.

## Before you open a PR

- `dotnet build` is clean (if you touched `maverik/`).
- `npm run build` is clean (if you touched `frontend/`).
- You've actually run the change against a real `docker compose up -d --build` and watched it
  work — screenshots/terminal output in the PR description are appreciated, since there's no CI
  test suite to point to instead.
- If you changed documented behavior, update `CLAUDE.md` and/or `README.md` in the same PR —
  stale docs are worse than no docs.

## License

MAVERIK is Apache 2.0 licensed (see [`LICENSE`](LICENSE)). By contributing, you agree your
contribution is licensed under the same terms.
