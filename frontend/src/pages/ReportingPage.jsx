import { NavLink, Outlet } from "react-router-dom";

const TABS = [
  { to: "/reporting/reports", label: "Reports" },
  { to: "/reporting/dashboards", label: "Dashboards" },
  { to: "/reporting/visualizations", label: "Visualizations" },
];

export function ReportingPage() {
  return (
    <div>
      <h2>Reporting</h2>
      <nav className="subnav">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? "active" : "")}>
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
