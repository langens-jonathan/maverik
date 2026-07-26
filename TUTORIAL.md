# Tutorial: your first agent comparison

This walks you through MAVERIK end to end, starting from a fresh clone: configure one LLM
provider, run the built-in smoke suite, duplicate the agent it uses and tweak it, run again, and
build a report that compares the two side by side. About 15 minutes if your MCP/LLM credentials
are ready.

By the end you'll have done the exact workflow the tool exists for: change one thing about an
agent, measure whether it actually helped.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose.
- Credentials for **one** of: an Anthropic API key, an OpenAI API key, or a locally running
  OpenAI-compatible server (Ollama, LM Studio, vLLM, ...). Pick whichever you have — the rest of
  this tutorial works identically regardless of which one you choose.
- A GitHub PAT is **not** needed for this tutorial. `mcp-servers.json` includes a `github` entry,
  but the smoke suite below doesn't use it — it'll just fail to connect and get skipped (logged,
  harmless) if you leave that credential unset.

## Step 1 — Configure one LLM model

Clone the repo, then copy every example config over its real counterpart:

```powershell
cp config/.env.example config/.env
cp config/llm-models.example.json config/llm-models.json
cp config/mcp-servers.example.json config/mcp-servers.json
cp config/agents.example.json config/agents.json
cp docker-compose.example.yml docker-compose.yml
```

`config/llm-models.json` ships with three example entries — Claude, OpenAI, and a local
OpenAI-compatible server — so you can see the shape of all three. For this tutorial, open it and
delete the two you don't need, keeping only the one matching your provider. Pick the matching
block below, paste it in as the file's full contents, and fill in the one credential it needs.

> **Keep the surviving entry's `id` as `"claude-haiku"`, whichever provider you actually pick.**
> `config/agents.json`'s `coding-expert` agent and `config/maverik-suites/smoke.json`'s judge
> both reference a model by that id — keeping it means nothing else needs editing. If you'd
> rather rename it to something that matches your actual provider, that's fine too, just also
> update `model` in `agents.json` and `judgeModel` in `smoke.json` to the new id, or the app
> won't start (a suite referencing an unknown judge model fails loudly at startup by design).

### Option A — Claude (Anthropic)

```json
{
  "defaultModelId": "claude-haiku",
  "models": [
    {
      "id": "claude-haiku",
      "provider": "anthropic",
      "model": "claude-haiku-4-5",
      "apiKey": "${ANTHROPIC_API_KEY}",
      "supportsTools": true
    }
  ]
}
```

In `config/.env`, set:

```
ANTHROPIC_API_KEY=sk-ant-your-real-key-here
```

### Option B — OpenAI

```json
{
  "defaultModelId": "claude-haiku",
  "models": [
    {
      "id": "claude-haiku",
      "provider": "openai-compatible",
      "model": "gpt-4o",
      "endpoint": "https://api.openai.com/v1",
      "apiKey": "${OPENAI_API_KEY}",
      "supportsTools": true
    }
  ]
}
```

Yes, the `id` still says `claude-haiku` while `model` says `gpt-4o` — that's intentional, see the
callout above. In `config/.env`, set:

```
OPENAI_API_KEY=sk-your-real-key-here
```

### Option C — A local model (Ollama, LM Studio, vLLM, ...)

```json
{
  "defaultModelId": "claude-haiku",
  "models": [
    {
      "id": "claude-haiku",
      "provider": "openai-compatible",
      "model": "your-local-model-name",
      "endpoint": "http://host.docker.internal:11434/v1",
      "apiKey": null,
      "supportsTools": true
    }
  ]
}
```

No `.env` edit needed — local servers usually don't require a key. Two things to get right:

- **Use `host.docker.internal`, not `localhost`/`127.0.0.1`.** MAVERIK runs inside a container;
  `localhost` from in there means the container itself, not your machine. `host.docker.internal`
  is Docker Desktop's DNS name for the host, and it's already how the compose template reaches
  MCP servers running locally.
- Swap the port and `model` for whatever your server actually reports (Ollama defaults to
  `11434`, LM Studio to `1234`). Not every small local model handles tool-calling reliably — if
  the run in the next step fails oddly, that's the first thing to suspect.

## Step 2 — Start MAVERIK

```powershell
docker compose up -d --build
```

Give it a few seconds, then open **http://localhost:5090**.

## Step 3 — Run the smoke suite

