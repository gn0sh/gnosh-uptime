# ADR-0004: The page fetches status.json from raw.githubusercontent.com at view time

- Status: Accepted (2026-10-28). Feature: uptime-monitor. ACs: P8, P9, S2. Spec assumption 9, R5

## Context
A data refresh must not be a deploy, and the page must show new state within 10 minutes of a run, with no secret.

## Decision
`fetch('https://raw.githubusercontent.com/<owner>/<repo>/monitor-data/status.json', {cache: 'no-store'})`. The URL is injected at deploy time from `GITHUB_REPOSITORY` into a `<meta>` tag. There is no polling: the page offers a "Check again" button.

## Evidence (measured 2026-10-28 with `curl -I`)
`cache-control: max-age=300`, `access-control-allow-origin: *`, `etag`, served by the Fastly CDN. So the worst-case CDN staleness is about 5 minutes, which is within 10. `no-store` removes the browser cache layer. GitHub's 2025-05-08 changelog tightened **unauthenticated** limits on raw downloads (per IP, no numbers published). One request per view is low risk, and failures show the AC-P9 message.

## Alternatives considered
- **Contents API, unauthenticated:** limited to 60 requests an hour per IP, and visitors behind a shared NAT would hit that. Rejected.
- **Data inside the Pages artifact:** every run would have to deploy, which the approval gate blocks. Rejected by the spec (AC-P8).
- **jsDelivr or Statically mirrors:** an external service (breaks X1), and they cache branch refs for hours.
- **A cache-buster query string:** no benefit beyond the 300 s TTL, and it pushes every view to the origin (more rate-limit exposure).

## Consequences
- A visitor sees data up to about 5 minutes older than the last run. Staleness math uses `lastRunAt`, so it stays honest.
- Depends on `raw.githubusercontent.com` keeping CORS `*`. QA re-measures the headers (T15).
- CSP `connect-src` is limited to that origin.
