# QA report: T18, full acceptance-criteria verification (uptime-monitor)

- **Task:** T18 in `docs/tasks/uptime-monitor.md`. **Against:** spec `docs/specs/uptime-monitor.md` (v2), the accepted UX changes SC-1 to SC-11 (`docs/design/uptime-monitor.md` §13), and the manager decisions in `docs/decisions-uptime-monitor.md`.
- **Code under test:** commit `025a363` (local working tree; nothing in `src/` or `site/` was changed by QA). The remote default branch has since moved to `d853e03`, which changes only `README.md` and `CHANGELOG.md` (checked with the GitHub API). README findings below are from the local copy, which a technical writer is editing in parallel. Re-run the README greps after that work lands.
- **Run by:** qa-engineer, 2026-10-29.
- **Environment:** local Node v22.22.0 (no Node 24 in this container), Playwright 1.63 with the pre-installed Chromium, axe-core 4.10.3 (installed in the session scratchpad only, not in the repo). CI evidence (Node 24) was read from the public Actions API.
- **Scripts used** (scratchpad, not committed): `e2e/run.mjs` (CLI end to end), `e2e/ka.mjs` (keepalive and validate CLI), `page.mjs` and `dark.mjs` (page in Playwright with axe). They are described in "How it was tested" so they can be rebuilt.

## Verdict: PASS WITH MINOR ISSUES (for everything that can be checked without a live repo)

- I found no blocker and no major bug. There are 5 minor issues and 3 nits (see "Bugs").
- 12 criteria are **NOT YET VERIFIABLE** without the live repo or a deployed page. Most of them already pass locally, and the live part is listed with the exact check to run in T19 (see "Live checks for go-live").
- **Go-live is conditional.** It needs the T19 live checks, the owner's hard-stop approval of the first Pages deploy, and real targets in `monitor.config.json`, which still lists `example.com` and `example.org` placeholders.
- **Node 24 proof (review F7 / R8): done.** CI run 40794873724 (`validate`, commit `025a363`) used `node: v24.22.1` and reported `tests 339 / pass 339 / fail 0`. That run includes the real-transport pinning tests and the WHATWG IPv4 normalization test (log lines quoted in "Evidence"). The `a11y` job in the same run reported 0 violations on all 13 cases, plus "Data fetched for all 13 cases."

### What I tried that could have failed
- **Real check path.** I drove the real `main(['run'])` with the real `checkTarget` and real `transport.js` against a local HTTP server. That server sends a body and headers with leak markers (`LEAK-BODY`, `x-secret-header`, `<script>`, `@octocat`).
- **Outage scenarios.**
  - **Hang:** a target that never answers ran beside healthy ones.
  - **Statuses:** 503 and 500 outages.
  - **Human close:** a person closed an outage issue during the outage, then the site recovered and went down again.
  - **Redirect:** a redirect to a name that resolves to `10.0.0.5`.
  - **Hostile name:** a target named `@octocat [x](https://evil.example) <b>#1`.
- **Gaps and config errors.**
  - a 3-hour gap;
  - two bad entries, then one bad entry, then a misspelled setting only, then a fix;
  - an unparseable config (trailing comma) kept for 2 runs.
- **The built page** (`GITHUB_REPOSITORY=gn0sh/gnosh-uptime node scripts/build-site.mjs`), loaded in Chromium with its own CSP. I routed `raw.githubusercontent.com` to:
  - 12 fixtures;
  - 3 data files the CLI itself produced in the run above;
  - a 404, malformed JSON, and a fetch that never answers.
- **Page behaviour.**
  - I moved the page clock past the threshold with no reload;
  - I made a refresh fail after a good load;
  - I made data recover while the tab stayed open;
  - I pressed "Try again".
- **Accessibility.** I ran axe in light and dark mode, checked reflow at 320, 360 and 640 CSS px (640 px is what 200% zoom on a 1280 px window looks like) with every `<details>` open, and walked the keyboard tab order.

## Bugs

Severity follows the role definition (blocker / major / minor). None of these block an internal dogfood go-live. B1 and B3 should be fixed or decided before template users are invited.

