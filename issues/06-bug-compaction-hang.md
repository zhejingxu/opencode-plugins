title: compaction: hangs on "Compacting" with no retry feedback when upstream returns 503 or sends SSE keepalives
---
### Description

When a compaction request hits an unhealthy upstream (503 / rate limit / stalled stream behind a proxy), the UI stays on "Compacting" with 0 characters and no error or retry notice — in my case for over 90 minutes until I interrupted the session via `/api/session/:id/interrupt`.

Two code paths cause this:

1. **Silent retries in `SessionCompaction.deliver` (`packages/core/src/session/compaction.ts:619-695`).**
   Normal assistant steps use `SessionRunnerRetry.make(bus, sessionID).wait(...)`, which publishes `SessionEvent.RetryScheduled` so the UI shows the error and retry countdown. Compaction only calls `SessionRunnerRetry.policy(sessionID)` and `Effect.sleep(decision.delay)` — no event is published and nothing is logged, so 10 retry attempts look identical to a stuck stream.

2. **Chunk timeout is attached to raw bytes before SSE framing (`packages/ai/src/route/transport/http.ts:119-125`).**
   `Stream.timeoutOrElse` (`DEFAULT_CHUNK_TIMEOUT_MS = 900_000`, 15 min) wraps `RequestExecutor.responseStream(response)` *before* `prepared.framing.frame(...)`. Any proxy/Cloudflare that flushes `: keepalive` comments or `event: ping` frames every 15–30s resets the 15-minute timer on every byte chunk, while `sseFraming` drops those keepalives downstream — so the model event stream never emits and never times out.

Moving `Stream.timeoutOrElse` after framing (or timing meaningful protocol events) and publishing retry status during compaction would fix both.

### Plugins

None required to reproduce

### OpenCode version

2.2.5 (`dev` @ `1bf08ae46a`)

### Steps to reproduce

1. Point a provider at an endpoint that returns HTTP 503 (or holds an SSE connection open while sending `: keepalive\n\n` every 20s).
2. Run `/compact` in a session.
3. Observe the session stays on "Compacting" with no retry indicator and no timeout when keepalives are present.

### Operating System

macOS (arm64)

### Terminal

Web UI / Ghostty
