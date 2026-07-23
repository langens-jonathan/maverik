# Postman Examples — testing the chat flow

> **Applies from Step 1c onward.** The full session → chat → messages round-trip shown here only
> works once **Step 1c** is built (that's when `GET /api/mcp/host/messages` and the consumer/worker exist).
> In Step 1a only `POST /api/mcp/host/session` responds; in Step 1b `POST /api/mcp/host/chat` also responds (returns
> `{ "status": "accepted" }`) but nothing is retrievable yet. Use the per-step verification curls
> in the `PROJECT-STEP1a.md` / `PROJECT-STEP1b.md` files for those earlier checks.

Exact request/response pairs for driving the MCP host from Postman. The walked-through flow is:

1. The user asks **"how large is an integer in bytes?"** (`POST /api/mcp/host/chat`).
2. The backend buffers a progress line (**"thinking..."**) which the user collects via
   `GET /api/mcp/host/messages`.
3. The LLM produces an answer (**"it depends on your system"**) which the user collects via a
   second `GET /api/mcp/host/messages`.

> **About the example strings.** `"thinking..."` and `"it depends on your system"` are used here to
> illustrate the polling mechanics. The *shape* of every request/response below is exact, but the
> literal outbox strings depend on which step you've built:
> - **Step 1c (stub worker):** the outbox line is `"(received) how large is an integer in bytes?"`.
> - **Step 2+ (real LLM):** the outbox gets the model's actual answer text (and, from Step 4, tool
>   progress lines like `"(calling <tool> with arguments {...})"` before the final answer).
>
> The endpoints, methods, bodies, status codes, and the `{ "messages": [...] }` envelope are all
> exactly as shown.

---

## Setup

- **Base URL.** Create a Postman environment variable `baseUrl` pointing at the running host,
  e.g. `http://localhost:5133` (use whatever port/prefix the host actually serves). All requests
  below use `{{baseUrl}}`.
- **Cookies (important).** The session is tracked by a cookie (`.McpHost.Session`). Postman's
  cookie jar handles this automatically: once `POST /api/mcp/host/session` returns a `Set-Cookie`, Postman
  stores it and sends it on every later request to the same host. So you do **not** manually copy
  the cookie — just keep "Automatically follow/manage cookies" on (the default) and send the
  requests in order.
  - If the platform keys sessions off its own identity/header instead of a cookie, replace the
    session step with whatever auth the platform requires and drop the cookie handling.
- **Order matters.** Run the four requests top to bottom in the same Postman tab/session so the
  cookie is shared.

---

## Step 0 — Establish the session

**Request**

```
POST {{baseUrl}}/api/mcp/host/session
```

No body, no special headers required.

**Response** — `200 OK`

Response headers include (value abbreviated):

```
Set-Cookie: .McpHost.Session=CfDJ8N...abc; path=/; httponly; samesite=lax
Content-Type: application/json
```

Body:

```json
{
  "sessionId": "d7a1f6c0e9b84f2ab3c5d6e7f8091a2b"
}
```

> Postman now holds the `.McpHost.Session` cookie and will send it automatically on the requests
> below. You generally don't need `sessionId` in the body for anything — the cookie is what keys
> the session.

---

## Step 1 — Ask the question

**Request**

```
POST {{baseUrl}}/api/mcp/host/chat
Content-Type: application/json
Cookie: .McpHost.Session=CfDJ8N...abc      ← added automatically by Postman
```

Body (raw / JSON):

```json
{
  "message": "how large is an integer in bytes?"
}
```

**Response** — `200 OK`

```json
{
  "status": "accepted"
}
```

> The answer is **not** in this response. `POST /api/mcp/host/chat` only enqueues the work and returns
> immediately. You retrieve results by polling `GET /api/mcp/host/messages`.

---

## Step 2 — Collect the "thinking..." progress line

Poll the messages endpoint. (You may need to send this a couple of times: if you poll faster than
the worker produces output, you'll get an empty array — that's normal, just poll again.)

**Request**

```
GET {{baseUrl}}/api/mcp/host/messages
Cookie: .McpHost.Session=CfDJ8N...abc      ← added automatically by Postman
```

**Response** — `200 OK`

```json
{
  "messages": [
    "thinking..."
  ]
}
```

> Draining is destructive: this poll returns everything buffered since the last poll **and clears
> it**. So the next poll will not show `"thinking..."` again.

**(Optional) empty poll** — if you poll before the next output is ready:

```json
{
  "messages": []
}
```

An empty array means "nothing new yet" — keep polling.

---

## Step 3 — Collect the answer

Poll again to pick up the model's answer.

**Request**

```
GET {{baseUrl}}/api/mcp/host/messages
Cookie: .McpHost.Session=CfDJ8N...abc      ← added automatically by Postman
```

**Response** — `200 OK`

```json
{
  "messages": [
    "it depends on your system"
  ]
}
```

If both the progress line and the answer landed between your polls, a single poll can return both
at once, in order:

```json
{
  "messages": [
    "thinking...",
    "it depends on your system"
  ]
}
```

---

## Quick reference

| # | Method | URL | Body | Success response |
| - | ------ | --- | ---- | ---------------- |
| 0 | POST | `{{baseUrl}}/api/mcp/host/session` | — | `{ "sessionId": "..." }` + `Set-Cookie` |
| 1 | POST | `{{baseUrl}}/api/mcp/host/chat` | `{ "message": "how large is an integer in bytes?" }` | `{ "status": "accepted" }` |
| 2 | GET | `{{baseUrl}}/api/mcp/host/messages` | — | `{ "messages": ["thinking..."] }` |
| 3 | GET | `{{baseUrl}}/api/mcp/host/messages` | — | `{ "messages": ["it depends on your system"] }` |

### Typical polling loop

After `POST /api/mcp/host/chat` returns `accepted`, poll `GET /api/mcp/host/messages` on an interval (e.g. every
0.5–1s). Each poll returns and clears the buffered lines. Stop when you've received the final
answer (in the real implementation, that's the last message after any `(calling ...)` progress
lines; there is no separate "done" flag — an empty array simply means nothing new yet).

### Curl equivalents (same flow, shared cookie jar)

```bash
BASE=http://localhost:5133

curl -s -c cookies.txt -X POST $BASE/api/mcp/host/session
# {"sessionId":"..."}

curl -s -b cookies.txt -X POST $BASE/api/mcp/host/chat \
     -H "Content-Type: application/json" \
     -d '{"message":"how large is an integer in bytes?"}'
# {"status":"accepted"}

curl -s -b cookies.txt $BASE/api/mcp/host/messages
# {"messages":["thinking..."]}

curl -s -b cookies.txt $BASE/api/mcp/host/messages
# {"messages":["it depends on your system"]}
```