Click **Test plans**, then **Smoke tests**. This is the suite that ships with MAVERIK by default
— three questions (two tool-using, one LLM-judged) against the `coding-expert` agent, which is
already wired up to the GitHub/Context7/Microsoft Learn MCP servers you just configured.

The **Coding Expert** checkbox is pre-checked. Bump **Repetitions** up to 2 or 3 if you'd like —
it just re-runs the same questions that many times so a single lucky/unlucky answer doesn't skew
the average. Click **Start run**.

You'll land on the run's live page, polling automatically. Once it finishes you'll see a
pass-rate/duration/token/cost summary for `coding-expert`. If a question failed, click into it
to see exactly what the agent answered and why the criterion didn't match.

## Step 4 — Duplicate the agent and change something small

Go to **Config → Agents**. Find the **coding-expert** row and click **Duplicate**.

![Agents config — structured editor for an agent's model, MCP servers, and prompt, with a Duplicate button for spinning off a variant to compare](docs/screenshots/agents-config.png)

A new row appears right below it — same model, same MCP servers, same everything, with a fresh
id like `coding-expert-copy`. If the original's prompt lives in a file
(`config/prompts/agent/coding-expert.md`, which is the default here), the duplicate's inline
prompt box is pre-filled with that file's actual text, so you're editing a real, complete copy —
not starting from blank.

Now make one small, specific change. A good first one to try, since two of the smoke suite's
three questions expect a bare class/interface name and nothing else: add a line to the prompt
telling it to do exactly that —

```
When asked to answer with just a class or interface name, respond with only that name. No
extra words, no punctuation, no explanation.
```

Give the row a clearer name (e.g. "Coding Expert (terse)") so it's easy to tell apart later, then
click **Save** at the bottom of the page.

> **One easy-to-miss step:** duplicating an agent doesn't automatically add it to any test
> suite's agent list — a suite's run page only offers the agents explicitly assigned to it. Go to
> **Config → Suites**, open **Smoke tests**, and check the box for your new duplicate under
> **Default agents**, then **Save** that too.

## Step 5 — Run it again, both agents together

Back on **Test plans → Smoke tests**, both `coding-expert` and your duplicate are now checked by
default:

![Test plan detail — a suite's questions and criteria table, with the agent-picker run form below it](docs/screenshots/test-plan-detail.png)

Leave them both checked — running them together means this comparison comes from one run instead
of two — set repetitions the same as before, and **Start run**.

## Step 6 — Build a comparison report

Go to **Reporting → Reports → + New report**.

1. Under **Suites**, check `Smoke tests`. Leave the date range blank — no need to narrow it for
   a first look.
2. Under **Dashboard**, pick **Agent Comparison** — one of MAVERIK's built-in dashboards, built
   for exactly this: a per-agent summary table, a cost-vs-correctness scatter, and a full grid of
   per-agent averages across all 9 outcome metrics (pass rate, duration, tokens, tool calls,
   context size, cost).
3. Click **Find runs**. Every matching suite run gets pre-selected — including both of today's.
4. The dashboard renders live underneath, right there in the configure screen, before you've
   saved anything.
5. Give it an id and title, click **Save report**. You're dropped onto the report's own page —
   bookmarkable, and it'll keep resolving fresh every time you open it, including future runs of
   the same suite.

## Step 7 — Consult it

![Agent Comparison report — pass rate, cost, and token/duration breakdowns for two agent configurations side by side](docs/screenshots/agent-comparison-report.png)

Read the **Summary** table first — one row per agent, all 9 metrics side by side. Then look at
whether pass rate held steady (did the terser prompt still answer correctly?) and where the
numbers actually moved — output tokens and duration are the ones a prompt tweak like this one
would plausibly affect. Whatever you see is genuinely what happened on your machine, with your
model — there's no expected "right answer" here, that's the point of measuring it instead of
guessing.

If you want a copy to keep or share, the **Export** button on the report page gives you a CSV
(the raw numbers) or a PDF (the dashboard as rendered) with one click.

## What you just did

Every step above is the same loop, repeated: change one thing about an agent, run the same suite
against the old and new version, look at what actually moved. `Case Study.md` in this repo walks
through a real example of that loop turning up a genuinely non-obvious result (attaching unused
MCP servers to an agent quietly increases its cost by ~28% per question, from tool-schema
overhead alone) — worth a read once this tutorial's mechanics feel natural.
