import { useEffect, useState } from "react";
import { api } from "../api.js";
import { SaveNotice } from "../components/SaveNotice.jsx";

function newKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `k${Date.now()}${Math.random()}`;
}

function emptySuite() {
  return {
    _key: newKey(),
    _isNew: true,
    id: "",
    name: "",
    description: "",
    agents: [],
    judgeModel: null,
    userSimulatorModel: null,
    questions: [],
  };
}

function emptyQuestion() {
  return {
    id: "",
    text: "",
    criterion: { type: "exact", expected: "", caseSensitive: false, pattern: null, rubric: null, judgeModel: null },
    multiturn: false,
    userTurnMode: null,
    scriptedUserTurns: null,
    userContext: null,
    maxUserTurns: null,
  };
}

function CriterionEditor({ criterion, modelIds, onChange }) {
  return (
    <div>
      <label>Criterion type</label>
      <select value={criterion.type} onChange={(e) => onChange({ type: e.target.value })}>
        <option value="exact">exact</option>
        <option value="contains">contains</option>
        <option value="regex">regex</option>
        <option value="llm-judge">llm-judge</option>
      </select>

      {(criterion.type === "exact" || criterion.type === "contains") && (
        <>
          <label>Expected</label>
          <input
            type="text"
            value={criterion.expected ?? ""}
            onChange={(e) => onChange({ expected: e.target.value })}
          />
          <div className="checkbox-list">
            <label>
              <input
                type="checkbox"
                checked={criterion.caseSensitive ?? false}
                onChange={(e) => onChange({ caseSensitive: e.target.checked })}
              />
              Case-sensitive
            </label>
          </div>
        </>
      )}

      {criterion.type === "regex" && (
        <>
          <label>Pattern</label>
          <input
            type="text"
            className="mono"
            value={criterion.pattern ?? ""}
            onChange={(e) => onChange({ pattern: e.target.value })}
          />
        </>
      )}

      {criterion.type === "llm-judge" && (
        <>
          <label>Rubric</label>
          <textarea rows={3} value={criterion.rubric ?? ""} onChange={(e) => onChange({ rubric: e.target.value })} />
          <label>Judge model override (optional)</label>
          <select value={criterion.judgeModel ?? ""} onChange={(e) => onChange({ judgeModel: e.target.value || null })}>
            <option value="">— use suite default —</option>
            {modelIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

// Multiturn keeps the conversation going past the first exchange — "scripted" sends a fixed
// ordered list of follow-ups regardless of what the agent says (deterministic, no extra cost);
// "simulated" uses the suite's userSimulatorModel to react to the agent's actual response. See
// MaverikQuestion in MaverikSuiteConfig.cs / CLAUDE.md's "Multi-turn conversations" section.
function MultiturnEditor({ question, onChange }) {
  const turns = question.scriptedUserTurns ?? [];

  function updateTurn(i, text) {
    onChange({ scriptedUserTurns: turns.map((t, idx) => (idx === i ? text : t)) });
  }
  function addTurn() {
    onChange({ scriptedUserTurns: [...turns, ""] });
  }
  function removeTurn(i) {
    onChange({ scriptedUserTurns: turns.filter((_, idx) => idx !== i) });
  }

  return (
    <div>
      <div className="checkbox-list">
        <label>
          <input
            type="checkbox"
            checked={question.multiturn ?? false}
            onChange={(e) =>
              onChange({
                multiturn: e.target.checked,
                userTurnMode: e.target.checked ? question.userTurnMode ?? "scripted" : null,
              })
            }
          />
          Multi-turn conversation
        </label>
      </div>

      {question.multiturn && (
        <>
          <div className="field-row">
            <div>
              <label>Mode</label>
              <select value={question.userTurnMode ?? "scripted"} onChange={(e) => onChange({ userTurnMode: e.target.value })}>
                <option value="scripted">Scripted</option>
                <option value="simulated">Simulated</option>
              </select>
            </div>
            <div>
              <label>Max user turns</label>
              <input
                type="number"
                step="1"
                value={question.maxUserTurns ?? ""}
                onChange={(e) => onChange({ maxUserTurns: e.target.value === "" ? null : Number(e.target.value) })}
                placeholder="default 4"
              />
            </div>
          </div>

          {question.userTurnMode === "simulated" && (
            <>
              <label>User context (optional)</label>
              <textarea
                rows={2}
                value={question.userContext ?? ""}
                onChange={(e) => onChange({ userContext: e.target.value === "" ? null : e.target.value })}
                placeholder="Extra background only the simulated user knows, e.g. which repo/account it's asking about."
              />
            </>
          )}

          {(question.userTurnMode ?? "scripted") === "scripted" && (
            <>
              <label>Scripted follow-ups (sent in order)</label>
              {turns.map((t, i) => (
                <div className="field-row" key={i}>
                  <textarea rows={1} value={t} onChange={(e) => updateTurn(i, e.target.value)} style={{ flex: 1 }} />
                  <button className="secondary" onClick={() => removeTurn(i)}>
                    Remove
                  </button>
                </div>
              ))}
              <button className="secondary add-row-btn" onClick={addTurn}>
                + Add turn
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function SuitesConfigPage() {
  const [suites, setSuites] = useState(null);
  const [agentIds, setAgentIds] = useState([]);
  const [modelIds, setModelIds] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [saveStates, setSaveStates] = useState({});

  useEffect(() => {
    Promise.all([api.listSuites(), api.getAgentsConfig(), api.getLlmModelsConfig()])
      .then(async ([summaries, agentsRes, modelsRes]) => {
        const full = await Promise.all(summaries.map((s) => api.getSuite(s.id)));
        setSuites(full.map((s) => ({ ...s, _key: s.id, _isNew: false })));
        setAgentIds(agentsRes.data.agents.map((a) => a.id));
        setModelIds(modelsRes.data.models.map((m) => m.id));
      })
      .catch((err) => setLoadError(err.message));
  }, []);

  function setSaveState(key, patch) {
    setSaveStates((s) => ({ ...s, [key]: { ...s[key], ...patch } }));
  }

  function updateSuite(key, patch) {
    setSuites((list) => list.map((s) => (s._key === key ? { ...s, ...patch } : s)));
  }

  function updateQuestion(key, qIndex, patch) {
    setSuites((list) =>
      list.map((s) =>
        s._key !== key ? s : { ...s, questions: s.questions.map((q, i) => (i === qIndex ? { ...q, ...patch } : q)) }
      )
    );
  }

  function updateCriterion(key, qIndex, patch) {
    setSuites((list) =>
      list.map((s) =>
        s._key !== key
          ? s
          : {
              ...s,
              questions: s.questions.map((q, i) =>
                i === qIndex ? { ...q, criterion: { ...q.criterion, ...patch } } : q
              ),
            }
      )
    );
  }

  function addQuestion(key) {
    setSuites((list) => list.map((s) => (s._key === key ? { ...s, questions: [...s.questions, emptyQuestion()] } : s)));
  }

  function removeQuestion(key, qIndex) {
    setSuites((list) =>
      list.map((s) => (s._key === key ? { ...s, questions: s.questions.filter((_, i) => i !== qIndex) } : s))
    );
  }

  function toggleSuiteAgent(key, agentId, checked) {
    setSuites((list) =>
      list.map((s) =>
        s._key === key
          ? { ...s, agents: checked ? [...s.agents, agentId] : s.agents.filter((a) => a !== agentId) }
          : s
      )
    );
  }

  function addSuite() {
    setSuites((list) => [...list, emptySuite()]);
  }

  async function saveSuite(key) {
    const suite = suites.find((s) => s._key === key);
    setSaveState(key, { saving: true, saveError: null, result: null });
    try {
      const payload = {
        id: suite.id,
        name: suite.name,
        description: suite.description,
        agents: suite.agents,
        judgeModel: suite.judgeModel || null,
        userSimulatorModel: suite.userSimulatorModel || null,
        questions: suite.questions,
      };
      const res = suite._isNew ? await api.createSuite(payload) : await api.updateSuite(suite.id, payload);
      setSaveState(key, { saving: false, result: res });
      if (suite._isNew) updateSuite(key, { _isNew: false });
    } catch (err) {
      setSaveState(key, { saving: false, saveError: err.message });
    }
  }

  async function deleteSuite(key) {
    const suite = suites.find((s) => s._key === key);
    if (suite._isNew) {
      setSuites((list) => list.filter((s) => s._key !== key));
      return;
    }
    if (!confirm(`Delete suite '${suite.id}'? This cannot be undone.`)) return;
    setSaveState(key, { saving: true, saveError: null, result: null });
    try {
      await api.deleteSuite(suite.id);
      setSuites((list) => list.filter((s) => s._key !== key));
    } catch (err) {
      setSaveState(key, { saving: false, saveError: err.message });
    }
  }

  if (loadError) return <p className="error-text">Failed to load suites: {loadError}</p>;
  if (!suites) return <p className="muted">Loading…</p>;

  return (
    <div>
      <p className="field-hint" style={{ marginBottom: "1rem" }}>
        Each suite saves independently — id becomes the filename (config/maverik-suites/&lt;id&gt;.json)
        and can't be changed after creation.
      </p>

      {suites.map((suite) => {
        const state = saveStates[suite._key] ?? {};
        return (
          <div className="config-row" key={suite._key}>
            <div className="config-row-header">
              <h4>{suite.name || suite.id || "new suite"}</h4>
              <button className="secondary" onClick={() => deleteSuite(suite._key)}>
                Delete
              </button>
            </div>

            <div className="field-row">
              <div>
                <label>Id</label>
                <input
                  type="text"
                  value={suite.id}
                  disabled={!suite._isNew}
                  onChange={(e) => updateSuite(suite._key, { id: e.target.value })}
                />
              </div>
              <div>
                <label>Name</label>
                <input
                  type="text"
                  value={suite.name}
                  onChange={(e) => updateSuite(suite._key, { name: e.target.value })}
                />
              </div>
            </div>

            <label>Description</label>
            <input
              type="text"
              value={suite.description}
              onChange={(e) => updateSuite(suite._key, { description: e.target.value })}
            />

            <label>Default agents</label>
            <div className="checkbox-list">
              {agentIds.map((id) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={suite.agents.includes(id)}
                    onChange={(e) => toggleSuiteAgent(suite._key, id, e.target.checked)}
                  />
                  {id}
                </label>
              ))}
            </div>

            <div className="field-row">
              <div>
                <label>Judge model (default for llm-judge criteria)</label>
                <select
                  value={suite.judgeModel ?? ""}
                  onChange={(e) => updateSuite(suite._key, { judgeModel: e.target.value || null })}
                >
                  <option value="">— none —</option>
                  {modelIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label>User simulator model (default for multiturn "simulated" questions)</label>
                <select
                  value={suite.userSimulatorModel ?? ""}
                  onChange={(e) => updateSuite(suite._key, { userSimulatorModel: e.target.value || null })}
                >
                  <option value="">— none —</option>
                  {modelIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label style={{ marginTop: "1rem" }}>Questions ({suite.questions.length})</label>
            {suite.questions.map((q, qi) => (
              <div className="config-row" key={qi}>
                <div className="config-row-header">
                  <h4 className="mono">{q.id || `question ${qi + 1}`}</h4>
                  <button className="secondary" onClick={() => removeQuestion(suite._key, qi)}>
                    Remove
                  </button>
                </div>
                <label>Id</label>
                <input
                  type="text"
                  value={q.id}
                  onChange={(e) => updateQuestion(suite._key, qi, { id: e.target.value })}
                />
                <label>Text</label>
                <textarea
                  rows={2}
                  value={q.text}
                  onChange={(e) => updateQuestion(suite._key, qi, { text: e.target.value })}
                />
                <CriterionEditor
                  criterion={q.criterion}
                  modelIds={modelIds}
                  onChange={(patch) => updateCriterion(suite._key, qi, patch)}
                />
                <MultiturnEditor question={q} onChange={(patch) => updateQuestion(suite._key, qi, patch)} />
              </div>
            ))}
            <button className="secondary add-row-btn" onClick={() => addQuestion(suite._key)}>
              + Add question
            </button>

            <SaveNotice
              bootstrapped={false}
              result={state.result}
              onDismissResult={() => setSaveState(suite._key, { result: null })}
            />
            {state.saveError && <p className="error-text">{state.saveError}</p>}

            <div className="config-toolbar">
              <div className="spacer" />
              <button onClick={() => saveSuite(suite._key)} disabled={state.saving}>
                {state.saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        );
      })}

      <div className="config-toolbar">
        <button className="secondary add-row-btn" onClick={addSuite}>
          + Add suite
        </button>
      </div>
    </div>
  );
}
