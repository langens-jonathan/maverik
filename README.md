<div align="center">

```
███╗   ███╗ █████╗ ██╗   ██╗███████╗██████╗ ██╗██╗  ██╗
████╗ ████║██╔══██╗██║   ██║██╔════╝██╔══██╗██║██║ ██╔╝
██╔████╔██║███████║██║   ██║█████╗  ██████╔╝██║█████╔╝ 
██║╚██╔╝██║██╔══██║╚██╗ ██╔╝██╔══╝  ██╔══██╗██║██╔═██╗ 
██║ ╚═╝ ██║██║  ██║ ╚████╔╝ ███████╗██║  ██║██║██║  ██╗
╚═╝     ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝╚═╝  ╚═╝
```

**Benchmark, compare, and cost-predict your MCP agents.**

*Think JMeter — but for agents built on the Model Context Protocol.*

![.NET 9](https://img.shields.io/badge/.NET-9.0-512BD4)
![ASP.NET Core](https://img.shields.io/badge/ASP.NET%20Core-minimal%20API-blue)
![MCP](https://img.shields.io/badge/protocol-MCP-orange)
![Docker](https://img.shields.io/badge/docker-ready-2496ED)

[Quick start](#-quick-start) · [Define a suite](#-defining-a-test-suite) ·
[Run a benchmark](#-running-a-benchmark) · [Metrics](#-metrics) · [API](#-api-reference) ·
[Roadmap](#-roadmap)

</div>

---

## What is MAVERIK?

MAVERIK is a testing framework for **MCP agents**. You define *Agent Configurations* —
a system prompt, an LLM model, a set of MCP servers, a tool-loop strategy, and an iteration
cap — and *Test Suites* of questions with pass criteria. MAVERIK then fires every question
at every agent configuration and measures what actually matters:

| | |
| --- | --- |
| ⏱️ **Time** | wall-clock duration of the full agent turn, tools included |
| 🔢 **Tokens** | input & output tokens, summed across every LLM round-trip in the loop |
| ✅ **Correctness** | deterministic checks or LLM-as-judge (judge cost tracked separately) |
| 💰 **Cost** | estimated per-question and total cost from per-model pricing |

So instead of guessing, you can *measure* questions like:

- Does the new version of my system prompt answer better — or just cost more?
- Is Claude Haiku good enough for this scenario, or do I need Sonnet?
- Does running tool calls in parallel actually make my agent faster?
- What will 10,000 of these questions cost at customer X?

## ✨ Features

- **Agent configurations as data** — prompt, model, MCP servers, loop type, and iteration cap
  live in `agents.json`; comparing two agents is a config edit, not a code change.
- **Multi-provider model registry** — Anthropic and any OpenAI-compatible endpoint
  (OpenAI, Ollama, LM Studio, vLLM, …) side by side in `llm-models.json`.
- **Pluggable host-loop strategies** — `manual` (sequential tool calls) and `parallel-tools`
  (concurrent tool calls per turn) out of the box, behind a small `ILoopStrategy` seam.
- **Four criterion types** — `exact`, `contains`, `regex`, and `llm-judge` with a free-text
  rubric. Judge tokens are measured but **never** pollute the agent's metrics.
- **Repetitions** — run each case N times to see through LLM nondeterminism.
- **Results that persist** — every run writes `results/{runId}/run.json` + `summary.csv`,
  ready for Excel, pandas, or your BI tool of choice.
- **Cost prediction** — attach per-MTok pricing to models and get estimated cost per
  question, per agent, per run.
- **Interactive chat mode included** — poke at any agent configuration by hand through a
  simple polling chat API before you benchmark it.
- **Wire-level debug logging** — set `MCPHOST_LLM_DEBUG=1` and every raw LLM HTTP exchange
  (including judge traffic) is logged with timings and token counts.
- **Docker-first deployment** — one `docker compose up` with secrets mounted, never baked in.

## 🔭 How it works

```
                     ┌──────────────────────────────────────────────────────┐
 POST /api/maverik/runs ─► run queue ─► MaverikRunner                       │
                     │                     │  for each agent × question × N │
                     │                     ▼                                │
                     │               ILoopStrategy ◄──── agents.json        │
                     │             (manual / parallel)                      │
                     │                 │         │                          │
                     │       LLM models│         │MCP tool calls            │
                     │ (llm-models.json)         (mcp-servers.json)         │
                     │                     │                                │
                     │                     ▼                                │
                     │             CriterionEvaluator (exact/contains/      │
                     │                     │           regex/llm-judge)     │
                     │                     ▼                                │
 GET /api/maverik/runs/{id} ◄── run store + results/{runId}/ (json + csv)   │
                     └──────────────────────────────────────────────────────┘
```

Every question runs in **complete isolation**: a fresh conversation seeded with the agent's
system prompt, no shared history, no sessions. The runner executes cases **sequentially** so
timing numbers stay clean. And critically, the benchmark runner and the interactive chat mode
share the *same* loop code — what you measure is what you ship.

## 🚀 Quick start

### Prerequisites

- [.NET 9 SDK](https://dotnet.microsoft.com/download/dotnet/9.0) (or just Docker)
- At least one reachable MCP server (HTTP / streamable-HTTP transport)
- An API key for Anthropic and/or any OpenAI-compatible endpoint

### 1. Clone and configure

```powershell
git clone <this-repo>
cd MCPHost

# Models: copy the template and fill in your keys
cp llm-models.example.json llm-models.json

# MCP servers, agents, and a first test suite
# (see Configuration below for the schemas)
```

Secrets never go in config files — header values in `mcp-servers.json` support
`${ENV_VAR}` placeholders, and the Anthropic key falls back to `ANTHROPIC_API_KEY`.

### 2. Run locally

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
dotnet run
# → http://localhost:5088
```

### 3. …or run in Docker

```powershell
cp docker-compose.example.yml docker-compose.yml   # then adjust mounts/env to taste
docker compose up --build
# → http://localhost:5088
```

Config files are bind-mounted read-only; `results/` and `logs/` are mounted read-write so
your benchmark data survives the container. Remember that *inside* the container,
`localhost` is the container — MCP servers running on your host machine are reached via
`http://host.docker.internal:...`.

### 4. Fire your first benchmark

```bash
curl -X POST http://localhost:5088/api/maverik/runs \
     -H "Content-Type: application/json" \
     -d '{ "suiteId": "github-basics", "repetitions": 3 }'
# → { "runId": "github-basics-20260709-141502" }

curl http://localhost:5088/api/maverik/runs/github-basics-20260709-141502/summary
```

## ⚙️ Configuration

| File | What it defines |
| --- | --- |
| `llm-models.json` | LLM models across providers, plus optional per-MTok pricing. Gitignored (secrets); copy from `llm-models.example.json`. |
| `mcp-servers.json` | MCP servers (name, HTTP endpoint, headers with `${ENV_VAR}` expansion). Gitignored. |
| `agents.json` | The agent configurations under test. Gitignored. |
| `maverik-suites/*.json` | Test suites: questions, criteria, default agent set, judge model. |
| `prompts/agent/<id>.md` | An agent's system prompt, when not defined inline. |

### An agent configuration

```jsonc
{
  "id": "github-helper-v2",
  "name": "GitHub Helper (v2 prompt)",
  "description": "Tighter prompt; should reduce tool-call count.",
  "model": "claude-sonnet",           // an id from llm-models.json
  "loopType": "parallel-tools",       // "manual" (default) or "parallel-tools"
  "mcpServers": [ "github" ],         // names from mcp-servers.json — the agent only sees these tools
  "maxIterations": 8                  // cap on LLM round-trips per question
}
```

The system prompt is either inline (`"systemPrompt": "..."`) or in
`prompts/agent/github-helper-v2.md` — perfect for versioning prompt experiments in git.

### A model with pricing

```jsonc
{
  "id": "claude-sonnet",
  "provider": "anthropic",
  "model": "claude-sonnet-5",
  "inputPricePerMTok": 3.00,          // optional — enables cost estimation
  "outputPricePerMTok": 15.00
}
```

## 🧪 Defining a test suite

One file per suite in `maverik-suites/`:

```jsonc
{
  "id": "github-basics",
  "name": "GitHub basics",
  "description": "Sanity checks against the GitHub MCP server.",
  "agents": [ "github-helper", "github-helper-v2" ],   // default set; overridable per run
  "judgeModel": "claude-haiku",                        // used by llm-judge criteria
  "questions": [
    {
      "id": "default-branch",
      "text": "What is the default branch of repo X?",
      "criterion": { "type": "exact", "expected": "main", "caseSensitive": false }
    },
    {
      "id": "open-issues",
      "text": "How many open issues does repo X have?",
      "criterion": { "type": "regex", "pattern": "\\b12\\b" }
    },
    {
      "id": "release-summary",
      "text": "Summarize the latest release notes of repo X.",
      "criterion": {
        "type": "llm-judge",
        "rubric": "PASS if the answer mentions the 2.0 release and at least two of its features."
      }
    }
  ]
}
```

### Criterion types

| Type | Fields | Passes when… |
| --- | --- | --- |
| `exact` | `expected`, `caseSensitive?` | the trimmed final answer equals `expected` |
| `contains` | `expected`, `caseSensitive?` | the final answer contains `expected` |
| `regex` | `pattern` | the final answer matches `pattern` |
| `llm-judge` | `rubric`, `judgeModel?` | the judge model returns `PASS` against the rubric |

The judge runs on a fresh, tool-less conversation at temperature 0 and must answer in strict
JSON (`{"verdict": "PASS", "reasoning": "..."}`). Its token usage is recorded — but as
*testing overhead*, never as part of the agent's score.

Suites are validated at startup: unknown agent ids, unknown judge models, invalid regexes,
or missing criterion fields fail fast with a clear message.

## 🏁 Running a benchmark

```bash
# Start a run (agents defaults to the suite's list; repetitions defaults to 1)
POST /api/maverik/runs
{ "suiteId": "github-basics", "agentIds": ["github-helper", "github-helper-v2"], "repetitions": 3 }

# Poll progress + per-case results
GET /api/maverik/runs/{runId}

# The payoff: per-agent aggregates, side by side
GET /api/maverik/runs/{runId}/summary
```

A summary looks like:

```jsonc
{
  "runId": "github-basics-20260709-141502",
  "agents": [
    {
      "agentId": "github-helper",
      "passRate": 0.89,
      "avgDurationMs": 6420,
      "avgInputTokens": 3812, "avgOutputTokens": 402,
      "avgIterations": 2.6, "avgToolCalls": 1.8,
      "estCostPerQuestion": 0.0175, "estCostTotal": 0.157,
      "errors": 0, "casesWithoutUsage": 0
    },
    {
      "agentId": "github-helper-v2",
      "passRate": 0.89,
      "avgDurationMs": 4110,                     // ← the v2 prompt is faster…
      "avgInputTokens": 2954, "avgOutputTokens": 371,
      "avgIterations": 1.9, "avgToolCalls": 1.2, // ← …because it calls fewer tools
      "estCostPerQuestion": 0.0124, "estCostTotal": 0.112,
      "errors": 0, "casesWithoutUsage": 0
    }
  ],
  "judgeOverhead": { "inputTokens": 5210, "outputTokens": 640, "estCost": 0.006 }
}
```

Every run is also written to disk:

```
results/
└── github-basics-20260709-141502/
    ├── run.json       # full per-case detail
    ├── summary.json   # the aggregate above
    └── summary.csv    # one row per case — Excel/pandas ready
```

## 📊 Metrics

Captured per **case** (agent × question × repetition):

| Metric | Notes |
| --- | --- |
| `durationMs` | full turn: LLM round-trips **and** MCP tool time |
| `inputTokens` / `outputTokens` | summed over every LLM call in the loop; `null` (not 0) when a provider reports no usage |
| `iterations` | LLM round-trips used |
| `toolCallCount` / `toolNames` | which tools the agent actually reached for |
| `hitIterationLimit` | the loop was cut off before a final answer |
| `passed` + `evaluationDetail` | criterion outcome (judge reasoning for `llm-judge`) |
| `judgeInputTokens` / `judgeOutputTokens` | tracked separately from agent metrics |
| `error` | a failing case is recorded and the run continues |

## 🔁 Loop types

The MCP host loop is hand-driven (no SDK auto-invocation), which is what makes it
measurable and swappable:

| `loopType` | Behavior |
| --- | --- |
| `manual` | The classic loop: model responds → requested tools run **sequentially** → results fed back → repeat until a final answer (or `maxIterations`). |
| `parallel-tools` | Same loop, but when the model requests several tools in one turn they run **concurrently** — often a big latency win on I/O-heavy MCP servers. |

New strategies implement one small interface (`ILoopStrategy`) and become available as a
`loopType` value — comparing loop designs is then just another benchmark run.

## 💬 Interactive chat mode

Before benchmarking an agent, talk to it. The classic MCP-host chat surface is still here:

```
POST /api/session            # establish the session cookie
POST /api/chat               # { "message": "...", "agent": "github-helper-v2" } → accepted
GET  /api/messages           # poll: progress lines ("(calling get_issues ...)") + final answer
```

A minimal reference client lives under `wwwroot/` — open `http://localhost:5088` and chat.

## 📚 API reference

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/agents` | List agent configurations (id, name, description, model, loop type, servers). |
| GET | `/api/tools` | The aggregated MCP tool catalog, grouped by server. |
| GET | `/api/maverik/suites` | List loaded test suites. |
| POST | `/api/maverik/runs` | Start a run: `{ suiteId, agentIds?, repetitions? }` → `{ runId }`. |
| GET | `/api/maverik/runs` | List runs with state and progress. |
| GET | `/api/maverik/runs/{id}` | Full run status incl. per-case results (poll while running). |
| GET | `/api/maverik/runs/{id}/summary` | Per-agent aggregates + cost estimates + judge overhead. |
| POST | `/api/session` | Establish a chat session cookie. |
| POST | `/api/chat` | Enqueue a chat message for an agent. |
| GET | `/api/messages` | Drain buffered chat messages for the session. |

## 🐛 Debugging

Set `MCPHOST_LLM_DEBUG=1` and every raw LLM HTTP exchange — agent *and* judge traffic —
is written to `logs/{sessionId|runId}.log` with method, endpoint, full bodies, round-trip
time, and token usage. Off by default with zero overhead.

## 🗺️ Roadmap

- **Web dashboard** — run browser, side-by-side agent charts, pass-rate trends.
- **Configurable concurrency** — JMeter-style parallel case execution for load testing.
- **More loop strategies** — SDK-driven function invocation, retry-on-tool-error, reflection loops.
- **Statistical rigor** — percentiles and std-dev over repetitions, flakiness detection.
- **Run history across restarts** — rehydrate past runs from `results/` at startup.
- **Judge quality controls** — second-opinion judging, self-consistency checks.

## 🤝 Contributing

Issues and pull requests are welcome. Good first contributions: a new criterion type, a new
loop strategy, or an exporter for your favorite results format. Please keep the two core
invariants intact:

1. The chat clients stay registered **without** automatic function invocation — the loop
   strategies own the tool loop, and that's what makes it measurable.
2. Benchmark runner and chat mode must keep sharing the same loop code.

## 🏷️ Why "MAVERIK"?

It starts as an acronym: **M**CP **A**gent **V**alidator — *MAV* — which naturally wants to
be completed to *maverick*. But a maverick is an unorthodox character who refuses to conform
to accepted standards, and this software is the opposite: it exists to hold agents *to* a
standard. So the *ck* had to go. **MAVERIK** — almost a maverick, but standards-compliant.

## 📄 License

Apache 2.0 License.
