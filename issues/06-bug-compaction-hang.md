title: compaction: stays on "Compacting" with no feedback when the provider fails or only sends SSE keepalives
---
### Description

A manual `/compact` sat on "Compacting" with an empty summary for over 90 minutes. There was no error and no retry notice. I had to call `/api/session/:id/interrupt` to get the session back. The provider was returning `503 no eligible upstream account is currently available`.

I traced this to two causes on `dev`:

1. **Compaction retries are silent.** In `packages/core/src/session/compaction.ts` (`deliver`, around L619-L686), retryable provider errors go through `SessionRunnerRetry.policy(...)` and then `Effect.sleep(decision.delay)`. Normal steps use `SessionRunnerRetry.make(...).wait(...)`, which publishes `SessionEvent.RetryScheduled`. Compaction publishes nothing and logs nothing, so up to 10 retries look the same as a frozen stream.

2. **SSE keepalives reset the 15-minute chunk timeout.** In `packages/ai/src/route/transport/http.ts` (L119-L125), `Stream.timeoutOrElse` (`DEFAULT_CHUNK_TIMEOUT_MS = 900_000`) wraps the raw byte stream before `framing.frame(...)`. `sseFraming` drops `: keepalive` comments later, but each one has already reset the timer. I checked this with a test next to `packages/ai/test/http-timeout.test.ts`: one `data:` event, then silence, fails with "Timed out waiting for response data". One `data:` event, then `: keepalive` comments, has still not finished after 20 virtual minutes.

#43618 fixed this for the old `aisdk.ts` path, and #43519 was closed. The V2 transport has the same problem. #54544 adds logging to the step retry path, but it does not cover compaction.

Possible fix: apply the chunk timeout after framing, so it times protocol frames instead of bytes, and publish retry status from compaction.

### Plugins

None needed to reproduce

### OpenCode version

2.2.5 (`dev` @ 1bf08ae46a)

### Steps to reproduce

1. Configure a provider whose endpoint either returns HTTP 503, or sends one SSE `data:` event and then only `: keepalive` comments.
2. Run `/compact` in any session.
3. The compaction row stays on "Compacting". With 503 there is no retry notice until all retries are used. With keepalives it never times out.

### Operating System

macOS 26.5.1

### Terminal

Web app (`packages/app`)
