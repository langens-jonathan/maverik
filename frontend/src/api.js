const API_BASE = import.meta.env.VITE_API_BASE_URL;

async function request(path, options) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error || `${res.status} ${res.statusText}`);
    err.status = res.status; // lets callers distinguish "doesn't exist" (404) from other failures
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

// For the raw JS source of a visualization (see VisualizationRenderer) — not JSON.
async function requestText(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
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
  getToolCostsConfig: () => request("/api/config/tool-costs"),
  saveToolCostsConfig: (data) =>
    request("/api/config/tool-costs", { method: "PUT", body: JSON.stringify(data) }),

  getDevMode: () => request("/api/dev-mode"),
  setDevMode: (enabled) => request("/api/dev-mode", { method: "POST", body: JSON.stringify({ enabled }) }),

  listSuiteRuns: ({ suiteIds, from, to } = {}) => {
    const params = new URLSearchParams();
    (suiteIds ?? []).forEach((id) => params.append("suiteIds", id));
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return request(`/api/maverik/suite-runs${qs ? `?${qs}` : ""}`);
  },

  listVisualizations: () => request("/api/reporting/visualizations"),
  getVisualization: (id) => requestText(`/api/reporting/visualizations/${encodeURIComponent(id)}`),

  listDashboards: () => request("/api/reporting/dashboards"),
  getDashboard: (id) => request(`/api/reporting/dashboards/${encodeURIComponent(id)}`),
  createDashboard: (data) =>
    request("/api/reporting/dashboards", { method: "POST", body: JSON.stringify(data) }),
  updateDashboard: (id, data) =>
    request(`/api/reporting/dashboards/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteDashboard: (id) =>
    request(`/api/reporting/dashboards/${encodeURIComponent(id)}`, { method: "DELETE" }),

  listReports: () => request("/api/reporting/reports"),
  getReport: (id) => request(`/api/reporting/reports/${encodeURIComponent(id)}`),
  createReport: (data) =>
    request("/api/reporting/reports", { method: "POST", body: JSON.stringify(data) }),
  updateReport: (id, data) =>
    request(`/api/reporting/reports/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteReport: (id) =>
    request(`/api/reporting/reports/${encodeURIComponent(id)}`, { method: "DELETE" }),

  createSuite: (data) => request("/api/maverik/suites", { method: "POST", body: JSON.stringify(data) }),
  updateSuite: (suiteId, data) =>
    request(`/api/maverik/suites/${encodeURIComponent(suiteId)}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteSuite: (suiteId) =>
    request(`/api/maverik/suites/${encodeURIComponent(suiteId)}`, { method: "DELETE" }),
};
