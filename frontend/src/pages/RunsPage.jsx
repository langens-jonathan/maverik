import { Link } from "react-router-dom";
import { api } from "../api.js";
import { usePolling } from "../hooks/usePolling.js";

export function RunsPage() {
  const { data: runs, error, loading } = usePolling(() => api.listRuns(), 2000, true);

  return (
    <div>
      <h2>Runs</h2>
      {error && <p className="error-text">Failed to load runs: {error.message}</p>}
      {loading && <p className="muted">Loading…</p>}
      {runs && runs.length === 0 && <p className="muted">No runs yet — start one from a test plan.</p>}
      {runs && runs.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Suite</th>
              <th>State</th>
              <th>Progress</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.runId}>
                <td className="mono">
                  <Link to={`/runs/${encodeURIComponent(r.runId)}`}>{r.runId}</Link>
                </td>
                <td className="mono">{r.suiteId}</td>
                <td>
                  <span className={`badge state-${r.state}`}>{r.state}</span>
                </td>
                <td>
                  {r.completedCases}/{r.totalCases}
                </td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
