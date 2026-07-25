import { NavLink, Outlet } from "react-router-dom";

export default function App() {
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
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
