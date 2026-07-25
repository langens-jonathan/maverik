import { NavLink, Outlet, useLocation } from "react-router-dom";
import { THEMES, useTheme } from "./hooks/useTheme.js";

// Mirrors the current route as "section / id" — MAVERIK's routes are never more than two
// segments deep (/suites/:id, /runs/:id), so this doesn't need to handle more than that.
function Crumb() {
  const { pathname } = useLocation();
  const [section, id] = pathname.split("/").filter(Boolean);
  if (!section) return null;
  return (
    <div className="crumb">
      {section}
      {id && (
        <>
          {" / "}
          <b>{decodeURIComponent(id)}</b>
        </>
      )}
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useTheme();

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
          <NavLink to="/config" className={({ isActive }) => (isActive ? "active" : "")}>
            Config
          </NavLink>
        </nav>
        <div className="header-right">
          <Crumb />
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
      <main>
        <Outlet />
      </main>
    </>
  );
}
