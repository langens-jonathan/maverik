# MCP Host

A minimal MCP (Model Context Protocol) host: it connects to one or more MCP servers,
aggregates their tools, and runs a chat loop that lets an LLM call those tools and act on the
results.

## How it works

1. A client POSTs a message to `/api/chat`, which is queued and acknowledged immediately.
2. A background worker (`ChatWorker`) sends the conversation to the LLM along with the
   aggregated MCP tool catalog. The chat client is deliberately registered without automatic
   function invocation, so the worker drives the tool loop itself: when the model requests
   tools, the worker calls the owning MCP server, feeds the results back, and repeats until
   the model returns a final answer (capped at 8 iterations).
3. Progress lines and the final answer are written to a per-session outbox.
4. The client polls `GET /api/messages` to drain buffered messages (no WebSockets).

State is in-memory and single-instance: conversation history (`ConversationStore`) and the
outbox (`ChatOutbox`) are keyed by session id. A multi-instance deployment would need a
shared/distributed backing.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/api/session` | Establish the session cookie. |
| POST | `/api/chat` | Enqueue a user message (`{ "message": "..." }`). |
| GET | `/api/messages` | Drain queued messages for the session. |
| GET | `/api/tools` | Inspect the aggregated MCP tool catalog, grouped by server. |

The static front end under `wwwroot/` is a reference client for local testing only; it is not
part of the portable backend.

## Configuration

MCP servers are defined in `mcp-servers.json` (HTTP transport). Header values may contain
`${ENV_VAR}` placeholders, expanded at connect time so secrets stay out of the file.

## Run

```powershell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
dotnet run
```
