import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api } from "../api.js";

function describeCriterion(criterion) {
  switch (criterion.type) {
    case "exact":
    case "contains":
      return `${criterion.type === "exact" ? "equals" : "contains"} "${criterion.expected}"${
        criterion.caseSensitive ? " (case-sensitive)" : ""
      }`;
    case "regex":
      return `matches /${criterion.pattern}/`;
    case "llm-judge":
      return `judge: ${criterion.rubric}${
        criterion.judgeModel ? ` (model: ${criterion.judgeModel})` : ""
      }`;
    default:
      return criterion.type;
  }
}

export function SuiteDetailPage() {
  const { suiteId } = useParams();
  const navigate = useNavigate();

  const [suite, setSuite] = useState(null);
  const [agentsById, setAgentsById] = useState({});
  const [error, setError] = useState(null);

  const [selectedAgents, setSelectedAgents] = useState([]);
  const [repetitions, setRepetitions] = useState(1);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);

  useEffect(() => {
    setSuite(null);
    Promise.all([api.getSuite(suiteId), api.listAgents()])
      .then(([suiteData, agentsData]) => {
        setSuite(suiteData);
        setSelectedAgents(suiteData.agents);
        setAgentsById(Object.fromEntries(agentsData.agents.map((a) => [a.id, a])));
      })
      .catch(setError);
  }, [suiteId]);

  if (error) return <p className="error-text">Failed to load suite: {error.message}</p>;
  if (!suite) return <p className="muted">Loading…</p>;

  function toggleAgent(id) {
    setSelectedAgents((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  }

  async function startRun() {
    setStarting(true);
    setStartError(null);
    try {
      const { runId } = await api.startRun({
        suiteId: suite.id,
        agentIds: selectedAgents,
        repetitions: Number(repetitions),
      });
      navigate(`/runs/${encodeURIComponent(runId)}`);
    } catch (err) {
      setStartError(err.message);
      setStarting(false);
    }
  }

  return (
    <div>
      <p>
        <Link to="/suites">&larr; Test plans</Link>
      </p>
      <h2>{suite.name}</h2>
      <p>{suite.description}</p>

      <div className="card">
        <h3>Questions ({suite.questions.length})</h3>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Question</th>
              <th>Criterion</th>
            </tr>
          </thead>
          <tbody>
            {suite.questions.map((q) => (
              <tr key={q.id}>
                <td className="mono">{q.id}</td>
                <td>{q.text}</td>
                <td>
                  <span className="criterion-type">{q.criterion.type}</span>
                  <div className="muted">{describeCriterion(q.criterion)}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Run this suite</h3>
        <label>Agents</label>
        <div className="checkbox-list">
          {suite.agents.map((agentId) => (
            <label key={agentId}>
              <input
                type="checkbox"
                checked={selectedAgents.includes(agentId)}
                onChange={() => toggleAgent(agentId)}
              />
              {agentsById[agentId]?.name || agentId}
            </label>
          ))}
        </div>

        <label htmlFor="repetitions">Repetitions</label>
        <input
          id="repetitions"
          type="number"
          min="1"
          value={repetitions}
          onChange={(e) => setRepetitions(e.target.value)}
          style={{ width: "5rem" }}
        />

        <p>
          <button
            onClick={startRun}
            disabled={starting || selectedAgents.length === 0}
          >
            {starting ? "Starting…" : "Start run"}
          </button>
        </p>
        {startError && <p className="error-text">{startError}</p>}
      </div>
    </div>
  );
}
