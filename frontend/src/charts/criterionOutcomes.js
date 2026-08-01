// RunDetailPage chart: pass rate grouped by criterion type (exact/contains/regex/llm-judge) —
// a low pass rate is easy to misread as "the agent is bad" when it's really "this suite leans
// heavily on one brittle criterion type." Grouped bar (criterion type x agent), the same shape as
// charts/toolUsageFlow.js, but built directly on core/ only: a run's agents are peers, not a
// baseline + candidates, so this deliberately does NOT pull in comparison/palette.js's
// baseline vocabulary — every agent gets a plain colorForIndex color, no special-cased first row.
//
// Built on the shared chart toolkit — see docs/chart-design-system.md.
import * as d3 from "d3";
import { createChartSvg } from "./core/svgFrame.js";
import { drawHorizontalGridlines, styleAxis } from "./core/axes.js";
import { createTooltip } from "./core/tooltip.js";
import { renderLegend } from "./core/legend.js";
import { showEmptyState } from "./core/emptyState.js";

export const TITLE = "Pass rate by criterion type";

function criterionStatsFor(agent, criteriaByQuestionId) {
  const byType = new Map();
  for (const c of agent.results ?? []) {
    if (c.error != null) continue;
    const type = criteriaByQuestionId[c.questionId] ?? "unknown";
    const s = byType.get(type) ?? { total: 0, passed: 0 };
    s.total += 1;
    if (c.passed) s.passed += 1;
    byType.set(type, s);
  }
  return byType;
}

export default function render(container, data, theme) {
  const { agents, criteriaByQuestionId } = data;
  if (!agents || agents.length === 0) {
    showEmptyState(container, "No agents in this run.");
    return;
  }

  const statsByAgent = agents.map((a) => criterionStatsFor(a, criteriaByQuestionId));
  const allTypes = new Set();
  statsByAgent.forEach((byType) => byType.forEach((_, type) => allTypes.add(type)));
  const criterionTypes = [...allTypes].sort();

  if (criterionTypes.length === 0) {
    showEmptyState(container, "No evaluated cases to break down by criterion type.");
    return;
  }

  const bars = criterionTypes.flatMap((type) =>
    agents.map((a, ai) => {
      const s = statsByAgent[ai].get(type);
      return { type, agent: a, rate: s ? s.passed / s.total : null, n: s?.total ?? 0 };
    })
  );

  const legendH = agents.length > 1 ? 26 : 0;
  const height = 300 + legendH;
  const margin = { top: 20, right: 20, bottom: 56, left: 48 };
  const subtitle = "Pass rate per criterion type — isolates whether failures cluster on one kind of check";

  const { svg, width } = createChartSvg(container, { minWidth: 460, height, title: TITLE, subtitle }, theme);

  const x0 = d3.scaleBand().domain(criterionTypes).range([margin.left, width - margin.right]).paddingInner(0.35);
  const x1 = d3.scaleBand().domain(agents.map((a) => a.label)).range([0, x0.bandwidth()]).padding(0.15);
  const y = d3.scaleLinear().domain([0, 1]).range([height - margin.bottom - legendH, margin.top]);

  drawHorizontalGridlines(svg, y, margin.left, width - margin.right, theme, { tickCount: 5 });

  styleAxis(
    svg.append("g").attr("transform", `translate(${margin.left},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat((v) => `${Math.round(v * 100)}%`).tickSizeOuter(0)),
    theme,
    { fontSize: 10 }
  );

  const xAxis = svg.append("g").attr("transform", `translate(0,${height - margin.bottom - legendH})`)
    .call(d3.axisBottom(x0).tickSizeOuter(0));
  xAxis.select(".domain").attr("stroke", theme.border);
  xAxis.selectAll(".tick line").remove();
  xAxis.selectAll("text")
    .attr("fill", theme.text).attr("font-size", 11).attr("font-family", theme.fontMono);

  const tooltip = createTooltip(container, theme);

  const groups = svg.selectAll(".co-group").data(criterionTypes).join("g")
    .attr("class", "co-group")
    .attr("transform", (type) => `translate(${x0(type)},0)`);

  groups.selectAll("rect").data((type) => bars.filter((b) => b.type === type)).join("rect")
    .attr("x", (b) => x1(b.agent.label))
    .attr("y", (b) => (b.rate == null ? y(0) : y(b.rate)))
    .attr("width", x1.bandwidth())
    .attr("height", (b) => (b.rate == null ? 0 : y(0) - y(b.rate)))
    .attr("rx", 2)
    .attr("fill", (b) => b.agent.color)
    .style("cursor", (b) => (b.rate == null ? "default" : "pointer"))
    .on("mouseenter", function (event, b) {
      if (b.rate == null) return;
      d3.select(this).attr("opacity", 0.8);
      tooltip.clear();
      tooltip.node.append("div").style("font-weight", 600).style("color", theme.textStrong)
        .text(`${b.type} · ${b.agent.label}`);
      tooltip.node.append("div").style("margin-top", "0.15rem")
        .text(`${Math.round(b.rate * 100)}% pass rate · n=${b.n}`);
      const [mx, my] = d3.pointer(event, container);
      tooltip.showAt(mx + 14, my - 10);
    })
    .on("mousemove", function (event) {
      const [mx, my] = d3.pointer(event, container);
      tooltip.moveTo(mx + 14, my - 10);
    })
    .on("mouseleave", function () {
      d3.select(this).attr("opacity", 1);
      tooltip.hide();
    });

  if (agents.length > 1) {
    renderLegend(
      svg,
      agents.map((a) => ({ shape: "circle", color: a.color, label: a.label })),
      theme,
      { x: 0, y: height - legendH + 14, fontSize: 10, gap: 18, widthMultiplier: 6 }
    );
  }
}
