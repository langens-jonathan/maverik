// Cross-navigation URL builders shared between CompareVersionsPage.jsx (a real React component,
// can use react-router's <Link>) and the chart modules below it (plain d3/vanilla, wrapping marks
// in a raw SVG <a> instead — see docs/chart-design-system.md's cross-navigation note). Kept as
// one small framework-agnostic module so both sides build the exact same URL shape rather than
// two copies drifting apart.
//
// All three targets are landing pages this dashboard doesn't own: AgentsConfigPage.jsx (agent
// config, optionally a specific cut version's History entry), RunDetailPage.jsx (a run, with a
// specific case highlighted), McpServersConfigPage.jsx (an agent's configured server set).

// #<agentId> or #<agentId>@<version> — see AgentsConfigPage.jsx's parseAgentHash for the reader
// side. version === null/undefined means "just the agent row," no History auto-open.
export function agentConfigHref(agentId, version) {
  const hash = version != null ? `${encodeURIComponent(agentId)}@${version}` : encodeURIComponent(agentId);
  return `/config/agents#${hash}`;
}

// A regression-matrix cell -> the run it came from, with enough to highlight every matching case
// row (a cell aggregates across repetitions, so this can match more than one row — see
// RunDetailPage.jsx). version is passed through as the literal string "null" when absent (not
// omitted) so the reader side can tell "explicitly live/current" apart from "param missing
// entirely" without ambiguity.
export function runCaseHref(sourceRunId, agentId, version, questionId) {
  const params = new URLSearchParams({
    agent: agentId,
    version: version != null ? String(version) : "null",
    question: questionId,
  });
  return `/runs/${encodeURIComponent(sourceRunId)}?${params.toString()}`;
}

// An agent's whole configured MCP server set, comma-joined — McpServersConfigPage.jsx never
// fetches agents.json, so the names travel in the URL directly rather than an agentId lookup. Not
// per-tool: QuestionRunResult.ToolNames never recorded which server owned a call (see
// toolUsageFlow.js's own header comment), so this can only honestly point at "the agent's server
// set," not the one server that owns a specific tool.
export function mcpServersHref(serverNames) {
  const params = new URLSearchParams({ servers: (serverNames ?? []).join(",") });
  return `/config/mcp-servers?${params.toString()}`;
}
