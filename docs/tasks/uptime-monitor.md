# Tasks: uptime-monitor (MVP)

Source: `docs/architecture/uptime-monitor.md` (§ refs below), ADR-0001 to 0007, spec v2. Each task's definition of done (DoD) includes: `node --test` is green, no new runtime dependencies, and the code-reviewer has approved. **∥** marks tasks that can run in parallel with the others in the same wave.

## Waves (suggested execution order)

| Wave | Tasks | Notes |
|---|---|---|
| 0 | T1 | Scaffold, about 30 minutes |
| 1 | T2 ∥ T5 ∥ T6 ∥ T8 ∥ T10 ∥ T16 | The contracts are fixed in the architecture doc. T10 also needs the UX copy (`docs/design/uptime-monitor.md`). T16 is design-time security. |
| 2 | T3 ∥ T4 ∥ T7 ∥ T11 ∥ T12 ∥ T13 | T12 and T13 can be drafted early and finished once the CLI exists |
| 3 | T9 | Wires everything together |
| 4 | T14 ∥ T15 ∥ T17 | |
| 5 | T18, then T19 | T19's first Pages deploy needs **owner approval** (hard stop 1) |

## Task list

### T1: Scaffold the repo. Owner: backend-engineer. Deps: none
`package.json` (`"type":"module"`, `"engines":{"node":">=24"}`, `"scripts":{"test":"node --test"}`, **no dependencies**), the directory layout from §3, an example `monitor.config.json` with the team's dogfood targets left as placeholders, `.gitignore` (`_site/`), and `test/` with one smoke test.
**DoD:** `npm test` passes on Node 24. **ACs:** groundwork for X1 and X2.

### T2: `src/ssrf.js`. Owner: backend-engineer. Deps: T1
`checkUrlSyntax`, `isBlockedAddress`, name suffix rules, embedded-IPv4 extraction (§6.1, §6.2).
**DoD:** table-driven tests with at least one entry for every range in the §6.2 table. Every encoding (decimal `2130706433`, octal `0177.0.0.1`, hex `0x7f.0.0.1`, `0x7f000001`, short `127.1`, `::ffff:127.0.0.1`, `::ffff:7f00:1`, `::127.0.0.1`, `64:ff9b::7f00:1`, `2002:7f00:1::`) is rejected. So are `localhost.`, `x.localhost`, `a.local`, `b.internal`, single-label names, userinfo, and `file:`, `ftp:`, `gopher:`, `data:` and `javascript:`. Public IPs and names pass.
**ACs:** C2, C3, C4.

### T3: `src/config.js` and the `validate` CLI. Owner: backend-engineer. Deps: T1, T2
`parseConfig`, `deriveIntervalMinutes` (ADR-0007), and the field rules in §5. Errors are `{entry, reason}` and are readable. JSON parse errors give line and column. `node src/cli.js validate` exits 1 on any error and writes the list to stdout and `$GITHUB_STEP_SUMMARY`.
**DoD:** tests for 21 targets (the 21st is invalid), duplicate names (case-insensitive), cron `*/3` (error), cron `7,22,37,52` (15), `staleAfterMinutes` < 2 × interval, a contact with `http:` or `javascript:` (error), a contact with `https:` or `mailto:` (ok), a contact with "10:30" (ok), unknown keys, and invalid JSON.
**ACs:** C1 (parsing side), C6 (push/PR failure and reporting), C7, C8, C9, C12.

### T4: `src/check.js` and `src/transport.js`. Owner: backend-engineer. Deps: T2
`checkTarget` with an injected `resolver` and `transport`, manual redirects up to 5 hops, the whole-check deadline, the fixed reason vocabulary, and a transport with `pinnedLookup` (both callback shapes, `autoSelectFamily:false`, `agent:false`). The body is never read (§6.3, §6.4).
**DoD:** tests with a recording fake for: blocked hop on redirect 3 (status `blocked redirect`, zero requests to it); a 6th hop (`too many redirects`); the rebinding test (the resolver returns public then loopback; the transport sees only the public IP; the resolver is called once per hop); mixed A records (blocked); a hanging target (`timeout`) checked alongside a healthy one, which is recorded as up in the same run; 301 then 200 is up; 404 is down with `HTTP 404`. **Real-transport test:** against a local `http.createServer`, the transport connects to the pinned address and sends the original `Host` header.
**ACs:** C5, C10, C11, K1, K2, K3, K4.

