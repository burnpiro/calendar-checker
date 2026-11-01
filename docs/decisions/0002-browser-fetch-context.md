# ADR 0002: Preserve the native browser fetch context

Date: 2026-11-01

Status: Accepted; unit and real Chrome worker checks pass.

## Context

Account connection failed after Google consent with an apparent network error. Native token acquisition and direct global fetch calls to account/calendar endpoints succeeded. The gateway stored native `fetch` as a constructor property, then invoked `this.fetcher(...)`. In Chrome this bound the function to the gateway instead of its Window/Worker global, triggering `TypeError: Illegal invocation` before sending any request. Injected fetch mocks and Node's fetch did not enforce the same receiver requirement.

## Decision

Use a small arrow transport that calls `globalThis.fetch(...)`. The gateway can safely store/call that wrapper while tests can still inject a fetch adapter. Verify both the actual gateway's default receiver behavior and execution of the production transport in a real extension worker.

Do not label a recognized invocation/programming error as an offline or transport failure, and do not retry it. Actual read-only transport failures get at most one retry; HTTP/auth/schema failures remain distinct.

## Consequences

- The browser sends requests with the correct native API context.
- A safe diagnostic step/category and optional HTTP/native numeric code identify future failures without raw provider messages or credentials.
- Existing stored records remain compatible: new diagnostic fields are optional.
- No OAuth scopes, host permissions, credentials, account data, or Google Cloud settings need changing for this fix.
