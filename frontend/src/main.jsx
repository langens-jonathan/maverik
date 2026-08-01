import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App.jsx";
import { SuitesPage } from "./pages/SuitesPage.jsx";
import { SuiteDetailPage } from "./pages/SuiteDetailPage.jsx";
import { RunsPage } from "./pages/RunsPage.jsx";
import { RunDetailPage } from "./pages/RunDetailPage.jsx";
import { ChatPage } from "./pages/ChatPage.jsx";
import { ConfigPage } from "./pages/ConfigPage.jsx";
import { AgentsConfigPage } from "./pages/AgentsConfigPage.jsx";
import { LlmModelsConfigPage } from "./pages/LlmModelsConfigPage.jsx";
import { McpServersConfigPage } from "./pages/McpServersConfigPage.jsx";
import { ToolCostsConfigPage } from "./pages/ToolCostsConfigPage.jsx";
import { SuitesConfigPage } from "./pages/SuitesConfigPage.jsx";
import { PromptsConfigPage } from "./pages/PromptsConfigPage.jsx";
import { ReportingPage } from "./pages/ReportingPage.jsx";
import { VisualizationsPage } from "./pages/VisualizationsPage.jsx";
import { DashboardsPage } from "./pages/DashboardsPage.jsx";
import { ReportsListPage } from "./pages/ReportsListPage.jsx";
import { ReportConfigurePage } from "./pages/ReportConfigurePage.jsx";
import { ReportViewPage } from "./pages/ReportViewPage.jsx";
import { CompareVersionsPage } from "./pages/CompareVersionsPage.jsx";
import { NotFound } from "./components/NotFound.jsx";
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
          <Route path="chat" element={<ChatPage />} />
          <Route path="config" element={<ConfigPage />}>
            <Route index element={<Navigate to="/config/agents" replace />} />
            <Route path="agents" element={<AgentsConfigPage />} />
            <Route path="llm-models" element={<LlmModelsConfigPage />} />
            <Route path="mcp-servers" element={<McpServersConfigPage />} />
            <Route path="tool-costs" element={<ToolCostsConfigPage />} />
            <Route path="suites" element={<SuitesConfigPage />} />
            <Route path="prompts" element={<PromptsConfigPage />} />
          </Route>
          <Route path="reporting" element={<ReportingPage />}>
            <Route index element={<Navigate to="/reporting/reports" replace />} />
            <Route path="reports" element={<ReportsListPage />} />
            <Route path="reports/new" element={<ReportConfigurePage />} />
            <Route path="reports/:id" element={<ReportViewPage />} />
            <Route path="reports/:id/configure" element={<ReportConfigurePage />} />
            <Route path="dashboards" element={<DashboardsPage />} />
            <Route path="visualizations" element={<VisualizationsPage />} />
            <Route path="compare" element={<CompareVersionsPage />} />
          </Route>
          <Route path="*" element={<NotFound message="Page not found." />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
