const API_BASE = import.meta.env.VITE_API_BASE_URL;

async function request(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `${res.status} ${res.statusText}`);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  listSuites: () => request("/api/maverik/suites"),
  getSuite: (suiteId) => request(`/api/maverik/suites/${encodeURIComponent(suiteId)}`),
  listAgents: () => request("/api/agents"),
  startRun: (body) =>
    request("/api/maverik/runs", { method: "POST", body: JSON.stringify(body) }),
  listRuns: () => request("/api/maverik/runs"),
  getRun: (runId) => request(`/api/maverik/runs/${encodeURIComponent(runId)}`),
  getRunSummary: (runId) => request(`/api/maverik/runs/${encodeURIComponent(runId)}/summary`),

  getAgentsConfig: () => request("/api/config/agents"),
  saveAgentsConfig: (data) =>
    request("/api/config/agents", { method: "PUT", body: JSON.stringify(data) }),
  getLlmModelsConfig: () => request("/api/config/llm-models"),
  saveLlmModelsConfig: (data) =>
    request("/api/config/llm-models", { method: "PUT", body: JSON.stringify(data) }),
  getMcpServersConfig: () => request("/api/config/mcp-servers"),
  saveMcpServersConfig: (data) =>
    request("/api/config/mcp-servers", { method: "PUT", body: JSON.stringify(data) }),
  getPrompt: (agentId) => request(`/api/config/prompts/${encodeURIComponent(agentId)}`),
  savePrompt: (agentId, content) =>
    request(`/api/config/prompts/${encodeURIComponent(agentId)}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
};
