# CI/CD tutorial: catching MCP server regressions on every commit

This is a worked, deliberately fictional example — a Jenkins pipeline for a made-up
`inventory-mcp` server — showing the pattern described in README's
[Testing your MCP server, not just your agent](README.md#-cicd-integration) section. Nothing
here needs to be wired up to a real Jenkins instance or a real MCP server to be useful; the point
is the *shape* of the pipeline, so you can build the equivalent in GitHub Actions, GitLab CI,
TeamCity, or whatever you actually run.

## The problem this solves

An agent's `agents.json` entry names which MCP servers it's allowed to use. It does **not**
record what those servers' tools look like — their names, descriptions, parameter schemas.
Those are resolved live, every time an agent runs, from whatever the server currently advertises.

That means a change entirely inside an MCP server's own repo — rename a tool, tighten a
description, add a required parameter — can silently change how every agent connected to it
behaves, without a single line changing in any agent's config. Normal CI, scoped to the agent's
own repo, will never see this. Normal CI scoped to the *MCP server's* repo usually doesn't either
— unit tests for a tool's handler function don't tell you whether an LLM still calls it
correctly, or how much it now costs to.

This isn't hypothetical — it's a real measurement: attaching three unused MCP servers to an
otherwise-unchanged agent increased its cost per question by 28%, from tool-schema overhead
alone, with identical pass rate and identical tool-call behavior. Nothing about that would show
up in the MCP server's own unit tests, or in the agent repo's CI. It only shows up if you
actually run the agent against
the server and measure.

## The pieces

- A MAVERIK instance reachable from your CI runner (it's just HTTP — see
  [CI/CD integration](README.md#-cicd-integration) in the main README).
- A small suite that exercises the MCP server's core capability.
- An agent already wired to that server.
- A pipeline stage, in the **MCP server's own repo**, that runs after every deploy to main.

### The fictional suite

One question is enough to start — you're not trying to cover every tool, just to have *a*
tripwire. `inventory-mcp` exposes a `get_low_stock_items` tool; this suite asks for it and checks
the answer contains the expected count from a known-good fixture dataset the staging environment
seeds on every deploy:

```json
{
  "id": "inventory-smoke",
  "name": "Inventory MCP smoke test",
  "description": "Minimal regression check for inventory-mcp — one deterministic question against the seeded staging dataset.",
  "agents": ["inventory-assistant"],
  "questions": [
    {
      "id": "low-stock-count",
      "text": "How many items are currently low in stock?",
      "criterion": { "type": "contains", "expected": "3" }
    }
  ]
}
```

### The fictional agent

```json
{
  "id": "inventory-assistant",
  "name": "Inventory Assistant",
  "model": "claude-haiku",
  "mcpServers": ["inventory-mcp"],
  "maxIterations": 6
}
```

## The pipeline

This lives in `inventory-mcp`'s own repo, as a stage added after whatever already deploys it. The
key structural point: **MAVERIK doesn't hot-reload MCP connections**, so a code-only deploy behind
the same endpoint is invisible to it until it reconnects — the pipeline has to restart it before
running the suite, or it'll silently test the *old* tool catalog.

```groovy
pipeline {
    agent any

    // In a real setup this is a webhook from the repo, not polling.
    triggers { pollSCM('* * * * *') }

    environment {
        MAVERIK_API               = 'http://maverik.internal:5088'
        SUITE_ID                  = 'inventory-smoke'
        COST_REGRESSION_THRESHOLD = '0.15'   // fail the build if cost jumps >15%
    }

    stages {
        stage('Checkout') {
            steps { checkout scm }
        }

        stage('Deploy inventory-mcp') {
            steps {
                // However this team already ships the server — out of scope for this tutorial.
                sh './deploy.sh'
            }
        }

        stage('Restart MAVERIK to pick up the new tool catalog') {
            steps {
                sh 'ssh ci@maverik-host "docker compose restart maverik"'
                // Crude readiness wait — swap for a real health-check poll.
                sh 'sleep 10'
            }
        }

        stage('Run the MAVERIK suite') {
            steps {
                script {
                    def body = sh(
                        script: """curl -s -X POST ${MAVERIK_API}/api/maverik/runs \
                            -H 'Content-Type: application/json' \
                            -d '{ "suiteId": "${SUITE_ID}", "repetitions": 3 }'""",
                        returnStdout: true
                    ).trim()
                    env.RUN_ID = sh(script: "echo '${body}' | jq -r .runId", returnStdout: true).trim()
                    echo "Started MAVERIK run ${env.RUN_ID}"
                }
            }
        }

        stage('Wait for it to finish') {
            steps {
                timeout(time: 10, unit: 'MINUTES') {
                    waitUntil {
                        script {
                            def state = sh(
                                script: "curl -s ${MAVERIK_API}/api/maverik/runs/${env.RUN_ID} | jq -r .state",
                                returnStdout: true
                            ).trim()
                            echo "run state: ${state}"
                            return (state == 'completed' || state == 'failed')
                        }
                    }
                }
            }
        }

        stage('Compare against the previous run') {
            steps {
                script {
                    def records = sh(
                        script: "curl -s '${MAVERIK_API}/api/maverik/suite-runs?suiteIds=${SUITE_ID}'",
                        returnStdout: true
                    ).trim()
                    writeFile file: 'records.json', text: records
                    def exitCode = sh(
                        script: "python3 compare_runs.py records.json ${COST_REGRESSION_THRESHOLD}",
                        returnStatus: true
                    )
                    if (exitCode != 0) {
                        error('inventory-mcp regressed against the previous suite run — see the comparison above.')
                    }
                }
            }
        }
    }

    post {
        failure {
            echo 'Consider re-running with dev mode on (POST /api/dev-mode) for full wire-level logs before debugging further.'
        }
    }
}
```

### The comparison script

`GET /api/maverik/suite-runs?suiteIds=inventory-smoke` returns every persisted
`SuiteRunRecord` for this suite, newest first — so `records[0]` is the run that just finished and
`records[1]` is whatever ran before this deploy. This is intentionally minimal: two numbers, two
thresholds, one exit code. A real version would probably also track duration and tool-call count,
and post the comparison somewhere instead of just printing it.

```python
#!/usr/bin/env python3
import json, sys

records_path, threshold = sys.argv[1], float(sys.argv[2])
records = json.load(open(records_path))

if len(records) < 2:
    print("No previous run to compare against yet — nothing to check, passing.")
    sys.exit(0)

current, previous = records[0]["summary"], records[1]["summary"]

pass_rate_dropped = current["passRate"] < previous["passRate"]
cost_increase = (
    (current["estOverallCostTotal"] - previous["estOverallCostTotal"]) / previous["estOverallCostTotal"]
    if previous["estOverallCostTotal"] else 0
)

print(f"pass rate: {previous['passRate']:.0%} -> {current['passRate']:.0%}")
print(f"overall cost: ${previous['estOverallCostTotal']:.4f} -> ${current['estOverallCostTotal']:.4f} "
      f"({cost_increase:+.1%})")

if pass_rate_dropped:
    print("FAIL: pass rate dropped.")
    sys.exit(1)
if cost_increase > threshold:
    print(f"FAIL: cost increased more than {threshold:.0%}.")
    sys.exit(1)

print("OK: no regression.")
sys.exit(0)
```

## What this actually catches

Run this on every commit to `inventory-mcp`'s main branch and it turns three previously-invisible
classes of change into a build failure instead of a support ticket three weeks later:

- **A tool gets renamed or removed.** The agent can no longer find it, iterates uselessly trying
  to answer without it, and either fails outright or produces a worse answer — pass rate drops.
- **A tool's description or schema grows.** Every connected agent's input tokens (and therefore
  cost) go up on every single call, whether the change was needed or not — exactly the effect
  described above.
- **A tool starts behaving differently** (different response shape, slower, flakier) — shows up
  as duration or iteration-count drift even when the final answer still happens to pass.

## What's deliberately left out

This is a starting point, not a production pipeline:

- No Jenkins credentials store — the `curl`/`ssh` calls above should use one instead of bare
  hostnames.
- `sleep 10` instead of a real readiness check.
- One question, one criterion. A real suite would cover more of the server's tool surface and
  probably run against more than one agent/model combination.
- No handling for MAVERIK itself being unreachable, mid-deploy, etc.
- The comparison script only looks one run back. A rolling baseline (e.g. median of the last 5
  runs) would be less sensitive to single-run noise — see the `repetitions` discussion in the
  main [README](README.md#the-workflow) for the same idea applied within a single run.
- `records[0]`/`records[1]` only works because `inventory-smoke` has exactly one agent. Suite-run
  records for a multi-agent suite come back interleaved across all of them, newest-first overall
  — comparing raw list positions there would silently diff two different agents' numbers instead
  of the same agent across time. Filter by `agentId` first if you extend this to more than one.

Everything above generalizes past Jenkins — the only Jenkins-specific pieces are `pipeline {}`,
`sh`, and `triggers {}`. In GitHub Actions the same stages are just `steps:` with `run:`; in
GitLab CI they're `script:` blocks under a job. The pattern is what matters: **restart the
harness so it sees the new tool catalog, run a small suite, compare to the last known-good run,
fail the build on regression.**