### B1 (minor, backend-engineer): the config-error issue and run summary say sites are skipped when none are
- **Where:** `src/issues.js:300` (title), `src/issues.js:313` (body sentence) and `src/summary.js:248` ("these entries were skipped").
- **Problem:** round-2 review R1 was fixed for the page (`skippedTargetCount`, `src/config.js:300`) but not for the issue or the summary. Every config error uses the same copy:
  - **title:** "Config file has problems: some sites are not being checked";
  - **body:** "It is skipping the entries below. Your other **N** site(s) are still being checked";
  - **summary:** "these entries were skipped".

  That copy is used even when the only error is a setting, which skips no site, and even when the file can't be read, where it gives "Your other **0** site(s) are still being checked".
- **Steps (my E2E script, runs 22 and 24):**
  1. Use a valid config with 3 targets, plus `"timeoutSecond": 5`. Run the monitor.
  2. Replace the config with JSON that has a trailing comma. Run the monitor.
- **Expected:**
  - **Setting typo:** the issue says the setting is wrong and that all 3 sites are still being checked. The title doesn't claim that sites are not checked.
  - **Unparseable file:** the issue says no sites can be checked until the file is fixed.
- **Actual:**
  - **Step 1:** the body is "The monitor found **1** problem(s) … It is skipping the entries below. Your other **3** site(s) are still being checked." The only row is `Setting "timeoutSecond"`. The summary says "Config problems (1) — these entries were skipped".
  - **Step 2:** the body is "Your other **0** site(s) are still being checked."
- **Fix idea:** use `skippedTargetCount(errors)`. When it is 0, use a title and body without "skipping" (for example "Config file has problems"). Use a separate sentence when `parsed === false` or `validCount === 0`. Add tests for both cases.

### B2 (minor, product-manager decision, then technical-writer): AC-X3 as written can't be met by the documented setup
- **Where:** `README.md` Setup steps 2, 5 and 8. The cause is ADR-0005 (`.github/workflows/pages.yml:131-133`).
- **Problem:** AC-X3 allows "editing only the config file and enabling Pages and Actions in repo settings". The README also needs these steps:
  - creating or configuring the `github-pages` environment with a required reviewer and a deployment-branch rule;
  - adding the repository variable `GU_DEPLOY_APPROVAL_CONFIGURED=true`;
  - approving a deployment.

  Without the variable the deploy job is skipped, so there is never a page. There is no workflow edit, so that part of X3 holds. Setup is now 12 steps, so the 15-minute bound is plausible but unproven.
