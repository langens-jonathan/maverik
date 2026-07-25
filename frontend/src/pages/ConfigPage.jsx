import { NavLink, Outlet } from "react-router-dom";

const TABS = [
  { to: "/config/agents", label: "Agents" },
  { to: "/config/llm-models", label: "LLM Models" },
  { to: "/config/mcp-servers", label: "MCP Servers" },
  { to: "/config/prompts", label: "Prompts" },
];

export function ConfigPage() {
  return (
    <div>
      <h2>Configuration</h2>
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
