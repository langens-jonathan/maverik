import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { THEMES, useTheme } from "./hooks/useTheme.js";
import { api } from "./api.js";

// Mirrors the current route as "section / rest / of / path" — handles any depth, since Reporting
// routes (e.g. /reporting/reports/:id/configure) go deeper than the two-segment /suites/:id,
// /runs/:id routes this originally covered.
function Crumb() {
  const { pathname } = useLocation();
  const [section, ...rest] = pathname.split("/").filter(Boolean);
  if (!section) return null;
  return (
    <div className="crumb">
      {section}
      {rest.map((segment, i) => (
        <span key={i}>
          {" / "}
          <b>{decodeURIComponent(segment)}</b>
        </span>
      ))}
    </div>
  );
}

// On/off switch for wire-level LLM logging (see README's "Dev mode" section). Off by default;
// flipping it takes effect immediately, no restart — but only for calls made from that point
// on, so a MAVERIK run already in progress ends up with an incomplete log.
function DevModeToggle() {
  const [enabled, setEnabled] = useState(null); // null = not loaded yet
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api
      .getDevMode()
      .then((res) => setEnabled(res.enabled))
      .catch(() => setEnabled(false));
  }, []);

  async function toggle() {
    if (enabled === null || pending) return;
    setPending(true);
    try {
      const res = await api.setDevMode(!enabled);
      setEnabled(res.enabled);
    } catch {
      // leave the displayed state as-is; the user can retry
    } finally {
      setPending(false);
    }
  }

  if (enabled === null) return null;

  return (
    <button
      className={`dev-mode-toggle secondary${enabled ? " active" : ""}`}
      onClick={toggle}
      disabled={pending}
      title="When on, every LLM request/response (chat and MAVERIK runs) is written to logs/ on disk."
    >
      Dev mode: {enabled ? "On" : "Off"}
    </button>
  );
}

// The report "Open" screen (/reporting/reports/:id, not .../configure or .../new) is the one
// page that wants more than the standard 900px column — it lays visualizations out two-per-row.
// Every other page keeps the narrower width main normally gets.
function useIsReportView() {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);
  return segments[0] === "reporting" && segments[1] === "reports" && segments.length === 3 && segments[2] !== "new";
}

export default function App() {
  const [theme, setTheme] = useTheme();
  const isReportView = useIsReportView();

  return (
    <>
      <header className="app-header">
        <h1>MAVERIK</h1>
        <nav>
          <NavLink to="/suites" className={({ isActive }) => (isActive ? "active" : "")}>
            Test plans
          </NavLink>
          <NavLink to="/runs" className={({ isActive }) => (isActive ? "active" : "")}>
            Runs
          </NavLink>
          <NavLink to="/chat" className={({ isActive }) => (isActive ? "active" : "")}>
            Chat
          </NavLink>
          <NavLink to="/reporting" className={({ isActive }) => (isActive ? "active" : "")}>
            Reporting
          </NavLink>
          <NavLink to="/config" className={({ isActive }) => (isActive ? "active" : "")}>
            Config
          </NavLink>
        </nav>
        <div className="header-right">
          <Crumb />
          <DevModeToggle />
          <select
            className="theme-select"
            aria-label="Theme"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
          >
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </header>
      <main className={isReportView ? "wide" : undefined}>
        <Outlet />
      </main>
    </>
  );
}
