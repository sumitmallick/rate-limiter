# Rate-Limited API Service

A production-ready rate-limited HTTP API built with [Fastify](https://fastify.dev/) and Node.js. Implements a **sliding window log** algorithm to enforce per-user request quotas accurately, even under concurrent load.

---

## API

### `POST /request`

Process a user request. Returns `429 Too Many Requests` if the user has exceeded the configured limit within the current window.

**Request body**
```json
{ "user_id": "alice", "payload": { "any": "json" } }
```

**Response — 200 OK**
```json
{
  "success": true,
  "user_id": "alice",
  "processed_at": "2026-04-21T10:00:00.000Z",
  "remaining": 4
}
```

**Response — 429 Too Many Requests**
```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Max 5 requests per minute.",
  "retry_after": 42
}
```

Rate limit state is reflected in response headers on every request:

| Header | Value |
|---|---|
| `X-RateLimit-Limit` | Max requests per window |
| `X-RateLimit-Remaining` | Remaining requests in current window |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when oldest window entry expires |

---

### `GET /stats`

Returns per-user request statistics.

| Query param | Description |
|---|---|
| `user_id` | Optional. Filters results to one user. Omit for all users. |

**Response — 200 OK**
```json
{
  "stats": {
    "alice": {
      "allowed": 5,
      "rejected": 1,
      "total": 6,
      "current_window_count": 5,
      "remaining": 0,
      "window_resets_at": "2026-04-21T10:01:00.000Z"
    }
  }
}
```

---

### `GET /health`

Liveness probe. Returns `200 { "status": "ok" }` with the active store backend.

---

## Running Locally

**Prerequisites:** Node.js ≥ 20

```bash
cp .env.example .env
npm install
npm run dev
```

The server starts on `http://localhost:3000`.

### With Redis (optional)

Add `REDIS_URL=redis://localhost:6379` to `.env` before starting. The service automatically switches to the Redis-backed store when this variable is present.

---

## Running Tests

```bash
npm test
```

Tests use Node.js's built-in `node:test` runner and Fastify's `inject` API — no network I/O, no external services required.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port (injected automatically by Railway) |
| `NODE_ENV` | `development` | Set to `production` on Railway |
| `RATE_LIMIT_MAX` | `5` | Max allowed requests per user per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Window size in milliseconds |
| `REDIS_URL` | _(unset)_ | When set, activates the Redis store |

---

## Deploying to Railway

1. Push this repository to GitHub (or connect directly from Bitbucket).
2. Create a new Railway service and point it at this repository (or this folder for a monorepo).
3. Add environment variables in the Railway dashboard: `NODE_ENV=production`. Optionally add a Redis addon and copy its `REDIS_URL`.
4. Railway picks up `railway.toml` automatically and runs `npm start`.

For a monorepo, configure the Railway service root directory to `rate-limiter/`.

```bash
railway up
```

---

## Design Decisions

### Sliding Window Log over Fixed Window

A fixed-window counter resets at exact clock boundaries. This lets a user send `2 × limit` requests in quick succession (limit at the end of window N, limit at the start of window N+1). The sliding window log keeps per-user timestamps for the last `windowMs` milliseconds, making the limit accurate regardless of timing.

The tradeoff is memory: each user's log holds up to `limit` timestamps (further requests are rejected, not recorded), so memory per user is bounded by `O(limit)` — 5 entries in the default configuration.

### Memory Store: Single-Threaded Safety

Node.js executes JavaScript on a single thread. The `consume()` method is synchronous, so the read-then-write on the timestamps array is uninterruptible. No locks or atomic primitives are needed for a single-process deployment.

**Limitation:** Multiple Node.js processes (horizontal scaling on Railway) each have their own in-memory state. A user could be allowed `limit × processes` requests per window. Use `REDIS_URL` to share state across instances.

### Redis Store: Atomic Lua Script

All Redis operations for a single `consume()` call run inside a single Lua script evaluated atomically by Redis. This eliminates TOCTOU races in multi-process deployments. The script is loaded once at startup via `SCRIPT LOAD` and executed via `EVALSHA` on each request (falling back to `EVAL` on cache miss after Redis restart).

### Rejected Requests Do Not Consume Quota

Only allowed requests are recorded in the sliding window. A user already at the limit sees the same `retry_after` regardless of how many rejected requests they send — there is no "retry storm" penalty. Stats separately track allowed vs rejected counts for observability.

---

## Limitations

- **In-memory state is lost on restart.** Stats and window state reset when the process exits. Use Redis for persistence across deploys.
- **No TTL on stats.** User stats accumulate in memory (or Redis) indefinitely. Production deployments should add periodic pruning for inactive users.
- **Single Redis node.** The Lua script is not compatible with Redis Cluster (multiple keys across different slots). Use Redis Cluster with hash tags (e.g. `{userId}`) if cluster support is needed.

---

## What I Would Improve With More Time

1. **Observability** — Prometheus `/metrics` endpoint with request counters, P50/P95/P99 latency histograms per user tier, and Redis connection health.
2. **Dynamic limits** — Store per-user or per-tier rate limits in a database so limits can be adjusted without redeployment.
3. **Token bucket for bursts** — The current algorithm is strict-rate. A token bucket layer on top would allow short bursts (e.g. 10 requests in 1 second) while still enforcing the per-minute average.
4. **Admin API** — Endpoints to reset a specific user's window, block/unblock users, and inspect live window state without scanning all stats.
5. **Redis Cluster compatibility** — Rewrite Lua key access to use hash tags for horizontal Redis scaling.
6. **Retry-After header standardisation** — Return `Retry-After` as an HTTP date string in addition to the JSON field to match RFC 7231.
7. **Graceful shutdown** — Wait for in-flight requests to complete before closing the server on `SIGTERM`, ensuring Railway rolling deploys cause no dropped requests.
