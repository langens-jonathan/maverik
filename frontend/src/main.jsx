import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import App from "./App.jsx";
import { SuitesPage } from "./pages/SuitesPage.jsx";
import { SuiteDetailPage } from "./pages/SuiteDetailPage.jsx";
import { RunsPage } from "./pages/RunsPage.jsx";
import { RunDetailPage } from "./pages/RunDetailPage.jsx";
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
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
