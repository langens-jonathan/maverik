// Scatter: overall cost vs. pass rate, one point per agent in `data` (both averaged across that
// agent's records in the current selection) — the accuracy-per-dollar tradeoff view none of the
// single-metric line charts show. See ../README.md for the function contract.
//
// Styled per the dataviz skill (see the repo-level skill docs): colors are the app's own CSS
// custom properties (frontend/src/styles.css) rather than hardcoded hex, so this automatically
// matches whichever of the 4 MAVERIK themes is active and stays correct if the user switches
// themes without a re-render. Per-agent identity uses a validated dark-mode-safe categorical
// palette (8 slots, CVD-checked against this app's actual card surface — see
// dataviz/references/palette.md), assigned by a stable hash of agentId rather than array
// position, so re-filtering the dataset never repaints a surviving agent's color. Marks follow
// dataviz/references/marks-and-anatomy.md (2px surface ring on dots, hairline recessive
// gridlines, text never wears the data color) and interaction.md (oversized hit target, hover
// lift, a real tooltip instead of the native browser title). This file is the template for
// applying the same treatment to the rest of the chart-style visualizations later.
//
// No on-chart text labels: an earlier version put the agent id directly beside each dot, but
// agents with similar cost/pass-rate cluster together and the labels overlapped into an
// unreadable pile — the "converging series" case marks-and-anatomy.md calls out, whose
// prescribed fallback is legend + tooltip instead of direct labels. Identity now lives entirely
// in a legend column stacked to the right of the plot (one row per agent), collapsible so the
// chart can still sit at half-width when the legend isn't needed — collapsing it actually
// reclaims the space for the plot (the SVG is relaid out, not just visually covered), which is
// the point of making it collapsible rather than just hideable. See
// ReportViewPage.jsx's REPORT_HALF_WIDTH/REPORT_FULL_WIDTH and styles.css's `main.wide` — both
// were widened so two half-width charts still fit side by side with the legend expanded.
export default function (container, data, { d3, halfWidth }) {
  function avg(values) {
    const defined = values.filter((v) => v !== null && v !== undefined);
    return defined.length === 0 ? null : defined.reduce((a, b) => a + b, 0) / defined.length;
  }

  const byAgent = new Map();
  for (const r of data) {
    if (!byAgent.has(r.agentId)) byAgent.set(r.agentId, []);
    byAgent.get(r.agentId).push(r);
  }

  const points = [...byAgent.entries()]
    .map(([agentId, records]) => ({
      agentId,
      cost: avg(records.map((r) => r.summary.estOverallCostTotal)),
      passRate: avg(records.map((r) => r.summary.passRate)),
    }))
    .filter((p) => p.cost !== null && p.passRate !== null)
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  if (points.length === 0) {
    container.textContent = "No cost/pass-rate data for the selected runs.";
    return;
  }

  // Validated dark-mode categorical palette — 8 slots, CVD floor band (worst adjacent ΔE 10.3),
  // >=3:1 contrast against this app's card surface (#10141b). The legend is the required
  // mitigation for the floor band, not optional polish. 8 is a hard ceiling per the dataviz skill
  // (cycling hues past 8 is an anti-pattern, indistinguishable under CVD) — a 9th+ distinct agent
  // in `data` will reuse an earlier slot's color. Revisit (fold extras into "Other", or facet) if
  // MAVERIK deployments regularly compare more than 8 agents at once.
  const PALETTE = ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926"];
  function colorFor(agentId) {
    let hash = 0;
    for (let i = 0; i < agentId.length; i++) hash = (hash * 31 + agentId.charCodeAt(i)) >>> 0;
    return PALETTE[hash % PALETTE.length];
  }

  const totalWidth = halfWidth ?? 560;
  const height = 320;
  const margin = { top: 20, right: 20, bottom: 44, left: 56 };
  const LEGEND_GAP = 12;
  const LEGEND_WIDTH_EXPANDED = 140;
  const LEGEND_WIDTH_COLLAPSED = 26;

  let collapsed = false;
  const deselected = new Set();

  const root = d3.select(container).append("div").style("position", "relative")
    .style("display", "flex").style("align-items", "flex-start").style("gap", `${LEGEND_GAP}px`);

  const chartCol = root.append("div").style("position", "relative").style("flex", "0 0 auto");
  const svg = chartCol.append("svg").attr("height", height).style("overflow", "visible");

  const x = d3.scaleLinear().domain([0, d3.max(points, (p) => p.cost) ?? 0]).nice();
  const y = d3.scaleLinear().domain([0, 1]).range([height - margin.bottom, margin.top]);

  const gridY = svg.append("g");
  const gridX = svg.append("g");
  const axisX = svg.append("g").attr("transform", `translate(0,${height - margin.bottom})`);
  const axisY = svg.append("g").attr("transform", `translate(${margin.left},0)`);
  const pointsLayer = svg.append("g");

  // Floating tooltip — same chrome as the app's own dropdown (.export-menu-dropdown in
  // styles.css): surface-raised, hairline border, soft shadow. Values lead, series name follows
  // (interaction.md). Built with textContent-safe .text()/appended spans, never innerHTML, since
  // agentId is untrusted data. Shared by dot-hover and legend-hover.
  const tooltip = d3.select(container)
    .append("div")
    .style("position", "absolute")
    .style("pointer-events", "none")
    .style("opacity", 0)
    .style("background", "var(--surface-raised)")
    .style("border", "1px solid var(--border)")
    .style("border-radius", "var(--radius)")
    .style("box-shadow", "0 6px 18px rgba(0,0,0,0.25)")
    .style("padding", "0.5rem 0.65rem")
    .style("font-size", "0.78rem")
    .style("font-family", "var(--font-sans)")
    .style("color", "var(--text)")
    .style("z-index", 10)
    .style("transition", "opacity 0.1s");

  function showTooltip(p, atX, atY) {
    tooltip.selectAll("*").remove();
    const value = tooltip.append("div").style("font-weight", 600).style("color", "var(--text-strong)");
    value.append("span").text(`$${p.cost.toFixed(4)}`);
    value.append("span").style("color", "var(--muted)").style("font-weight", 400).text(" avg. cost");
    tooltip.append("div").style("margin-top", "0.15rem").text(`${Math.round(p.passRate * 100)}% pass rate`);
    const name = tooltip.append("div")
      .style("margin-top", "0.35rem")
      .style("display", "flex")
      .style("align-items", "center")
      .style("gap", "0.35rem");
    name.append("span")
      .style("width", "8px").style("height", "8px").style("border-radius", "50%")
      .style("background", colorFor(p.agentId)).style("display", "inline-block").style("flex-shrink", 0);
    name.append("span").style("font-family", "var(--font-mono)").style("font-size", "0.75rem").text(p.agentId);
    tooltip.style("left", `${atX}px`).style("top", `${atY}px`).style("opacity", 1);
  }
  function hideTooltip() {
    tooltip.style("opacity", 0);
  }

  function highlight(agentId) {
    pointsLayer.selectAll(".cvc-dot")
      .attr("r", (p) => (p.agentId === agentId ? 9 : 6))
      .style("opacity", (p) => (deselected.has(p.agentId) ? 0 : p.agentId === agentId ? 1 : 0.3));
  }
  function clearHighlight() {
    pointsLayer.selectAll(".cvc-dot")
      .attr("r", 6)
      .style("opacity", (p) => (deselected.has(p.agentId) ? 0 : 1));
  }
  function applyDeselection() {
    pointsLayer.selectAll(".cvc-point")
      .style("pointer-events", (p) => (deselected.has(p.agentId) ? "none" : null));
    clearHighlight();
  }

  // Everything below is position-dependent on the plot's width, so it's wrapped in one function
  // re-run on load and on every legend collapse/expand — collapsing reclaims the legend's space
  // for the plot rather than just hiding it (see the file header).
  function layoutPlot() {
    const legendWidth = collapsed ? LEGEND_WIDTH_COLLAPSED : LEGEND_WIDTH_EXPANDED;
    const plotWidth = Math.max(280, totalWidth - legendWidth - LEGEND_GAP);
    x.range([margin.left, plotWidth - margin.right]);
    svg.attr("width", plotWidth);

    gridY.selectAll("line").data(y.ticks(5)).join("line")
      .attr("x1", margin.left).attr("x2", plotWidth - margin.right)
      .attr("y1", (v) => y(v)).attr("y2", (v) => y(v))
      .attr("stroke", "var(--border-faint)").attr("stroke-width", 1);

    gridX.selectAll("line").data(x.ticks(6)).join("line")
      .attr("y1", margin.top).attr("y2", height - margin.bottom)
      .attr("x1", (v) => x(v)).attr("x2", (v) => x(v))
      .attr("stroke", "var(--border-faint)").attr("stroke-width", 1);

    axisX.call(d3.axisBottom(x).ticks(6).tickFormat((v) => `$${v}`).tickSizeOuter(0))
      .call((g) => g.select(".domain").attr("stroke", "var(--border)"))
      .call((g) => g.selectAll(".tick line").attr("stroke", "var(--border)"))
      .call((g) => g.selectAll("text").attr("fill", "var(--muted)").attr("font-size", 11).attr("font-family", "var(--font-mono)"));

    axisY.call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${Math.round(v * 100)}%`).tickSizeOuter(0))
      .call((g) => g.select(".domain").attr("stroke", "var(--border)"))
      .call((g) => g.selectAll(".tick line").attr("stroke", "var(--border)"))
      .call((g) => g.selectAll("text").attr("fill", "var(--muted)").attr("font-size", 11).attr("font-family", "var(--font-mono)"));

    pointsLayer.selectAll(".cvc-dot").attr("cx", (p) => x(p.cost)).attr("cy", (p) => y(p.passRate));
    pointsLayer.selectAll(".cvc-hit").attr("cx", (p) => x(p.cost)).attr("cy", (p) => y(p.passRate));
  }

  const point = pointsLayer.selectAll("g").data(points).join("g")
    .attr("class", "cvc-point")
    .style("cursor", "pointer");

  // Visible mark: r=6 (12px, clears the >=8px floor). 2px ring in the surface color is the
  // separation mechanism — never a border (marks-and-anatomy.md).
  point.append("circle")
    .attr("class", "cvc-dot")
    .attr("r", 6)
    .attr("fill", (p) => colorFor(p.agentId))
    .attr("stroke", "var(--surface)")
    .attr("stroke-width", 2)
    .style("transition", "r 0.12s, opacity 0.12s");

  // Oversized (28px) transparent hit target — an r=6 dot is a pinpoint nobody hits reliably
  // (interaction.md). Hover highlights the dot (dimming its siblings) and shows the tooltip;
  // same details reachable on keyboard focus as on pointer hover.
  point.append("circle")
    .attr("class", "cvc-hit")
    .attr("r", 14)
    .attr("fill", "transparent")
    .attr("tabindex", 0)
    .on("mouseenter focus", function (event, p) {
      highlight(p.agentId);
      showTooltip(p, x(p.cost) + 16, y(p.passRate) - 10);
    })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event, container);
      tooltip.style("left", `${mx + 14}px`).style("top", `${my - 10}px`);
    })
    .on("mouseleave blur", function () {
      clearHighlight();
      hideTooltip();
    });

  // Legend column — stacked vertically to the right of the plot, one row per agent, the
  // dependable identity channel now that direct labels are gone (see file header). Real
  // <button>s so hover, click-to-toggle, and keyboard activation (Enter/Space) come for free.
  const legendCol = root.append("div")
    .style("flex", "0 0 auto")
    .style("width", `${LEGEND_WIDTH_EXPANDED}px`)
    .style("display", "flex")
    .style("flex-direction", "column")
    .style("max-height", `${height}px`)
    .style("overflow-y", "auto");

  const toggleBtn = legendCol.append("button")
    .attr("type", "button")
    .attr("aria-expanded", "true")
    .attr("title", "Collapse legend")
    .style("align-self", collapsed ? "center" : "flex-end")
    .style("background", "none")
    .style("border", "1px solid var(--border)")
    .style("border-radius", "var(--radius)")
    .style("color", "var(--muted)")
    .style("font-size", "0.7rem")
    .style("line-height", 1)
    .style("padding", "0.25rem 0.4rem")
    .style("margin-bottom", "0.5rem")
    .style("cursor", "pointer")
    .text("»");

  const legendList = legendCol.append("div")
    .style("display", "flex")
    .style("flex-direction", "column")
    .style("gap", "0.4rem");

  const legendItem = legendList.selectAll("button").data(points).join("button")
    .attr("type", "button")
    .style("display", "flex")
    .style("align-items", "center")
    .style("gap", "0.35rem")
    .style("font", "inherit")
    .style("font-size", "0.76rem")
    .style("font-family", "var(--font-sans)")
    .style("color", "var(--muted)")
    .style("background", "none")
    .style("border", "none")
    .style("padding", "0")
    .style("cursor", "pointer")
    .style("opacity", 1)
    .style("transition", "opacity 0.12s")
    .style("max-width", `${LEGEND_WIDTH_EXPANDED}px`)
    .attr("aria-pressed", "true");

  legendItem.append("span")
    .style("width", "8px").style("height", "8px").style("border-radius", "50%")
    .style("background", (p) => colorFor(p.agentId)).style("display", "inline-block").style("flex-shrink", 0);

  legendItem.append("span")
    .style("font-family", "var(--font-mono)")
    .style("overflow", "hidden")
    .style("text-overflow", "ellipsis")
    .style("white-space", "nowrap")
    .style("min-width", "0") // flex children don't shrink for ellipsis without this
    .style("flex", "1 1 auto")
    .attr("title", (p) => p.agentId)
    .text((p) => p.agentId);

  legendItem
    .on("mouseenter focus", function (event, p) {
      if (deselected.has(p.agentId)) return;
      highlight(p.agentId);
      showTooltip(p, x(p.cost) + 16, y(p.passRate) - 10);
    })
    .on("mouseleave blur", function () {
      clearHighlight();
      hideTooltip();
    })
    .on("click", function (event, p) {
      if (deselected.has(p.agentId)) deselected.delete(p.agentId);
      else deselected.add(p.agentId);
      d3.select(this)
        .style("opacity", deselected.has(p.agentId) ? 0.4 : 1)
        .attr("aria-pressed", deselected.has(p.agentId) ? "false" : "true");
      applyDeselection();
      hideTooltip();
    });

  toggleBtn.on("click", function () {
    collapsed = !collapsed;
    legendCol.style("width", `${collapsed ? LEGEND_WIDTH_COLLAPSED : LEGEND_WIDTH_EXPANDED}px`);
    legendList.style("display", collapsed ? "none" : "flex");
    toggleBtn
      .text(collapsed ? "«" : "»")
      .attr("title", collapsed ? "Expand legend" : "Collapse legend")
      .attr("aria-expanded", collapsed ? "false" : "true")
      .style("align-self", collapsed ? "center" : "flex-end");
    layoutPlot();
  });

  layoutPlot();
  applyDeselection();
}