### T5: `src/github.js` and `src/datastore.js`. Owner: backend-engineer. Deps: T1
REST client (§8.4), `readData` and `writeData` with `sha` precondition and orphan bootstrap (§7). Assert: each target record ≤ 1,024 B, header ≤ 1,024 B, total ≤ 256 KB.
**DoD:** tests with a fake `fetchImpl` for: first run (branch 404, so blobs, trees, commits with `parents: []`, and refs); normal `PUT` with `sha`; 409 leaves the run failed and the old data untouched (the fake shows no second write); malformed JSON gives `data: null`. No call ever targets the default branch.
**ACs:** D1, D3 (size assertions), D5.

### T6: `src/state.js`, the pure `applyRun`. Owner: backend-engineer. Deps: T1
The state machine in §8.1. Days aggregation in UTC with 90-day pruning, removal of dropped targets (with a `close-removed` action), `lastRunAt`, `configErrorCount`, and a pure stale-gap detector `detectGap(prevLastRunAt, now, staleAfterMinutes) -> {from, to} | null`.
**DoD:** tests for: N=2 with fail then pass, so no open action (A5); 5 fails, so exactly one open action (A3); recovery gives a recover action with the correct duration (A4); a human-closed issue gives suppression with no reopen until recovery and then a later outage (A7); **A9 logic test** with simulated 15-minute runs, where the open action fires on the 2nd completed run after the outage starts; days older than 90 are pruned; a removed target is gone after 1 run (D4); fixture 95/5 gives the counts the page needs for 95.0%.
**ACs:** A2, A3, A4, A5, A7, A9 (logic), D2, D4, S7 (detection).

### T7: `src/issues.js`. Owner: backend-engineer. Deps: T5, T6
`ensureLabels`; `syncOutages(actions, openOutageIssues)` with the marker `gnosh-uptime:outage:<sha12>`; `syncConfigErrorIssue`; `reportStaleGap` with marker de-duplication over open and closed issues from the last 30 days; and `inert()` (§8.2, §8.3).
**DoD:** tests with a fake `gh` for: labels created only when missing (A6); an existing open outage issue with the marker is adopted, not duplicated (K5); config-error with 3 consecutive runs and a bad entry gives exactly one issue (create once, then no-op or update), and it closes with a comment when the config is valid; a stale gap reported twice (simulated retry) gives one issue; `inert('@octocat [x](https://evil.example) <b>#1')` contains no live mention, link, HTML or issue reference; bodies contain no response-derived text (A8).
**ACs:** A1, A2, A3, A4, A6, A7, A8, C6 (issue side), K5 (de-duplication), S7, SEC2.

