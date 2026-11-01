# Architecture

## Boundaries

```text
React popup / options
        |
validated, namespaced commands (no tokens)
        |
MV3 background worker -- native Chrome Identity
        |             -- direct Google userinfo / Calendar API
        |             -- toolbar badge / periodic alarms
        |
chrome.storage.local (metadata + preferences + safe diagnostics)

Later: Dexie/IndexedDB events + outbox; offscreen audio; calendar UI.
```

`entrypoints/background.ts` wires platform APIs, listeners, initialization, scheduling, and a serialized mutation queue. Listeners are registered synchronously at worker creation. Durable state does not depend on worker globals.

`src/background/auth-service.ts` owns account operations and safe failure transitions. Platform adapters are injected so domain tests can exercise real invariants without Google credentials.

`src/background/chrome-adapters.ts` contains native identity, local persistence, and badge adapters. `google.ts` validates direct Google responses, handles pagination, and enforces request timeouts. Raw remote errors are never forwarded to UI or diagnostics.

`src/shared/model.ts` defines the versioned storage schema, runtime command schema, settings limits, and UI-facing records. `message-router.ts` validates every command; only this extension's own pages are trusted senders.

`src/ui/` is shared by the popup and full options page. It communicates through worker commands. Storage change notifications trigger snapshot reads, keeping multiple open surfaces in sync.

## State and ownership

- Store key: `calendar-checker.state.v1`.
- Account key: verified Google `sub` (not email, which can change).
- Account record: email, enabled state, authorization/check status, calendar summaries/permissions, timestamps, safe error code.
- Settings: connection check interval 1–1440 minutes, stale threshold 1–10080 minutes; defaults 5 and 15 minutes.
- Diagnostics: most recent 50 action/time/outcome/code entries. No tokens, account identifiers, email, or calendar contents.
- OAuth tokens: Chrome-managed; transient local variables in worker operations only.

All app state writes go through the worker's serial queue. UI reads can run while an authorization prompt is pending. Do not introduce a second writer without accounting for read/modify/write races. No IndexedDB transaction should ever remain open while waiting for network calls in later stages.

## Failure behavior

| Failure                                   | Behavior                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| HTTP 401                                  | Evict that cached token, retry silently once for the same known account. Continued failure requires reconnect. |
| Partial consent / insufficient permission | Require reconnect; preserve calendar cache.                                                                    |
| Wrong Google identity                     | Abort before calendar request; require reconnect without replacing the intended account.                       |
| Network / timeout                         | Preserve cache, mark offline, keep last success. Do not request sign-in.                                       |
| Rate limit / API service error            | Preserve cache and show a specific safe error. Event-sync backoff is stage 3.                                  |
| User cancels reconnect                    | Preserve previous account state and cache.                                                                     |
| Unknown or corrupt storage schema         | Report storage failure; never reset the store automatically.                                                   |

Only enabled accounts that require reconnection contribute to the toolbar `!` badge. Startup reconstructs the badge and ensures the periodic alarm exists. Updating timing settings reschedules the alarm; normal worker wake-ups do not postpone it.

## Future event model

Keep account/calendar/event provenance, Google ETags, recurring masters/exceptions, all-day dates, and original zones. Incremental sync and bounded display-range loading have different request constraints and must be separate. Persist pending writes and conflicts independently of remote snapshots. De-duplicate shared calendar display/reminders without losing write-account provenance.
