import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

export function SuitesPage() {
  const [suites, setSuites] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listSuites().then(setSuites).catch(setError);
  }, []);

  if (error) return <p className="error-text">Failed to load suites: {error.message}</p>;
  if (!suites) return <p className="muted">Loading…</p>;
  if (suites.length === 0) return <p className="muted">No test suites configured yet.</p>;

  return (
    <div>
      <h2>Test plans</h2>
      {suites.map((suite) => (
        <div className="card" key={suite.id}>
          <h3>
            <Link to={`/suites/${encodeURIComponent(suite.id)}`}>{suite.name}</Link>
          </h3>
          <p>{suite.description}</p>
          <p className="muted">
            {suite.questionCount} question{suite.questionCount === 1 ? "" : "s"} · default
            agents: {suite.agents.join(", ") || "none"}
            {suite.judgeModel ? ` · judge: ${suite.judgeModel}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}
