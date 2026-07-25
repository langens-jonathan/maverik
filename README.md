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

[Quick start](#-quick-start) · [Frontend](#-frontend) · [Define a suite](#-defining-a-test-suite) ·
[Run a benchmark](#-running-a-benchmark) · [Metrics](#-metrics) · [API](#-api-reference) ·
[Roadmap](#-roadmap)

</div>

---

## What is MAVERIK?

JMeter exists because "is my system fast enough?" is a question you answer by measuring, not
guessing — you define a test plan, throw load at your system, and read off the numbers that
tell you whether a change made things better or worse. MAVERIK applies the same idea to MCP
agents: instead of a system's throughput and latency under load, you're measuring an *agent
configuration's* correctness, speed, and cost as you tweak it.

An agent configuration has a set of **tunable parameters** — the system prompt, the LLM
model, which MCP servers/tools it can reach, the tool-loop strategy, the iteration cap, and
(down the road) context-reduction strategies — and a set of **outcome parameters** you judge
it on: whether it reaches an acceptable answer, how long that takes, how many input/output
tokens it burns, and which tools it reaches for (some are far more expensive to call than
others). The MAVERIK workflow is to model the outcome parameters *first* — what counts as a
correct answer, what latency and token budget is acceptable, which tools are "free" and which
should be used sparingly — and only then sweep the tunable parameters and compare.

Concretely: you define *Agent Configurations* (system prompt, model, MCP servers, loop
strategy, iteration cap) and *Test Suites* of questions with pass criteria. MAVERIK fires
every question at every agent configuration and records:

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

## 🤖 What is an agent?

If you're new to the term: an **LLM agent** is a language model wired up to a loop and a set
of tools. On its own, an LLM just turns text into text — it can't look anything up or take
action. Give it a set of tools (functions it can call — read a file, hit an API, query a
database) and a loop that feeds each tool's result back to it, and it can work multi-step
problems: decide it needs information, call a tool, read what came back, decide whether
that's enough or it needs another tool, and eventually answer. That loop — *call a tool or
answer, repeat until done* — is what makes something an agent rather than a one-shot
completion.

MAVERIK's MCP host implements exactly that loop (see `maverik/src/chat/ChatWorker.cs` /
`maverik/src/loop/LoopStrategy.cs`), and the tools it hands the model come from one or more
**MCP servers** — servers exposing typed, discoverable functions over the
[Model Context Protocol](https://modelcontextprotocol.io).

MAVERIK's specific definition of "agent" is an **Agent Configuration** — the `AgentConfig`
object (`maverik/src/agents/AgentConfig.cs`) defined in `config/agents.json`. It's a named
bundle of everything that determines how the loop behaves for a given use case:

| Field | Meaning |
| --- | --- |
| `systemPrompt` | how the agent is primed/instructed (inline or `config/prompts/agent/<id>.md`) |
| `model` | which LLM answers, from `config/llm-models.json` |
| `mcpServers` | which MCP servers' tools it's allowed to reach for |
| `loopType` | which `ILoopStrategy` drives its tool loop (`manual`, `parallel-tools`, ...) |
| `maxIterations` | how many LLM round-trips it gets before MAVERIK gives up on it |

The important part: **an agent is data, not code.** Two agents that differ only in their
system prompt, or only in their model, are two entries in `config/agents.json` — not two
codebases. That's what makes A/B testing possible: point the same test suite at, say,
`github-helper` and `github-helper-v2-prompt`, and any difference in the results is
attributable to the one thing you changed.

## ✨ Features

- **Agent configurations as data** — prompt, model, MCP servers, loop type, and iteration cap
  live in `config/agents.json`; comparing two agents is a config edit, not a code change.
- **Multi-provider model registry** — Anthropic and any OpenAI-compatible endpoint
  (OpenAI, Ollama, LM Studio, vLLM, …) side by side in `config/llm-models.json`.
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
                     │           ILoopStrategy ◄──── config/agents.json     │
                     │             (manual / parallel)                      │
                     │                 │         │                          │
                     │       LLM models│         │MCP tool calls            │
                     │ (config/llm-models.json)  (config/mcp-servers.json)  │
                     │                     │                                │
                     │                     ▼                                │
                     │             CriterionEvaluator (exact/contains/      │
                     │                     │           regex/llm-judge)     │
                     │                     ▼                                │
 GET /api/maverik/runs/{id} ◄── run store + results/{runId}/ (json + csv)   │
                     └──────────────────────────────────────────────────────┘
```

The `maverik-frontend` dashboard is just a browser-side client of this same API — it calls
`GET /api/maverik/suites/{id}` to render a test plan, `POST /api/maverik/runs` to execute it, and
polls `GET /api/maverik/runs/{id}` + `.../summary` to show progress and the side-by-side
comparison. It runs in its own container and talks to `maverik` over HTTP from the browser, not
container-to-container — see [Frontend](#-frontend) below.

Every question runs in **complete isolation**: a fresh conversation seeded with the agent's
system prompt, no shared history, no sessions. The runner executes cases **sequentially** so
timing numbers stay clean. And critically, the benchmark runner and the interactive chat mode
share the *same* loop code — what you measure is what you ship.

## 🚀 Quick start

MAVERIK is Docker/Compose-only — there's no supported bare-metal path, just config and a
container.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose
- At least one reachable MCP server (HTTP / streamable-HTTP transport)
- An API key for Anthropic and/or any OpenAI-compatible endpoint

### 1. Fill out the config files

Every real config file lives in `./config/` and has a committed `*.example.*` template next to
it — copy each one and edit the copy:

```powershell
git clone <this-repo>
cd maverik

cp config/.env.example config/.env                             # secrets: API keys, tokens
cp config/llm-models.example.json config/llm-models.json       # LLM models, referencing .env by name
cp config/mcp-servers.example.json config/mcp-servers.json     # MCP servers to connect to
cp config/agents.example.json config/agents.json               # agent configurations under test
cp docker-compose.example.yml docker-compose.yml               # ports, mounts, env_file
```

Secrets never go in JSON config files — put real values in `config/.env` (gitignored), then
reference them by name as `${VAR_NAME}` in `mcp-servers.json` headers or `llm-models.json`'s
`apiKey` field. `docker-compose.yml` loads `config/.env` straight into the container via
`env_file:`, so any variable you add there is available for expansion without touching the
compose file. **Never paste real secrets into a chat/terminal session that gets logged — edit
`config/.env` directly in a file editor.**

### 2. `docker compose up -d`

```powershell
docker compose up -d --build
```

`./config` is bind-mounted read-write (so the dashboard's config editor — see below — can save
changes) and `results/`/`logs/` are mounted read-write so your benchmark data survives the
container. Remember that *inside* the container,
`localhost` is the container — MCP servers running on your host machine are reached via
`http://host.docker.internal:...` (already wired up in the compose template).

### 3. Browse to `http://localhost:5090` (dashboard) or `http://localhost:5088` (raw API)

### 4. Fire your first benchmark

Through the dashboard: open a test plan, pick agents/repetitions, click **Start run**, watch it
progress and compare results. Or drive the API directly:

```bash
curl -X POST http://localhost:5088/api/maverik/runs \
     -H "Content-Type: application/json" \
     -d '{ "suiteId": "github-basics", "repetitions": 3 }'
# → { "runId": "github-basics-20260709-141502" }

curl http://localhost:5088/api/maverik/runs/github-basics-20260709-141502/summary
```

## 🖥️ Frontend

`./frontend/` is a small React (Vite) dashboard, shipped as its own `maverik-frontend` Compose
service — the `maverik` container stays backend-only. `docker compose up -d --build` builds and
runs both; the frontend is a static build served by nginx, and it talks to `maverik`'s API
directly from your browser (not container-to-container), so no MCP-style networking concerns
apply here.

It gives you four views: **Test plans** (a suite's questions and criteria — the test plan
itself), a **run form** on each test plan (pick agents/repetitions, start a run), **Runs**
(live progress while a run executes, then the per-agent comparison — pass rate, duration,
tokens, estimated cost — plus a per-case results table once it's done), and **Config**
(structured editors for `agents.json`, `llm-models.json`, `mcp-servers.json`, and per-agent
prompt files — see Configuration below).

Because the API URL is baked into the static build at image-build time (Vite's `VITE_API_BASE_URL`,
set via the `args:` block in `docker-compose.yml`), if you change `maverik`'s published port from
the default `5088`, update both that `args:` value *and* the `maverik` service's
`MAVERIK_FRONTEND_ORIGIN` (used for CORS) to match your `maverik-frontend` port, then rebuild.

## ⚙️ Configuration

Everything user-editable lives under `./config/`, bind-mounted read-write into the container.
Every real JSON file below is gitignored and has a matching committed `config/*.example.*`
template to copy from — and if you skip that step, the app copies it for you: a missing
`agents.json`/`llm-models.json`/`mcp-servers.json` is bootstrapped from its `.example` sibling on
first read, whether that read happens at container startup or from the dashboard's **Config**
tab. The dashboard also lets you edit all three of those files, plus per-agent prompt files,
through structured forms (`GET`/`PUT /api/config/agents`, `/llm-models`, `/mcp-servers`,
`/prompts/{agentId}` — see API reference). Saves write straight to the files below; since every
registry is built once at startup, **changes only take effect after `docker compose restart
maverik`** (the dashboard says so after every save).

| File | What it defines |
| --- | --- |
| `config/.env` | Real secret values (API keys, tokens). Copy from `config/.env.example`. Loaded into the container by `docker-compose.yml`'s `env_file:`. |
| `config/llm-models.json` | LLM models across providers, plus optional per-MTok pricing; `apiKey` supports `${VAR_NAME}` expansion against `.env`. Copy from `config/llm-models.example.json`. |
| `config/mcp-servers.json` | MCP servers (name, HTTP endpoint, headers with `${VAR_NAME}` expansion against `.env`). Copy from `config/mcp-servers.example.json`. |
| `config/agents.json` | The agent configurations under test. Copy from `config/agents.example.json`. |
| `config/maverik-suites/*.json` | Test suites: questions, criteria, default agent set, judge model. |
| `config/prompts/agent/<id>.md` | An agent's system prompt, when not defined inline. |

Both `mcp-servers.json` headers and `llm-models.json`'s `apiKey` share the same `${VAR_NAME}`
expansion (`maverik/src/config/EnvExpansion.cs`): a variable referenced but not defined in
`config/.env` fails startup with a clear error rather than sending an empty credential.

### An agent configuration

```jsonc
{
  "id": "github-helper-v2",
  "name": "GitHub Helper (v2 prompt)",
  "description": "Tighter prompt; should reduce tool-call count.",
  "model": "claude-sonnet",           // an id from config/llm-models.json
  "loopType": "parallel-tools",       // "manual" (default) or "parallel-tools"
  "mcpServers": [ "github" ],         // names from config/mcp-servers.json — the agent only sees these tools
  "maxIterations": 8                  // cap on LLM round-trips per question
}
```

The system prompt is either inline (`"systemPrompt": "..."`) or in
`config/prompts/agent/github-helper-v2.md` — perfect for versioning prompt experiments in git.

### A model with pricing

```jsonc
{
  "id": "claude-sonnet",
  "provider": "anthropic",
  "model": "claude-sonnet-5",
  "apiKey": "${ANTHROPIC_API_KEY}",   // expanded against config/.env at model-load time
  "inputPricePerMTok": 3.00,          // optional — enables cost estimation
  "outputPricePerMTok": 15.00
}
```

## 🧪 Defining a test suite

One file per suite in `config/maverik-suites/`:

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
| GET/PUT | `/api/config/agents` | View/edit `agents.json` (bootstraps from example if missing). PUT body/response is `AgentsFile`. |
| GET/PUT | `/api/config/llm-models` | View/edit `llm-models.json`. |
| GET/PUT | `/api/config/mcp-servers` | View/edit `mcp-servers.json`. |
| GET/PUT | `/api/config/prompts/{agentId}` | View/edit `config/prompts/agent/{agentId}.md`. |
| GET | `/api/maverik/suites` | List loaded test suites. |
| GET | `/api/maverik/suites/{id}` | Full suite detail: questions + criteria (the test plan itself). |
| POST | `/api/maverik/runs` | Start a run: `{ suiteId, agentIds?, repetitions? }` → `{ runId }`. |
| GET | `/api/maverik/runs` | List runs with state and progress. |
| GET | `/api/maverik/runs/{id}` | Full run status incl. per-case results (poll while running). |
| GET | `/api/maverik/runs/{id}/summary` | Per-agent aggregates + cost estimates + judge overhead. |
| POST | `/api/session` | Establish a chat session cookie. |
| POST | `/api/chat` | Enqueue a chat message for an agent. |
| GET | `/api/messages` | Drain buffered chat messages for the session. |

## 🐛 Debugging

Uncomment the `MCPHOST_LLM_DEBUG=1` line in `config/.env` and every raw LLM HTTP exchange — agent
*and* judge traffic — is written to `logs/{sessionId|runId}.log` on the host (via the
`./logs:/app/logs` mount) with method, endpoint, full bodies, round-trip time, and token usage.
Off by default with zero overhead.

## 🎛️ The JMeter analogy, fleshed out

JMeter's core idea is a feedback loop: define what you're testing, run it, read the numbers,
adjust, run again. MAVERIK runs the same loop, just aimed at agent configurations instead of
HTTP endpoints.

| JMeter concept | MAVERIK equivalent |
| --- | --- |
| Test plan | Test suite (`config/maverik-suites/*.json`) |
| Sampler (one request) | Question (one prompt + criterion) |
| Assertion | Criterion (`exact` / `contains` / `regex` / `llm-judge`) |
| Thread group / loop count | `repetitions` — run the same case N times to see through LLM nondeterminism |
| Target under test | Agent configuration (`config/agents.json`) |
| Listener / results table | `GET /api/maverik/runs/{id}` + `results/{runId}/summary.csv` |

### Two kinds of parameters

**Tunable parameters** — the levers you pull between runs:

- `systemPrompt` — how the agent is instructed
- `model` — which LLM answers, and at what price
- `mcpServers` — which tools it's allowed to reach for
- `loopType` — how it drives the tool-call loop (sequential vs. parallel tool calls today;
  more strategies land as `ILoopStrategy` implementations)
- `maxIterations` — how much rope it gets before MAVERIK calls it a failure
- the question wording itself, if you're testing prompt phrasing rather than the agent
- context-reduction strategies (summarizing/trimming history as it grows) — a natural future
  lever, not yet implemented

**Outcome parameters** — what you judge a configuration on, captured per case:

- correctness (`passed`, via the case's criterion)
- speed (`durationMs` — the full turn, LLM and tool time both)
- cost (`inputTokens` / `outputTokens`, and `estCostPerQuestion` when the model has pricing)
- tool usage (`toolCallCount` / `toolNames` — some tools are far cheaper to call than others,
  so *which* tools an agent reaches for is itself a signal, not just how many)

### The workflow

The order matters. **Model the outcome parameters first**: write down what a correct answer
looks like (the criterion), what latency is acceptable, what token budget you're willing to
spend, and which tools are "free" versus ones you want the agent to avoid unless necessary.
Only once that's pinned down do you sweep the tunable parameters — try a tighter system
prompt, a cheaper model, a parallel-tools loop — and let MAVERIK tell you, in the same units
you defined up front, whether the change actually helped or just moved the cost around.

## 🗺️ Roadmap

### Making the tune-and-compare workflow easier

- **Parameterized agent sweeps** — generate a matrix of `AgentConfig`s from a base config plus
  a set of variations (e.g. 3 system prompts × 2 models = 6 agents) instead of hand-authoring
  every combination in `config/agents.json` — the direct analog of JMeter's CSV-driven
  parameterization.
- **Per-tool cost/weight tracking** — tag MCP tools with a cost weight so the summary can
  report a *weighted* tool-cost signal instead of just `toolCallCount`/`toolNames`, so
  "expensive tool used sparingly" becomes a number, not just a name in a list.
- **Context-reduction strategies** — history-trimming/summarization as a loop-level lever
  (a new `ILoopStrategy` concern), sitting alongside `manual` and `parallel-tools` as
  something you can A/B like any other tunable parameter.

### Result analysis and visibility

- **Statistical rigor** — percentiles and std-dev over repetitions, flakiness detection.
- **Run history across restarts** — rehydrate past runs from `results/` at startup; the
  `maverik-frontend` dashboard (see [Frontend](#-frontend)) currently only sees runs still held
  by the in-memory `MaverikRunStore`, so a restarted `maverik` container means an empty Runs list
  even though the `results/{runId}/` files on disk are untouched.
- **Pass-rate trends over time** — now that a per-run summary exists, chart it across runs of
  the same suite, not just within one.

### Other

- **More loop strategies** — SDK-driven function invocation, retry-on-tool-error, reflection
  loops.
- **Configurable concurrency** — JMeter-style parallel case execution for load testing.
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
