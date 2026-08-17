// Table: reliability signals per agent that the 9 headline metrics don't surface on their own —
// error rate, how often a case hit the iteration limit, and how often a case's real peak context
// exceeded its agent's configured/simulated context window, from every SuiteRunRecord's `results`
// in `data`. A low pass rate is a symptom; this is often the cause. See ../README.md. The
// context-window-exceeded rate is independent of AgentConfig.ContextManagementStrategy — it
// warns even when no strategy is enabled to do anything about it (see
// QuestionRunResult.ContextWindowExceeded).
export const layout = "full";
export default function (container, data, { d3 }) {
  const cases = data.flatMap((r) => r.results ?? []);
  if (cases.length === 0) {
    container.textContent = "No per-question data for the selected runs.";
    return;
  }

  const byAgent = new Map();
  for (const c of cases) {
    if (!byAgent.has(c.agentId)) byAgent.set(c.agentId, []);
    byAgent.get(c.agentId).push(c);
  }

  const rows = [...byAgent.entries()]
    .map(([agentId, agentCases]) => {
      const total = agentCases.length;
      const errors = agentCases.filter((c) => c.error).length;
      const hitLimit = agentCases.filter((c) => c.hitIterationLimit).length;
      const exceededContext = agentCases.filter((c) => c.contextWindowExceeded).length;
      const avgIterations = agentCases.reduce((sum, c) => sum + c.iterations, 0) / total;
      return { agentId, total, errors, hitLimit, exceededContext, avgIterations };
    })
    .sort((a, b) => a.agentId.localeCompare(b.agentId));

  const columns = [
    ["Agent", (r) => r.agentId],
    ["Cases", (r) => r.total],
    ["Errors", (r) => r.errors],
    ["Error rate", (r) => `${Math.round((r.errors / r.total) * 100)}%`],
    ["Hit iteration limit", (r) => r.hitLimit],
    ["Hit-limit rate", (r) => `${Math.round((r.hitLimit / r.total) * 100)}%`],
    ["Context window exceeded", (r) => r.exceededContext],
    ["Context-exceeded rate", (r) => `${Math.round((r.exceededContext / r.total) * 100)}%`],
    ["Avg iterations", (r) => r.avgIterations.toFixed(1)],
  ];

  const table = d3.select(container).append("table");

  table
    .append("thead")
    .append("tr")
    .selectAll("th")
    .data(columns)
    .join("th")
    .text(([label]) => label);

  table
    .append("tbody")
    .selectAll("tr")
    .data(rows)
    .join("tr")
    .selectAll("td")
    .data((row) => columns.map(([, get]) => get(row)))
    .join("td")
    .text((value) => value);
}
