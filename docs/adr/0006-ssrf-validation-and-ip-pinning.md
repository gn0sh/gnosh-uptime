# ADR-0006: SSRF defense by WHATWG URL normalization, an explicit blocklist, and a connect address pinned on every hop

- Status: Accepted (2026-10-28). Feature: uptime-monitor. ACs: C2 to C5, C10, C11, K1

## Decision
- Parse with WHATWG `new URL()`. It normalizes decimal, octal, hex and short IPv4 forms. This was verified on Node 22 and is re-checked by a test on 24.
- Blocklist: a `net.BlockList`, plus explicit extraction of embedded IPv4 from mapped, compatible, NAT64 and 6to4 IPv6 forms. Ranges and name suffixes are listed in the architecture doc, §6.
- On every hop: resolve once with the injected resolver. Reject if **any** returned address is blocked. Connect only to the first address through a `lookup` override in `node:https`/`node:http` (supporting both the `all: true` and single-address callback shapes, with `autoSelectFamily: false`). SNI, certificate and `Host` all use the original hostname. Redirects are handled manually, at most 5 hops, and every hop is validated before any request.
- The injectable `resolver` and `transport` are function parameters of `checkTarget`. Tests record every request.

## Alternatives considered
- **Built-in `fetch` (undici):** it can't pin the address without importing `undici`'s `Agent` (a dependency) and the `connect.lookup` option. Its redirect handling is automatic unless disabled. Rejected.
- **Validate, then let the client resolve again:** open to DNS rebinding (Brain Trust: Skeptic and Operator). Rejected.
- **Hand-maintaining only the spec's ranges:** documentation, benchmarking and reserved ranges were added too, because none of them are public sites.

## Consequences
- About 120 lines across `ssrf.js` and `check.js`, plus a transport of about 50 lines.
- Hosts that publish only AAAA records will fail on GitHub runners without IPv6 connectivity ("connection error"). This is documented.
- Any port is allowed (an assumption, flagged for security review).