- **Expected:** either the spec allows these settings (my recommendation: amend AC-X3 to say "enabling Pages and Actions, setting the approval reviewer and one repository variable"), or the deploy gate becomes optional for template users.
- **Actual:** there is a gap between the spec and the product. This is a judgment call (high confidence that it's a gap, medium on the fix).

### B3 (minor, frontend-engineer or devops-engineer): the axe fixture set has no "sites skipped because of a config error" state
- **Where:** `site/fixtures/` and `scripts/a11y-check.mjs:93`.
- **Problem:** no fixture has `configErrorCount > 0`, so CI never runs axe on the "We couldn't check N of our sites because of a setup problem" variants. I checked those variants by hand in this run (0 violations, light and dark), so this is a coverage gap, not a defect.
- **Fix idea:** add `site/fixtures/config-error-count.json` (all-up with `configErrorCount: 2`) and a test in `site/render.test.js` that pins the expected headline.

### B4 (minor, devops-engineer / manager, go-live blocker for M1): dogfood targets are still placeholders
- **Where:** `monitor.config.json:7-8` (`https://example.com/`, `https://example.org/`).
- **Problem:** M1 needs the team's own Pages sites plus at least one site not on GitHub. Owned by T19, listed here so it isn't missed.

### B5 (minor, backend-engineer): the stale issue quotes the single-site page sentence
- **Where:** `src/issues.js:367`.
- **Problem:** the body says the page told visitors "…so we don't know if **it's** working." With 2 or more targets, the page headline actually says "…so we don't know if **things are** working" (`site/render.js:452`), and each card uses the "it's" form. The design §10.3 text has the same wording, so this is a copy accuracy nit. Suggested: "…the status page told visitors that we haven't been able to check recently."

### Nits
- **N1 (frontend):** a "Check again" button shows in every loaded state. Design §4.5 and §6.6 put the retry button only in the load-error state. Architecture §10 does mention a manual "Check again", so this may be intended. Confirm with the UX designer. axe and keyboard checks pass with it.
- **N2 (backend):** the config-error update comment says "There are now 1 problem(s)." That's fine, but the same comment is posted when the list changes and the count stays the same, so the owner can't tell from the notification what changed.
- **N3 (docs):** `README.md` says the default `siteName` is "Your repository's name". It is: `site/render.js:219` falls back to the repo name. But the shipped `monitor.config.json` sets `"siteName": "gnosh"`, so template users get "gnosh" until they edit it. README step 6 tells them to replace the whole file, so this is low risk.

## Criteria table

Status: **PASS** (evidence produced in this run), **FAIL**, or **NYV** (not yet verifiable without a live repo or deployed page; the live check is in the next section). "Local" means the local part passes.

### Configuration (C)
| AC | Status | Evidence |
|---|---|---|
| C1 | **NYV** (local PASS) | `test/cli.test.js:147` (a new target is in the data after 1 run). In my E2E run 27, a new target was in the data after the first run. Live: L1. |
| C2 | PASS | `test/ssrf.test.js:77` table (`file:`, `ftp:`, `gopher:`, `data:`, `javascript:`). The `validate` CLI rejects `ftp://` with "The address must start with https:// or http://." (`e2e/ka.mjs` output). |
| C3 | PASS | `test/ssrf.test.js:30, :77, :93, :123` cover every range and encoding, with every encoding rejected. `test/check.test.js:59, :73, :130, :138` show zero requests to blocked hops. `validate` rejected `http://169.254.169.254/` and `http://0x7f.0.0.1/`. In E2E runs 27 and 28, a redirect to a name resolving to `10.0.0.5` gave `blocked redirect`, and the local server saw **0** requests for that host. CI on Node 24: "✔ WHATWG URL normalizes non-canonical IPv4 forms on this Node version". |
| C4 | PASS | `test/ssrf.test.js:77` (userinfo). `src/ssrf.js` checkUrlSyntax. The config-error body never repeats the bad URL (`test/issues.test.js:234`, and my `issue-config-error-v1.md`). |
| C5 | PASS | `test/check.test.js:42, :59, :81, :91, :106`. In E2E, a blocked redirect hop was never requested. |
| C6 | **NYV** (local PASS) | `test/cli.test.js:61` (3 runs, 1 open issue, exit 0). In E2E runs 18 to 23, 3 runs with 2 bad entries gave exactly 1 open `config-error` issue, every run exited 0, and the valid targets were checked. When the list changed, the body was edited and a comment added. The issue closed with a comment on the first valid run. Push/PR side: `validate` exits 1 and lists each entry with its line and reason, on stdout and in `$GITHUB_STEP_SUMMARY`. See B1 for copy. Live: L3. |
| C7 | PASS | `test/config.test.js:29` (21st invalid, first 20 checked). |
| C8 | PASS | `test/config.test.js:40`. `validate` gave "Another site already uses this name" for `Shop` and `shop`. |
| C9 | PASS | `test/config.test.js:48, :56` (cron `*/3` is an error, 15 is assumed). The interval is derived from the cron (ADR-0007). |
| C10 | PASS | `test/check.test.js:114` (rebinding), `:240` and `:278` (real transport, lookup called once). CI Node 24: "✔ real transport: connects to the pinned address, sends the original Host header, lookup called once, body never read" and "✔ pinnedLookup works under Node http with autoSelectFamily on and off". In E2E the transport saw only the validated IPs (`shop.example.net:18080->93.184.216.34`, …), with one resolve per hop. |
| C11 | PASS | `checkTarget` takes `resolver` and `transport` (`src/check.js:221`). `main()` takes `deps.resolver` and `deps.transport` (`src/cli.js:145`). My E2E used both. |
| C12 | PASS | `test/config.test.js:89, :103, :109, :241`. SC-2 (`contactLink`) is accepted. |

### Checking (K)
| AC | Status | Evidence |
|---|---|---|
| K1 | PASS | `test/check.test.js:36, :42, :53, :145`. In E2E, 200 was up, 503 and 500 were down as `HTTP 503` and `HTTP 500`, a hang was `timeout`, and a blocked redirect was down. |
| K2 | PASS | Default 10 s (`src/config.js:20`). With `timeoutSeconds: 2`, every E2E run that included the hanging target took about 2,005 ms and recorded `timeout`. The issue text says "No answer within 2 seconds (timeout)". |
| K3 | PASS | `src/transport.js:378-383` destroys the response after reading only status and Location. E2E: `leakInIssues: false` and `leakInData: false` for the body and header markers the server sent. |
| K4 | PASS | `test/check.test.js:160`. E2E run 1: Slow hung while Shop and Blog were recorded `up` in the same run. |
| K5 | **NYV** (local PASS) | `.github/workflows/monitor.yml:14-16` (`concurrency: monitor`, no cancel). Dedupe is by label listing plus marker (`src/issues.js:192-214`). `test/cli.test.js:82, :93`. Live: L2. |

### Alerts (A)
| AC | Status | Evidence |
|---|---|---|
| A1 | **NYV** (local PASS) | Only `GITHUB_TOKEN` (`test/workflows.test.js:42, :61`). Only issues authored by `github-actions[bot]` are touched (`src/issues.js:77`). Live: L4 (that the real author login and type match `isBotIssue`). |
| A2 | PASS | E2E: Shop failed at runs 2 and 3, and issue #2 "Shop is down" opened at run 3 with the address, the first failed check (UTC) and the reason (`issue-outage.md`). |
| A3 | PASS | E2E runs 3 to 6: 4 more failures, still 1 open Shop issue. `test/state.test.js:49`. |
| A4 | PASS | E2E run 7: a recovery comment with first failure, recovery time, "Outage length about …" and failed-check count, then closed with `state_reason: completed`. |
| A5 | PASS | `test/state.test.js:39`. In E2E run 8, a single Blog failure opened nothing. |
| A6 | PASS | E2E: all 3 labels were created with the design descriptions (`results.json` `labels`). `test/issues.test.js:60`. |
| A7 | PASS | E2E runs 10 to 14: a person closed #3 during the outage. It was not reopened and nothing new opened while the site stayed down (runs 10 and 11). On recovery (run 12), the SC-8 comment went on the closed issue without "Closing this issue." The next outage opened a new #4 (run 14). |
| A8 | PASS | E2E leak markers were absent from every issue body and comment. Reasons come from the fixed vocabulary (`src/reasons.js`). |
| A9 | **NYV** (logic and copy PASS) | Logic: `test/state.test.js:104`. In E2E, the issue opened on the 2nd completed run after the first failure. Copy: README lines 6 and 28 ("about 30 to 60 minutes … sometimes later"), page About text (rendered: "When a site stops working, the people who run it usually find out about 30 to 60 minutes later, sometimes later than that."). Field measurement: L9. |

### Status page (P)
| AC | Status | Evidence |
|---|---|---|
| P1 | **NYV** | `has_pages: false` on the repo today, and the pages run on `025a363` skipped deploy because the variable isn't set yet. Built page renders without login locally. Live: L6. |
| P2 | PASS | In every state the first element in `<main>` is `H1#headline`, and there is exactly 1 `h1`. Rendered: all-up "Everything is working. We last checked 6 minutes ago, at 14:05 UTC." One-down "Shop is not working right now. Everything else is working. We last checked …". Stale "We haven't been able to check recently, so we don't know if things are working. Our last check was 5 hours ago, at 09:10 UTC." (SC-5 order). |
| P3 | PASS | Cards in Playwright show name, state words ("Working", "Not working", the stale sentence, "Not checked yet" from SC-9), and "Last checked N minutes ago, at HH:MM UTC." |
| P4 | PASS | 7- and 90-day lines on every checked card. `site/render.test.js:151` covers "Not checked this day" and exclusion. In the never-checked fixture the summary is "not checked on 90 days" with no percentage. |
| P5 | PASS | The p5-95-5 fixture renders "Last 7 days: 95.0% working". Round-down (SC-6): `site/render.test.js:143`, and real CLI data with 1 of 6 checks ok shows "16.6%". |
| P6 | PASS | The About section renders "We check each site about every 15 minutes. Checks can be late …", the check-time caveat, and the A9 latency. |
| P7 | PASS | One-down: the problem list and card link to `https://github.com/gn0sh/gnosh-uptime/issues/42`. No link for a human-closed issue (`site/render.test.js:199`). |
| P8 | **NYV** (design PASS) | `monitor.yml` has no pages or id-token permission and no deploy (`test/workflows.test.js:110`). The page fetches at view time with `cache: no-store` (`site/app.js:262`). Live: L7 (T15). |
| P9 | PASS | 404, malformed JSON and the wrong-version fixture all render "We can't load the status right now.", with no cards and a "Try again" button. A hanging fetch went from "Getting the latest status…" (`aria-busy=true`) to the load error at 15 s. A refresh failure after a good load keeps the data and adds the notice "We couldn't get newer information…". It then goes stale after the threshold and never falls back to "working". |
| P10 | PASS (manual screen-reader pass not done) | axe-core (wcag2a/aa, 2.1, 2.2, best-practice): **0 violations** in 15 states (light) and 5 states (dark, 640 px at 2× scale). CI axe: 0 violations in 13 cases. Horizontal overflow is **0 px** at 320, 360 and 640 CSS px in every state, also with all `<details>` open. The tab order is button, problem link, card outage link, then each `summary`, with a 3 px solid focus ring. Each state has a text label plus a distinct icon. Design §7.8 also asks for one manual NVDA/VoiceOver pass, which I did not do. Recommended in T19 (L10). |
| P11 | PASS | "Questions? Open an issue on GitHub." shows right after the headline in every state, including load error (SC-7, from the build-time meta). |

### Staleness (S)
| AC | Status | Evidence |
|---|---|---|
| S1 | PASS | The time sentence is in every loaded headline (see P2). |
| S2 | PASS | The page clock was moved +60 min with no reload and the data frozen. The headline changed to the stale sentence, the title became "Not checked recently – gnosh status", both cards showed the stale wording, and the announcer said "Update: We haven't been able to check recently…". `site/render.test.js:94`. |
| S3 | PASS | Stale fixture: the bordered notice, and the cards show the stale wording plus "When we last checked, 5 hours ago at 09:10 UTC, it was working." (and "…it was not working."). The threshold must be at least 2 × interval (`src/config.js:196-200`). SC-3 per-target: `site/render.test.js:125`. |
| S4 | PASS | No "Everything is working" and no bare "Working" label in the stale and S2 runs above. |
| S5 | **NYV** (automated parts PASS) | (a) `test/keepalive.test.js:13` (60 days, half the runs dropped, gap far below 60 days). (b) `test/workflows.test.js:142` (`actions: write`, `contents: read` only). (c) `e2e/ka.mjs`: HTTP 403 exits 0, writes `::warning::Keepalive failed (HTTP 403)…` and adds a summary line linking `#if-checks-stop`. The README section exists (`README.md:243`), and the stale page links to it (`stalelink` = `https://github.com/gn0sh/gnosh-uptime#if-checks-stop`). Whether the enable call resets the 60-day timer can't be shown before day 60 (R4): L8. |
| S6 | PASS | `grep -i -E "guarantee\|real[- ]time\|every 5 minutes exactly\|before (your )?users\|instant\|\blive\b\|always\|immediately\|24/7\|continuous"` over README, page, issue, summary and config text matched only "It's not instant" (a negation), `aria-live` (an attribute) and a code comment. |
| S7 | **NYV** (local PASS) | E2E runs 16 and 17: stored last run 13:37, next run 16:52, giving exactly 1 issue "Monitor was stale from 2026-10-28 13:37 UTC to 2026-10-28 16:52 UTC". Its body has "**3 hours 15 minutes**" and the `#if-checks-stop` link. The second run opened none. `test/cli.test.js:106, :119`. Live: L5. |

### Data (D)
| AC | Status | Evidence |
|---|---|---|
| D1 | **NYV** (local PASS) | E2E: 29 data writes, all to `monitor-data`. The only branch the fake saw was `monitor-data`. `test/datastore.test.js:107`. Live: L4. |
| D2 | PASS | Exact key sets (`src/datastore.js:24-25`). Per day `[date, checks, ok]` for at most 90 days. No per-check records. The extra header fields are config values, not check data. |
| D3 | PASS | Re-ran `node test/sim/history-growth.mjs --no-git` (365 days × 96 runs × 20 targets): max **57,141 B**, "AC-D3 current tree < 1 MB: PASS (margin x18.4)", header 1,741/2,048 B, record 892/1,024 B. T14's lone-surrogate gap (B4) is closed by `test/datastore.test.js:229` and `\p{Cs}` in `src/config.js:29`. Git growth: T14 measured about 24 MiB a year. |
| D4 | PASS | `test/cli.test.js:178` and `test/state.test.js:135`: a removed target is gone after 1 run and its open issue is closed. |
| D5 | PASS | `test/cli.test.js:130, :140`. SC-11 E2E runs 24 and 25: an unparseable config wrote nothing (`unparseableKeptData: true`) and exited 0. The page validates shape and falls back to P9. |

### Security (SEC) and constraints (X)
| AC | Status | Evidence |
|---|---|---|
| SEC1 | PASS | The long-names fixture name `<img src=x onerror=alert(1)>"&'<script>alert(2)</script>` showed as literal text in the h1, title, card and link. 0 `img`, `b` or `script` elements were in `main`, 0 dialogs fired, and there were 0 CSP errors. `site/security.test.js:11` (no `innerHTML` and similar). |
| SEC2 | PASS (local); render check L4 | E2E issue #8. Title: `@​octocat [x](https:​//evil.example) <b>#​1 is down`, with U+200B after `@` and `#` and inside `://`. Body: the name is inside a code span. `test/issues.test.js:18, :30, :40, :197`. |
| SEC3 | PASS | `test/workflows.test.js:35, :42`. By reading, all three workflows have no `${{ }}` inside any `run:`. |
| X1 | PASS | Only Actions, Pages and Issues. `test/smoke.test.js:5` (no dependencies). axe is a CI-only lockfile tool. |
| X2 | PASS | `permissions: {}` and minimal grants per job (`test/workflows.test.js:61`). README "Permissions" table (`README.md:290-302`) matches the workflows. |
| X3 | **NYV** + B2 | No workflow edit is needed, but the setup needs extra settings (B2). Timed run: L11. |
| X4 | PASS | `README.md:304-313`: the differences, a link to Upptime, and "this isn't a claim that it doesn't". |

### UX changes and manager decisions
| Item | Status | Evidence |
|---|---|---|
| JSON config + plain errors with line numbers | PASS | `validate` gave "Line 3, Site #1 "Shop": …". Unparseable config issue: "(line 3) … At column 59: There is an extra comma after the last item in a list. Remove it." |
| SC-1 names of 50 characters or fewer | PASS | `test/config.test.js:167`, `src/config.js:270` |
| SC-2 `contactLink` | PASS | `test/config.test.js:109`, `site/render.test.js:306` |
| SC-3 per-target stale | PASS | `site/render.test.js:125` |
| SC-4 WCAG 2.2 AA, 320 px | PASS | axe `wcag22aa` tags plus the 320 px reflow above |
| SC-5 relative time first | PASS | rendered headlines |
| SC-6 round down | PASS | "16.6%", `site/render.test.js:143` |
| SC-7 contact shown on load error | PASS | Load-error run: contact "Questions? Open an issue on GitHub." |
| SC-8 recovery comment on a person-closed issue | PASS | E2E `issue-outage-human-closed.md` |
| SC-9 "Not checked yet" | PASS | never-checked and partly-checked fixtures |
| SC-10 60 s recompute, 5-min refetch | PASS | S2 run (recompute). The "open tab sees recovery" run (refetch at +5:01 showed "Everything is working." and announced "Update: Everything is working."). |
| SC-11 unparseable config: issue, keep data, go stale | PASS | E2E runs 24 to 26 |
| E1 keepalive via the enable API | PASS (logic) / NYV (effect, L8) | see S5 |

## Live checks for go-live (T19)

Do these on `gn0sh/gnosh-uptime` after the owner setup checklist, and record the results in the T19 log. L1 to L5 can use a short-lived test target (for example a page on a team Pages site that you can break, or an `https://httpstat.us/503`-style public URL).

- **L1 (C1).** Add a new valid target on the default branch. Within 2 completed `monitor` runs, it must be in `monitor-data/status.json` and on the page.
- **L2 (K5).** With a target that is down, click **Run workflow** on `monitor` twice in a row. Exactly 1 open `outage` issue should exist. In the Actions UI, the second run should be queued (or replaced), not run in parallel.
- **L3 (C6).** Commit one bad entry, then dispatch 3 runs. Expect:
  - every run green;
  - exactly 1 open `config-error` issue;
  - the push's `validate` run red, with the entry and its line in the summary;
  - after the fix, the next run closes the issue with a comment.
- **L4 (A1, D1, SEC2).**
  - **Issue author:** opened issues must be authored by `github-actions[bot]` with type `Bot`. Otherwise `isBotIssue` ignores them and duplicates would open every run, so this is the most important live risk.
  - **D1:** after at least 10 runs, `git log` of the default branch has no commits by the workflow, and every data commit is on `monitor-data`.
  - **SEC2:** a test target named `@octocat [x](https://evil.example)` renders inert on github.com, with no mention notification, no link and no cross-reference. Remove it afterwards.
- **L5 (S7).** On the data branch, set `lastRunAt` to 3 hours ago. This is a manual commit to `monitor-data` by the owner and needs the `monitor-data` ruleset to allow it, or a temporary test branch or repo. Then dispatch 2 runs. Exactly 1 `monitor-stale` issue should exist, with the right from/to and the `#if-checks-stop` link working on github.com.
- **L6 (P1).** First Pages deploy through the approval gate (owner, hard stop 1). Open the page logged out (private window). Check that the CSP allows the raw fetch, and that the README anchors `#setup` and `#if-checks-stop` work from the page and from issues.
- **L7 (P8, R5, T15).**
  - Re-measure the `raw.githubusercontent.com` `cache-control` header.
  - After a run that changes a state, a fresh page load shows the change within 10 minutes of the run finishing.
  - The Pages deployment history shows no deployment for that run.
- **L8 (S5, R4).** Record the date of the last human commit. Watch the workflow past 60 days without a human commit. If it is disabled, apply the pre-approved fallback (one `[keepalive]` commit a month).
- **L9 (A9, M1).** For each real or simulated outage over 30 days, record issue `created_at` minus "First failed check" in the body. Report the median and maximum. Include at least one non-GitHub target.
- **L10 (P10, design §7.8).** One manual screen-reader pass (NVDA + Firefox, VoiceOver + iOS Safari) on the live page in the one-down and stale states. The headline must be read first.
- **L11 (X3).** A tester who hasn't seen the project creates a new repo from the template on an existing account, follows only the README, and times it. Pass if there's a live page for one URL in 15 minutes or less with no workflow edit. The repo must be marked as a template first: today `is_template: false`. B2 must be decided first.
- **L12 (keepalive in the real job).** The first scheduled `keepalive` job logs "the scheduled workflow was confirmed as enabled". So far no `monitor` run exists on the repo (the API lists 5 runs, all `validate` and `pages`).

## How it was tested

1. **`npm test` (Node 22.22.0, local):** `# tests 339 # pass 339 # fail 0`, exit 0.
2. **CI evidence (read-only):** GitHub API `actions/runs`, plus the job logs for 123188783786 (`validate`) and 123188783216 (`a11y`) on `025a363`:
   ```
   Found in cache @ /opt/hostedtoolcache/node/24.22.1/x64
   node: v24.22.1
   ✔ real transport: connects to the pinned address, sends the original Host header, lookup called once, body never read
   ✔ pinnedLookup works under Node http with autoSelectFamily on and off (lookup called once each)
   ✔ WHATWG URL normalizes non-canonical IPv4 forms on this Node version
   ℹ tests 339  ℹ pass 339  ℹ fail 0
   ... ok http://127.0.0.1:37593/stale/: 0 violation(s), 0 serious/critical ... Data fetched for all 13 cases.
   ```
   The pages run on `025a363` built successfully and skipped deploy. The earlier pages run on `e03c90c` had failed.
3. **CLI end to end (`e2e/run.mjs`).**
   - **What runs:** `main(['run'], deps)` from `src/cli.js` with the `FakeGitHub` client from `test/helpers/fake-github.js`, a 15-minute fake clock, and the real `.github/workflows/monitor.yml` for the interval.
   - **Resolver:** returns public IPs for `*.example.net`, and `10.0.0.5` for the redirect target.
   - **Transport:** the real `makeTransport()`, wrapped only to swap the pinned public IP for `127.0.0.1` (port 18080).
   - **Scenarios:** 28 runs. Run log excerpt:
   ```
   run 3 [Shop 503 #2 -> open] exit=0 | Shop:down/2/HTTP 503/#2 ... | open outage=2
   run 7 [Shop recovers] exit=0 | Shop:up/0/-/#- ...
   run 10 [Blog down, person closed issue] | Blog:down/3/HTTP 500/#3S
   run 14 [Blog down again #2 -> new issue] | Blog:down/2/HTTP 500/#4
   run 16 [after 3h gap #1] | stale=1     run 17 | stale=1
   run 18-20 [2 bad entries] exit=0 | cfg-open=1   run 23 [config fixed] | cfg-open=0
   run 24-25 [invalid JSON] exit=0 1ms (nothing checked, nothing written)
   run 28 [hostile name, redirect to private #2 -> open] | ...:down/2/blocked redirect/#8
   ```
   - **Issue bodies compared with design §10:** title and body structure, tables, "What happens next", the footer, the recovery table, the stale body with the README link, the config-error table with "Site 4 **Bad scheme** (line 22)", the bad URL not repeated, the update comment and the close comment. They match the design, apart from accepted architecture changes (no page URL in the outage body, an added "Only people with access…" line, issues locked) and B1 and B5.
4. **Keepalive and validate CLI (`e2e/ka.mjs`).**
   - **Keepalive:** with 204, one `PUT …/actions/workflows/monitor.yml/enable` and exit 0. With 403, exit 0 plus a `::warning::` and a summary line.
   - **Validate:** exits 1 and lists 4 problems with line numbers, and the summary is Markdown-inert.
5. **Page (`page.mjs`, `dark.mjs`).**
   - **Build:** `GITHUB_REPOSITORY=gn0sh/gnosh-uptime node scripts/build-site.mjs` produced "Built _site/ with 4 files: app.js, index.html, render.js, style.css" with the data URL `https://raw.githubusercontent.com/gn0sh/gnosh-uptime/monitor-data/status.json` in the meta.
   - **Load:** `_site/` was served from a local HTTP server and opened in Chromium with its CSP active. `page.route('https://raw.githubusercontent.com/**')` served the fixtures. `page.clock` was set to the fixture time (2026-10-28 14:12 UTC).
   - **Checks:** axe-core injected with `page.evaluate`. Screenshots are in the scratchpad `shots/` folder.

## Assumptions
- A criterion that needs GitHub's real behaviour (scheduling, issue authorship, rendering, Pages, CDN caching, the 60-day rule) is NYV even when its logic passes locally. Each NYV row says what passes locally.
- 640 CSS px at 2× device scale stands in for 200% zoom on a 1280 px window. Real browser zoom was not driven.
- axe-core 4.10.3 (scratchpad) differs from the CI's `@axe-core/cli` 4.13.0. Both report 0 violations.
- I added no tests to the repo. The gaps I found are reported as B3 (fixture) and B1 (test cases to add with the fix), for the owning engineers.
