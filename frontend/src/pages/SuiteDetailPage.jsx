import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { api } from "../api.js";
import { NotFound } from "../components/NotFound.jsx";

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

  // versionsByAgent: agentId -> [{version, cutAt}, ...] newest-first (as returned by the API).
  // selections: the run-start picker's checked state, one entry per checked (agentId, version)
  // pair — version: null means "current (live)". Posted to POST /api/maverik/runs as-is.
  const [versionsByAgent, setVersionsByAgent] = useState({});
  const [versionsLoading, setVersionsLoading] = useState(true);
  const [selections, setSelections] = useState([]);
  const [repetitions, setRepetitions] = useState(1);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);

  useEffect(() => {
    setSuite(null);
    setVersionsLoading(true);
    Promise.all([api.getSuite(suiteId), api.listAgents()])
      .then(async ([suiteData, agentsData]) => {
        setSuite(suiteData);
        setAgentsById(Object.fromEntries(agentsData.agents.map((a) => [a.id, a])));

        // A suite agent that fails this lookup (e.g. deleted since) just gets treated as having
        // no cut versions, rather than breaking the whole picker.
        const versionLists = await Promise.all(
          suiteData.agents.map((id) => api.listAgentVersions(id).catch(() => []))
        );
        const versionsMap = Object.fromEntries(suiteData.agents.map((id, i) => [id, versionLists[i]]));
        setVersionsByAgent(versionsMap);

        // Default selection: an agent with no cut versions pre-checks "Current" only (identical
        // to pre-versioning behavior). An agent with >=1 cut version pre-checks its 3 most recent
        // cut versions instead (versionsMap is already newest-first from the API).
        setSelections(
          suiteData.agents.flatMap((id) => {
            const versions = versionsMap[id] || [];
            return versions.length === 0
              ? [{ agentId: id, version: null }]
              : versions.slice(0, 3).map((v) => ({ agentId: id, version: v.version }));
          })
        );
        setVersionsLoading(false);
      })
      .catch(setError);
  }, [suiteId]);

  if (error?.status === 404) return <NotFound message={`No suite '${suiteId}'.`} />;
  if (error) return <p className="error-text">Failed to load suite: {error.message}</p>;
  if (!suite) return <p className="muted">Loading…</p>;

  function isSelected(agentId, version) {
    return selections.some((s) => s.agentId === agentId && s.version === version);
  }

  function toggleSelection(agentId, version) {
    setSelections((prev) =>
      prev.some((s) => s.agentId === agentId && s.version === version)
        ? prev.filter((s) => !(s.agentId === agentId && s.version === version))
        : [...prev, { agentId, version }]
    );
  }

  async function startRun() {
    setStarting(true);
    setStartError(null);
    try {
      const { runId } = await api.startRun({
        suiteId: suite.id,
        agentSelections: selections,
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
        {versionsLoading && <p className="muted">Loading agent versions…</p>}
        <div className="agent-selection-groups">
          {suite.agents.map((agentId) => {
            const versions = versionsByAgent[agentId] || [];
            return (
              <div className="agent-selection-group" key={agentId}>
                <div className="agent-selection-group-name">{agentsById[agentId]?.name || agentId}</div>
                <div className="checkbox-list">
                  <label>
                    <input
                      type="checkbox"
                      checked={isSelected(agentId, null)}
                      onChange={() => toggleSelection(agentId, null)}
                    />
                    Current (live)
                  </label>
                  {versions.map((v) => (
                    <label key={v.version}>
                      <input
                        type="checkbox"
                        checked={isSelected(agentId, v.version)}
                        onChange={() => toggleSelection(agentId, v.version)}
                      />
                      v{v.version} <span className="muted">({new Date(v.cutAt).toLocaleDateString()})</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
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
            disabled={starting || versionsLoading || selections.length === 0}
          >
            {starting ? "Starting…" : "Start run"}
          </button>
        </p>
        {startError && <p className="error-text">{startError}</p>}
      </div>
    </div>
  );
}