### T8: `src/keepalive.js`. Owner: backend-engineer. Deps: T1 (uses the `github.js` contract; stub it if T5 isn't done)
`keepalive({gh, workflowFile:'monitor.yml', now})` and `node src/cli.js keepalive` (§9).
**DoD:** tests with a mocked API and a fake clock: (a) every invocation calls `PUT /repos/{r}/actions/workflows/monitor.yml/enable`. Simulating 60 days of runs at 15-minute intervals (and also with 50% of runs dropped) shows the largest gap between calls is far below 60 days. (b) It needs only `actions: write` (asserted against the workflow file in T12's lint). (c) A non-204 response writes a `::warning::` and a summary line, and the process exits 0.
**ACs:** S5.

### T9: `src/cli.js run` orchestration and `src/summary.js`. Owner: backend-engineer. Deps: T3, T4, T5, T6, T7, T8
The 10-step sequence in §8, checks with concurrency 5 using `allSettled`, and a per-run step summary (an inert table, errors, keepalive result, data size). Exit codes: 0 even with config errors; non-zero only on infrastructure failure (data write or API failure).
**DoD:** an integration test with all fakes: one bad entry plus two good targets gives success, both good targets checked, and one config-error issue (C6 scheduled). Two back-to-back runs against a down target give exactly one outage issue (K5). A stored `lastRunAt` 3 hours ago followed by two runs gives exactly one `monitor-stale` issue (S7). A run that throws before the write leaves the stored data unchanged (D5). A new valid target appears in the data after one run (C1).
**ACs:** C1, C6, K4, K5, S7, D5 (integration).

### T10: `site/render.js`, the pure view model. Owner: frontend-engineer. Deps: T1 and the UX copy. ∥ with backend
`buildModel(data, nowMs)` and `validateData(data)`, following §10. The contract input is the `status.json` schema in §7.
**DoD:** `node --test` covers: the summary sentence for all-up, one-down and stale (P2); per-target state words (P3); 7- and 90-day percentages with days that weren't checked excluded, and the 95/5 fixture giving "95.0%" (P4, P5); a day cell with no record giving the not-checked label; stale with a frozen clock moved past the threshold (S2), where no "Working" appears without the stale wording and no "Everything is working" appears (S3, S4); malformed data or the wrong `v` giving the load-error model (P9); an issue link only for a valid int and repo (P7).
**ACs:** P2, P3, P4, P5, P7, P9, S1, S2, S3, S4.

### T11: Page shell (`site/index.html`, `style.css`, `app.js`). Owner: frontend-engineer. Deps: T10 and the UX design
Fetch with `cache:'no-store'` from the `<meta name="gu-data-url">`, a "Check again" button, DOM built with `textContent` only, the CSP meta from §10, the "about these checks" note, the contact line, and the summary sentence as the first content in `<main>`.
**DoD:** a grep test finds no `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`. A fixture with the name `<img src=x onerror=alert(1)>` renders as literal text. The layout works at 360 px and 200% zoom. Contrast is AA. Color is never the only signal.
**ACs:** P1, P2, P6, P7, P9, P10, P11, S1, SEC1, A9 (page copy).

### T12: `monitor.yml` and `validate.yml`, plus the workflow lint. Owner: devops-engineer. Deps: T3, T8, T9 (draft in wave 2)
The permissions table in §11: top-level `permissions: {}`, the keepalive and monitor jobs, `concurrency: {group: monitor, cancel-in-progress: false}`, cron `7,22,37,52 * * * *`, `workflow_dispatch`, `timeout-minutes: 5`, `persist-credentials: false`, actions pinned to SHAs, `GITHUB_TOKEN` and `GITHUB_REPOSITORY` passed through `env:`. `validate.yml` runs on push and pull request: validate, `node --test`, the lint test, and the axe job (`npx @axe-core/cli@<pinned>` against a locally served `_site` and a fixture `status.json`).
**DoD:** `test/workflows.test.js` asserts that no `${{` appears inside any `run:` block, that every job has explicit minimal `permissions`, that `pull_request_target` and `workflow_run` are absent, that the monitor workflow has no `pages` or `id-token` permission and no deploy step, and that every `uses:` is pinned to a 40-hex SHA.
**ACs:** A1, C6 (push/PR trigger), K5, P8 (never deploys), P10 (axe), S5(b), SEC3, X2.

### T13: `pages.yml`, `scripts/build-site.mjs`, and the environment setup. Owner: devops-engineer. Deps: T11 (draft in wave 2)
Build job (`contents: read`) and deploy job (`pages: write`, `id-token: write`, `environment: github-pages`), triggered on `main` with `site/**` paths plus dispatch, with `concurrency: pages`. The build script copies `site/` into `_site/` and injects the data URL from the `GITHUB_REPOSITORY` env var (after validating its format).
**DoD:** the build script has a unit test. A setup checklist covering Pages source "GitHub Actions", the `github-pages` required reviewer (owner), and deployment branches set to `main` is handed to the writer and the manager. **Configuring the environment and approving the first deploy on our repo is an owner action (hard stop 1).**
**ACs:** P1, P8 (owner-approved path).

### T14: Data bound and history growth simulation. Owner: qa-engineer. Deps: T5, T6
A script under `test/sim/` (not run in CI by default) runs `applyRun` for 365 days × 96 runs × 20 targets with maximum-length names and URLs. It asserts that `status.json` stays under 1 MB (expected about 79 KB or less). It commits each version into a scratch local git repo, runs `git gc --aggressive`, and reports the `.git` size.
**DoD:** numbers are recorded in `docs/reviews/` or the QA report, and fed back to R3.
**ACs:** D3.

### T15: View-time freshness and no-deploy check. Owner: qa-engineer. Deps: T12, T13, T19 (live repo)
Re-measure the `raw.githubusercontent.com` headers. Trigger a run that changes state and time how long a fresh page load takes to show it (must be ≤ 10 minutes). Confirm the Pages deployment history shows no deployment for that run.
**ACs:** P8, R5.

### T16: Threat model. Owner: security-engineer. Deps: architecture doc (wave 1)
`docs/security/uptime-monitor.md`, starting from §13. Answer the four asks: ports, the `inert()` escape set against GFM, `pinnedLookup` on Node 24, and T8.
**ACs:** reviews C3, C5, C10, SEC1 to SEC3, and X2.

### T17: README. Owner: technical-writer. Deps: T12, T13 (content), UX copy
Cover: install via "Use this template" (forks start with Actions disabled); the one-time settings (Pages source, optional reviewer); editing `monitor.config.json`; watching the repo and notification settings (spec assumption 3); latency of about 30 to 60 minutes; the token permissions per job (X2); a **"Re-enable and limits"** section with an anchor linked from the page and issues, covering the 60-day rule, the keepalive and its unverified reset, how to re-enable, and the dead-man's-switch limit; datacenter-IP and IPv6-only caveats; positioning against Upptime with a link (X4); and how to change the interval by editing the cron.
**DoD:** passes the S6 forbidden-phrase grep.
**ACs:** A9 (copy), S5 (README part), S6, X2 (listing), X3 (steps), X4.

### T18: Full AC verification. Owner: qa-engineer. Deps: T9, T11, T12, T13, T17
Test plan and run across all ACs. This includes the scenarios that need a live repo: K5 back-to-back dispatch, C6 with 3 dispatched runs, S7 with `lastRunAt` set 3 hours back in a test data branch, D1 (no workflow commits on `main` after 10 runs), and **AC-X3** (a new repo from the template on an existing account in 15 minutes or less, with no workflow edits). It also runs the S6 copy grep and the axe report.
**ACs:** all, end to end.

### T19: Dogfood go-live. Owner: devops-engineer, with the manager. Deps: T18
Real targets: team Pages sites plus **at least one non-GitHub site** (M1). First Pages deploy through the approval gate (**owner approval, hard stop 1**). Start the M1 30-day log: outage-to-issue time per incident, taken from the issue `created_at` minus the `outageStartedAt` in the body. Record the date of the last human commit so R4 (keepalive reset) can be watched beyond 60 days.
**ACs:** M1 to M4, A9 (field measurement).

## AC coverage index

| AC | Tasks |
|---|---|
| C1 | T3, T9 |
| C2, C3, C4 | T2 (+T16) |
| C5, C10, C11 | T4 (+T16) |
| C6 | T3, T7, T9, T12 |
| C7, C8, C9, C12 | T3 |
| K1, K2, K3 | T4 |
| K4 | T4, T9 |
| K5 | T7, T9, T12 |
| A1 | T7, T12 |
| A2, A3, A4, A7 | T6, T7 |
| A5 | T6 |
| A6, A8 | T7 |
| A9 | T6 (logic), T11/T17 (copy), T19 (field) |
| P1 | T11, T13 |
| P2 to P5, P7, P9 | T10, T11 |
| P6, P10, P11 | T11 (+T12 axe) |
| P8 | T12, T13, T15 |
| S1 to S4 | T10, T11 |
| S5 | T8, T12, T17 |
| S6 | T17, T18 |
| S7 | T6, T7, T9 |
| D1, D5 | T5, T9 |
| D2, D4 | T6 |
| D3 | T5, T14 |
| SEC1 | T11 |
| SEC2 | T7 |
| SEC3 | T12 |
| X1, X2 | T1, T12, T17 |
| X3, X4 | T17, T18 |
