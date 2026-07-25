import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App.jsx";
import { SuitesPage } from "./pages/SuitesPage.jsx";
import { SuiteDetailPage } from "./pages/SuiteDetailPage.jsx";
import { RunsPage } from "./pages/RunsPage.jsx";
import { RunDetailPage } from "./pages/RunDetailPage.jsx";
import { ConfigPage } from "./pages/ConfigPage.jsx";
import { AgentsConfigPage } from "./pages/AgentsConfigPage.jsx";
import { LlmModelsConfigPage } from "./pages/LlmModelsConfigPage.jsx";
import { McpServersConfigPage } from "./pages/McpServersConfigPage.jsx";
import { ToolCostsConfigPage } from "./pages/ToolCostsConfigPage.jsx";
import { PromptsConfigPage } from "./pages/PromptsConfigPage.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Navigate to="/suites" replace />} />
          <Route path="suites" element={<SuitesPage />} />
          <Route path="suites/:suiteId" element={<SuiteDetailPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="runs/:runId" element={<RunDetailPage />} />
          <Route path="config" element={<ConfigPage />}>
            <Route index element={<Navigate to="/config/agents" replace />} />
            <Route path="agents" element={<AgentsConfigPage />} />
            <Route path="llm-models" element={<LlmModelsConfigPage />} />
            <Route path="mcp-servers" element={<McpServersConfigPage />} />
            <Route path="tool-costs" element={<ToolCostsConfigPage />} />
            <Route path="prompts" element={<PromptsConfigPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
