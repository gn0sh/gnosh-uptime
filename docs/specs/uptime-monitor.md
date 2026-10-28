# Spec: uptime-monitor (MVP)

- **Repo:** `gn0sh/gnosh-uptime` (public)
- **Owner:** Product Manager
- **Status:** Draft v2. Includes the first red-team pass, plus the second Brain Trust review (Skeptic, Opponent, Operator, Budget Hawk) and a 5-persona Focus Group. See §14, "Changes from review".
- **Priority:** MVP, unless an item is listed under "Later"

---

## 1. Problem statement

People who run one or a few small websites (hobby projects, small-business sites, side projects) often hear about an outage from their own users, sometimes hours after it started. While the site is down, they have nowhere to send people for a status update. Paid monitoring costs money and needs new accounts. A self-hosted monitor means running a server, and that server can go down too.

The product is an uptime monitor and public status page that runs entirely on free GitHub features in one public repository:

- a scheduled GitHub Actions workflow checks a configured list of URLs,
- per-day check counts and current state are stored on a separate data branch,
- a static status page on GitHub Pages loads that data when someone views it and shows current status and uptime history,
- outages, stale-monitor gaps, and config errors are reported as GitHub Issues. The workflow opens them, and closes outage and config-error issues itself once the problem clears.

It costs $0, needs no accounts beyond GitHub, and needs no secrets beyond the built-in `GITHUB_TOKEN`.

**Honesty constraint, which shapes the whole product:** free scheduled Actions are best-effort. Runs can be delayed or skipped, and GitHub disables scheduled workflows in a public repo after 60 days without repository activity. With default settings, the owner typically learns about an outage **30 to 60 minutes** after it starts, and sometimes later. This is "find out within the hour without watching the site", not "find out before your users". The product must never claim more than this, and it must tell both the page visitor and the owner when it has not been checking.

## 2. Users and personas

| Persona | Description | Main need |
|---|---|---|
| **P1: Small-site owner (primary)** | Runs 1 to 5 small sites. Has a GitHub account and can create a repo from a template and edit a config file. Not an ops engineer. | Find out about outages within about an hour, at $0, without running infrastructure. Find out if the monitor itself stops. |
| **P2: Site visitor during an outage** | A user of P1's site who hit an error. May not be technical, may use a screen reader or zoom, and has no GitHub account. | One public page that says in plain words whether the site is working, and when it was last checked. |
| **P0: First real user (the team)** | Monitors its own deployed GitHub Pages sites (e.g. `https://gn0sh.github.io/...`-style URLs) and at least one site not hosted on GitHub. Exact targets are set in config. | Dogfood the product end to end. This is the team's first end-to-end project. |

**Out of scope:** owners without a GitHub account, or who aren't comfortable with "repo" and "config file". The Focus Group's bakery-owner persona couldn't get past the word "repo". Onboarding for that persona is under "Later" (§13).

## 3. Goals and non-goals

### Goals (MVP)
1. Check each configured URL on a schedule and record whether it is working or not.
2. Open a GitHub Issue when a target goes down, and close it automatically when the target recovers.
3. Publish an accessible, plain-language public status page. It shows current status per target, the time of the last actual check, and uptime history.
4. Never let a stale monitor pass as a healthy site. Prevent GitHub's 60-day schedule disable where possible. Tell the owner through an Issue when the monitor was stale. Show the stale state on the page.
5. Treat config as untrusted input. Only well-formed public http/https URLs are ever requested, and config values are never executed or rendered as markup.
6. Stay within $0, no new accounts, and only `GITHUB_TOKEN`.

### Non-goals (MVP)
- Email, Slack, Discord, SMS, webhooks, push, or any notification channel other than GitHub Issues. Owners get alerts through GitHub's own notifications for issues on repos they watch.
- A fully external dead-man's switch, meaning something outside GitHub Actions that alerts when no runs happen at all. That needs an outside account and is under Later (it would need owner approval).
- Monitoring private, internal, or authenticated endpoints. Config and results are public by design.
- Checking more often than every 5 minutes, checking from multiple regions, or latency SLOs.
- Checks other than HTTP(S): TCP, ping, DNS, TLS expiry, keyword or content assertions.
- Incident posts or maintenance windows written by hand on the status page.
- Custom domains, theming, or branding beyond the repo or site name and an optional owner-contact line.
- A hosted multi-tenant service. Each owner runs their own copy of the repo.
- Choosing implementation technologies beyond Actions, Pages and Issues. That is the architect's call.

## 4. Success metrics

- **M1 (dogfood):** the team runs the monitor for 30 days in a row against its own sites, including **at least one target not hosted on GitHub**. Every real or simulated outage longer than 2× the check interval leads to an opened issue. Outage-to-issue time is recorded for each one (see AC-A9).
- **M2 (honesty):** during those 30 days, the status page never shows a target as working while the last completed run is older than the staleness threshold (verified by AC-S2 to S4). Every gap longer than the threshold produces exactly one stale-monitor issue (AC-S7).
- **M3 (alert quality):** at default settings, at most 1 false-positive outage issue per target per 30 days.
- **M4 (cost):** $0 spent, and no secret configured other than `GITHUB_TOKEN`.

## 5. User stories

- **US1:** As a small-site owner, I want to list my URLs in one config file so that I can start monitoring without writing code.
- **US2:** As a small-site owner, I want a GitHub Issue opened when my site goes down so that I'm notified through GitHub, which I already use.
- **US3:** As a small-site owner, I want the issue closed automatically when my site recovers, with the outage duration recorded, so that I don't have to clean up by hand and I keep an incident record.
- **US4:** As a site visitor, I want one plain sentence at the top of a public page telling me whether the site is working so that I know whether the problem is on their side.
- **US5:** As a site visitor, I want to see when the site was last actually checked so that I can judge how current the page is.
- **US6:** As a small-site owner, I want the page to say plainly when checks have stopped so that a dead monitor is never mistaken for a healthy site.
- **US7:** As a small-site owner, I want the monitor to stop GitHub from disabling its schedule, and to open an issue telling me if it was stale, so that monitoring doesn't stop without me knowing.
- **US8:** As a small-site owner, I want recent uptime history (per day, and as a percentage) so that I can tell whether outages are a pattern.
- **US9:** As a small-site owner, I want monitoring data kept off my main branch, small and bounded, so that my repo history stays clean and the repo doesn't grow without limit.
- **US10:** As a repo owner accepting contributions, I want invalid or dangerous config rejected so that a malicious or careless change can't point the checker at private addresses or inject code or markup.
- **US11:** As a small-site owner, I want a config mistake reported once, clearly, without breaking monitoring of my other sites.
- **US12:** As a site visitor who uses a screen reader or zoom, I want the page to work without relying on color so that I can understand the status.

## 6. Acceptance criteria

All criteria must be testable by QA. Definitions:

- **Interval** means the configured check interval. Defaults are in §7.
- **Run:** wherever an AC says "scheduled run" or "run", a manually triggered run of the same workflow (`workflow_dispatch`) counts the same, unless the AC is specifically about scheduling.

### Configuration (C)
- **AC-C1:** Targets are defined in one config file in the repo. Each target has at least a display name and a URL. After a valid target is added and pushed to the default branch, it appears on the status page within 2 completed runs.
- **AC-C2:** A URL is accepted only if its scheme is `http` or `https`. Any other scheme (`file:`, `ftp:`, `gopher:`, `data:`, `javascript:`, etc.) is rejected.
- **AC-C3:** A URL is rejected if its host is, or resolves at check time to, any address in these ranges:
  - all of `0.0.0.0/8`
  - loopback: `127.0.0.0/8`, `::1`
  - RFC 1918 private: `10/8`, `172.16/12`, `192.168/16`
  - link-local: `169.254/16` (which includes `169.254.169.254`), `fe80::/10`
  - carrier-grade NAT: `100.64/10`
  - unspecified: `::`
  - IPv6 unique-local: `fc00::/7`
  - multicast and broadcast
  - the cloud host-agent address `168.63.129.16`
  - **IPv4-mapped or IPv4-compatible IPv6 forms** of any blocked IPv4 address (e.g. `::ffff:127.0.0.1`, `::ffff:7f00:1`)

  An IP literal written in **non-canonical form** must be normalized before the check and rejected if it falls in a blocked range. That covers decimal (`2130706433`), octal (`0177.0.0.1`), hex (`0x7f.0.0.1`), and short dotted forms (`127.1`). A host that is `localhost`, or ends in `.localhost`, `.local` or `.internal`, is also rejected.

  **Test:** at least one config entry per range and per encoding. Each one is rejected, and the injectable HTTP client (AC-C11) records zero requests to it.
- **AC-C4:** A URL is rejected if it contains userinfo (`user:pass@host`), because config and results are public.
- **AC-C5:** Redirects are followed one hop at a time, up to 5 hops. More than 5 hops counts as down. Every hop's URL goes through AC-C2 to C4. A hop to a rejected address makes the result "down (blocked redirect)", and that address is never requested.
- **AC-C6 (validation by trigger):**
  - On **push or pull request** that changes the config, validation runs. If any entry is invalid, that run fails, and each invalid entry is reported by name with a readable reason in the run summary.
  - On **scheduled runs**, invalid entries are skipped and every valid target is still checked. A bad config does **not** make scheduled runs fail.
  - Instead, exactly one open issue labeled `config-error` exists while the config has any invalid entry. It lists each invalid entry and its reason, and is updated when the list changes.
  - The first run after the config becomes fully valid closes that issue with a comment.
  - **Test:** 3 scheduled runs with one bad entry produce exactly 1 open `config-error` issue, and all 3 runs finish successfully.
- **AC-C7:** At most 20 targets are allowed. Entries beyond 20 are invalid under AC-C6.
- **AC-C8:** Target names must be unique, because names identify targets in issues and data. Duplicates are invalid under AC-C6.
- **AC-C9:** The check interval cannot be set below 5 minutes (GitHub's minimum schedule granularity). A lower value is a config error under AC-C6.
- **AC-C10 (connect to the validated IP):** for each hop, the address that passed validation is the one connected to. The host is not resolved again between validation and connection, so DNS rebinding can't swap in a blocked address. TLS still checks the original hostname. **Test:** an injectable resolver returns a public IP during validation and a loopback IP on any later lookup. The injectable HTTP client records a connection only to the public IP.
- **AC-C11 (testability):** the checker accepts an injectable DNS resolver and HTTP client, so QA can prove in automated tests that rejected targets and hops are **never requested**.
- **AC-C12:** Config may include an optional owner-contact line, shown on the status page.
  - It is plain text of at most 200 characters.
  - If it contains a link, the link must be `https:` or `mailto:`.
  - Anything else is a config error under AC-C6.

### Checking (K)
- **AC-K1:** In each run, each valid target gets one HTTP(S) check. It is **up** if the final response, after validated redirects, is 2xx within the timeout. Otherwise it is **down**: non-2xx final status, timeout, DNS failure, TLS error, connection error, or blocked redirect.
- **AC-K2:** The per-request timeout is configurable, with a default of 10 s. A target that exceeds it is recorded as down with reason "timeout".
- **AC-K3:** The monitor never stores or republishes response bodies or response headers.
- **AC-K4:** One target hanging or failing does not stop the other targets from being checked in the same run. **Test:** one target that never responds plus one healthy target. The healthy one is recorded as up in the same run.
- **AC-K5 (no overlapping runs):** at most one monitor run executes at a time. A run that starts while another is in progress waits or is dropped, and never runs alongside it. Issue de-duplication (AC-A3, AC-C6, AC-S7) works by listing open issues with the relevant label, not by in-run memory alone. **Test:** trigger 2 runs back to back against a target that is down. The result is exactly 1 open outage issue.

### Alerts via GitHub Issues (A)
- **AC-A1:** Issues are created, commented on, and closed only by the workflow, using `GITHUB_TOKEN`. No other secret or account is used.
- **AC-A2:** When a target has been down for N checks in a row (configurable, default N = 2), exactly one open issue labeled `outage` exists for it. The title includes the target name and the word "down". The body includes the URL, the time of the first failure (UTC), and the failure reason.
- **AC-A3:** More failed checks while the issue is open do not create more issues. **Test:** 5 failures in a row produce exactly 1 open issue for that target.
- **AC-A4:** On the first successful check after an outage, the workflow comments with the recovery time and the total outage duration, then closes the issue.
- **AC-A5:** With N = 2, a single failed check followed by a success opens no issue.
- **AC-A6:** The labels `outage`, `config-error` and `monitor-stale` are created by the workflow if they don't exist.
- **AC-A7:** If a person closes an outage issue while the target is still down, the workflow does not reopen it. It also opens no new one until the target has recovered and gone down again.
- **AC-A8:** Issue text contains only data the monitor generated itself. Nothing from the remote response (body, headers, error pages) is included.
- **AC-A9 (honest latency):** outage-to-issue time is the time from the start of an outage to the moment the issue is opened.
  - **Logic test (deterministic):** with defaults (15-minute interval, N = 2) and simulated run times, the issue is opened by the 2nd completed run after the outage starts.
  - **Field measurement:** during M1, record outage-to-issue time for each real or simulated outage and report the median and maximum.
  - **Public copy:** the README and the status page's "about these checks" note say that with defaults, owners typically learn of an outage **about 30 to 60 minutes** after it starts, and possibly later when GitHub delays scheduled runs.
  - The phrase "before your users do", or anything like it, appears nowhere in product copy.

### Status page (P)

The words in quotes below are the required meaning. The UX designer may refine the wording but must keep it plain-language.

- **AC-P1:** A public status page is served from GitHub Pages for the repo and can be read without a GitHub account or login.
- **AC-P2 (plain sentence first):** the first content in the page's main region is one plain-language sentence summarizing status. Screen readers announce it before any per-target detail. Examples:
  - "Everything is working. We last checked at 14:05 UTC (7 minutes ago)."
  - "Shop is not working right now. We last checked at 14:05 UTC (7 minutes ago)."
  - "We haven't been able to check recently, so we don't know if it's working. Our last check was at 09:10 UTC (5 hours ago)."
- **AC-P3:** For each target the page shows its display name, its current state in words ("Working", "Not working", or "We haven't been able to check recently, so we don't know if it's working"), and when it was last actually checked (absolute UTC time plus "N minutes ago").
- **AC-P4:** For each target the page shows uptime over the last 7 and 90 days, plus a per-day history for the last 90 days.
  - A day with no recorded checks is labeled in words ("Not checked this day"). It is visually distinct from working and not-working days, and it is left out of the percentage. It is never counted as working.
- **AC-P5:** Uptime % = successful checks ÷ total recorded checks for that target in the window, shown to one decimal place. **Test:** a fixture with 95 successful and 5 failed checks shows 95.0%.
- **AC-P6:** The page has visible text saying that checks run on a best-effort schedule of about every <interval> and may be delayed, that uptime is measured only at check times, and the expected alert latency from AC-A9.
- **AC-P7:** A target with an open outage issue links to that issue from the page.
- **AC-P8 (data refresh is not a deploy):**
  - The page shell (layout and code) is deployed to Pages rarely, and only through the owner-approved production deploy path.
  - Check data lives on the data branch. The page fetches it at view time.
  - A monitor run never triggers a Pages deploy. Because pushes made with `GITHUB_TOKEN` don't trigger other workflows, the design must not depend on a data push starting a deploy.
  - **Test:** after a run that changes a target's state, a fresh page load shows the new state within 10 minutes of the run finishing (allowing for caching). The repo's Pages deployment history shows no new deployment for that run.
- **AC-P9:** If the page can't load the status data (network error, missing or malformed data), it says so in plain words ("We can't load the status right now"). It never falls back to showing targets as working.
- **AC-P10 (accessibility):**
  - Status is never shown by color alone. Every state has a text label, and history days have text alternatives.
  - The page has no horizontal scrolling and loses no content at 200% browser zoom, or on a 360 px-wide viewport.
  - Text and state indicators meet WCAG 2.1 AA contrast.
  - An automated accessibility check (e.g. axe) reports no serious or critical violations.
- **AC-P11:** If the config has an owner-contact line (AC-C12), the page shows it near the top, e.g. "Questions? Contact …".

### Staleness and schedule health (S)
- **AC-S1:** The page shows when the most recent run finished, labeled as the last check (see AC-P2).
- **AC-S2:** Staleness is worked out **in the visitor's browser at view time**, by comparing the last-run timestamp in the fetched data with the current time. It doesn't depend on a new run or deploy. **Test:** freeze the data, move the client clock past the threshold, reload, and the stale state appears.
- **AC-S3:** When the last completed run is older than the staleness threshold (configurable, default 60 minutes, never less than 2× the interval), the page switches to a visually distinct stale state. The summary uses the AC-P2 stale sentence. Each target shows the stale wording plus its last known state and time, never "Working".
- **AC-S4:** In the stale state the page never shows "Everything is working", and never shows any target as "Working" without the stale wording.
- **AC-S5 (keepalive against the 60-day disable):** the product includes an automated keepalive that uses only `GITHUB_TOKEN` to stop GitHub from disabling the scheduled workflow after 60 days without repository activity. The likely mechanism is the workflow-enable API with the `actions: write` permission, not dummy commits; the architect makes the final choice and verifies it against current GitHub docs.
  - **Verification:** an automated test drives the keepalive logic with a mocked GitHub API and fake clock. It must show (a) the keepalive call happens well inside the 60-day window, (b) it asks only for the token permissions it needs, and (c) a failed keepalive call is reported in the run summary. Nobody has to wait 60 days.
  - The README explains how to re-enable the workflow manually, and the page's stale message links to that section.
- **AC-S6:** No product copy (page, README, issue text) claims a guaranteed check frequency or real-time detection. **Test:** search the copy for "guaranteed", "real-time", "every 5 minutes exactly", "before your users", and similar. None of them refer to check timing.
- **AC-S7 (owner is told about staleness):** at the start of each run, the monitor compares the time of the previous completed run with now. If the gap is longer than the staleness threshold, it opens exactly one issue labeled `monitor-stale`, titled "Monitor was stale from <X> to <Y>" (UTC). The body gives the gap length and links to the README's re-enable and limits section.
  - One gap produces one issue. A run with no gap opens none.
  - **Test:** set the stored last-run time 3 hours in the past, trigger 2 runs, and exactly 1 `monitor-stale` issue exists.
  - **Stated limit:** this tells the owner only after the monitor starts running again. If the schedule never resumes, only the page (AC-S3) shows it. Alerting when no runs happen at all needs an external dead-man's switch, which is under Later.

### Data storage (D)
- **AC-D1:** All monitor data is written only to a dedicated data branch, never to the default branch. **Test:** after 10 runs, the default branch has no new commits from the workflow.
- **AC-D2 (aggregates only):** stored data is limited to:
  - (a) per target, per UTC day: number of checks and number of successful checks, for the last 90 days only. Older days are dropped.
  - (b) per target: the last state and time, the reason for the last failure, the current count of failures in a row, the outage start time, and the open outage issue number (if any).
  - (c) the time of the last completed run.

  No per-check raw records are kept.
- **AC-D3 (arithmetic bound):** with 20 targets, the stored data is at most 20 × (90 day-records + 1 state record). Each record has a size the architect states. The current data tree must be **under 1 MB**. Each run's commit changes only today's counts, the state records and the last-run time. No history rewrites (no force-push or squash) are part of MVP. **Test:** after a simulated 1 year of runs at defaults with 20 targets, the current tree is under 1 MB, and the measured `.git` growth attributable to the data branch is reported (see Risk R3).
- **AC-D4:** A target removed from config disappears from the status page within 2 runs. Its stored data is dropped within 90 days.
- **AC-D5:** A run that fails partway leaves the previously published data valid and readable. The page never sees a half-written state, and if it can't parse the data, AC-P9 applies.

### Security and injection (X-SEC)
- **AC-SEC1:** Target names, URLs, the owner-contact line, and every other config or stored value are rendered on the page **as escaped text only**. They are never inserted as HTML (no `innerHTML` or equivalent).
  - **Test:** a target named `<img src=x onerror=alert(1)>` shows as literal text and runs nothing.
- **AC-SEC2:** Config values put into issue titles and bodies are escaped or neutralized, so they can't inject Markdown links, mentions (`@user`), or HTML into issues.
  - **Test:** a name containing `@octocat [x](https://evil.example)` appears as inert text and notifies nobody.
- **AC-SEC3:** Config and stored data are never interpolated into workflow `run:` steps through `${{ }}` expressions. Untrusted values only reach steps as data, e.g. environment variables or files.
  - **Test:** a review or lint of the workflow files finds no `${{ }}` expression inside `run:` that references config-derived values.

### Constraints (X)
- **AC-X1:** The whole system runs in one public GitHub repo, using only GitHub Actions, GitHub Pages and GitHub Issues. It needs no paid plan, external service, or account.
- **AC-X2:** It needs no repository or environment secret other than the automatically provided `GITHUB_TOKEN`. Each workflow asks only for the token permissions it needs, and the README lists them.
- **AC-X3:** Following the README, a tester creates a **new repo from the template under an existing GitHub account** (no new accounts). By editing only the config file and enabling Pages and Actions in repo settings, they reach a live status page for one URL. **Test:** this takes 15 minutes or less, with no workflow-file edits.
- **AC-X4 (positioning in README):** the README says plainly how this differs from Upptime: the owner is told about stale periods through an issue, the visitor page is plain-language and accessible, and only aggregate data is stored. It links to Upptime for people who want more features. It makes no claims about what Upptime lacks.

## 7. Defaults (product decisions)

| Setting | Default | Rationale |
|---|---|---|
| Check interval | 15 min (min 5) | Cron is best-effort, each run writes data, and runs should stay infrequent (Risk R1). Owners who want faster checks can choose down to 5 min. |
| Failures before issue (N) | 2 in a row | Avoids issues from one-off network blips (M3). This plus the interval and cron delay gives the ~30 to 60 min alert latency (AC-A9). |
| Request timeout | 10 s | Typical for small sites. |
| Staleness threshold | 60 min (≥ 2× interval) | Leaves room for routine cron delays before showing or reporting stale. |
| Day history kept | 90 days | Matches the 90-day history view. |
| Max targets | 20 | Keeps run time and data bounded for the main persona (1 to 5 sites). |

## 8. Competitor: Upptime

[Upptime](https://github.com/upptime/upptime) is a mature, popular open-source project with essentially the same architecture: GitHub Actions checks, GitHub Issues for incidents, and a GitHub Pages status site. People who want more features should use it, and our README links to it (AC-X4). We are building our own mainly because it is the team's first end-to-end project and a dogfooding exercise, not because we expect to beat Upptime. Our deliberate, narrow differences:

- the owner gets an issue telling them the monitor was stale,
- a plain-language, accessible page for visitors, which treats stale and no-data honestly,
- aggregate-only data on a separate, size-bounded data branch,
- strict handling of config as untrusted input.

We have not audited how Upptime handles each of these, so we make no claim that it lacks them.

## 9. Assumptions

1. Owners already have a GitHub account and can create a repo from a template and edit a file. Visitors (P2) need no account.
2. GitHub Actions minutes for standard runners stay free for public repos. The cron schedule has a 5-minute minimum and is best-effort, so delays of 10+ minutes and occasional skipped runs are expected.
3. "Notification" for the owner means GitHub's standard notifications for issues in a repo they own or watch. The README must tell owners to watch the repo and check their notification settings.
4. Monitored URLs and their status are public. Owners who can't accept that are out of scope.
5. Checks come from GitHub-hosted runners, whose IPs and location vary. Sites that block datacenter IPs or bots may show as down. The README documents this.
6. "Working" is judged on HTTP status only (AC-K1). Content correctness is out of scope.
7. Times are stored in UTC. "N minutes ago" is computed in the visitor's browser.
8. The team's own GitHub Pages sites plus at least one site not on GitHub are the first targets. Exact URLs are set in config.
9. The page can read data from the data branch at view time without any secret, because the repo is public. The architect confirms the mechanism and its caching behavior against AC-P8's 10-minute bound.
10. The workflow-enable API, called with `GITHUB_TOKEN` and `actions: write`, resets or prevents the 60-day inactivity disable. This is **unverified**, and the architect must confirm it (AC-S5).

## 10. Risks

- **R1: GitHub Actions terms (medium confidence, grey area).** GitHub's terms restrict using hosted runners for activity unrelated to the repo's software project. An uptime monitor whose repo *is* the monitoring project is arguably in scope, and Upptime operates the same way, but this isn't certain. Mitigations: keep checks infrequent (15-minute default, 20-target cap), and don't market this as a bulk or high-frequency monitoring service. Revisit if GitHub's terms or enforcement change.
- **R2: Cron unreliability.** Runs may be delayed or dropped, especially at busy times. Mitigations: stale state on the page (AC-S3), stale issue (AC-S7), and honest latency copy (AC-A9, AC-S6).
- **R3: Git history growth.** The current data tree is bounded by arithmetic (AC-D3). Git history still keeps every run's commit, about 35,000 a year at defaults. Each commit's changes are small and compress well, but history size is measured, not proven. If the measurement in AC-D3 shows meaningful growth, an owner-approved periodic data-branch reset is under Later. It's excluded from MVP because it rewrites history (irreversible, so it needs approval).
- **R4: Keepalive mechanism.** If the enable-API approach turns out not to reset the inactivity timer, AC-S5 needs another `GITHUB_TOKEN`-only mechanism. If none exists, this is escalated to the owner rather than adding a secret.
- **R5: Data caching.** If the view-time data fetch is cached longer than 10 minutes, AC-P8 fails. The architect must check this.

## 11. Open questions (with recommended answers)

- **Q1: Which keepalive mechanism?** *Recommended:* the workflow-enable API with `actions: write`, verified by the architect (AC-S5, R4). If it would need any credential beyond `GITHUB_TOKEN`, that's a hard stop: escalate, don't add a secret.
- **Q2: Should 401 or 403 on a protected page count as down?** *Recommended:* yes in MVP. Per-target expected status codes are under Later.
- **Q3: Does the status page use this repo's default Pages URL?** *Recommended:* yes. Custom domains are under Later.
- **Q4: Is "create from template" the supported install path, rather than forking?** *Recommended:* yes. Forks have Actions disabled by default. The UX designer and architect should confirm.
- **Q5: Should a `monitor-stale` issue close itself?** *Recommended:* no. It reports a past gap, so it stays open until the owner closes it. That way the owner has seen it.

## 12. Recommended next steps

- **ux-designer** and **software-architect**, in parallel.
  - The architect owns AC-S5 and Q1 (keepalive), AC-P8 and R5 (view-time data fetch and caching), AC-D2 and D3 (data shape and bounds), AC-C3, C5, C10 and C11 (SSRF and injectable client), AC-K5 (concurrency), and AC-SEC3.
  - The designer owns AC-P2 to P11 wording and accessibility, within the plain-language meanings required here.

## 13. Later (explicitly cut from MVP)

- An external dead-man's switch that alerts when no runs happen at all. Needs an outside account, so it needs owner approval.
- Discord or Slack webhooks, and other notification channels (email, SMS). Each needs a secret, so it needs owner approval.
- Response-time charts and latency thresholds (a "slow" state).
- Keyword and content checks, per-target expected status codes, TLS-certificate expiry warnings.
- Incident posts and scheduled maintenance windows on the page.
- Onboarding for owners without GitHub (e.g. the bakery-owner persona).
- Owner-approved periodic data-branch history reset (only if R3's measurement shows a need).
- Custom domains and theming. Status and uptime badges.
- More than 20 targets, multiple status pages per repo, history beyond 90 days.

## 14. Changes from review (v1 → v2)

| # | Change | Where |
|---|---|---|
| 1 | Staleness now reaches the owner. Added a `GITHUB_TOKEN`-only keepalive (likely the enable-workflow API), a one-per-gap "Monitor was stale from X to Y" issue, and kept the page stale state. Stated that a fully external dead-man's switch needs an outside account and is under Later. | Goals 4, AC-S5, AC-S7, §13 |
| 2 | Data is decoupled from deploys. The page shell deploys rarely, through the owner-approved path. The page fetches data from the data branch at view time. A run never deploys, and nothing is chained off `GITHUB_TOKEN` pushes. AC-P8 rewritten; AC-P9 (data fails to load) added. | AC-P8, AC-P9, R5 |
| 3 | Only aggregates are stored: per-target per-day counts for 90 days, plus last state and open-issue number. D2 and D3 are now arithmetic bounds, and history rewrites were removed. **Partially rejected:** git history is not strictly bounded by arithmetic (one commit per run is about 35,000 a year), so I kept a measured history check and logged it as Risk R3, rather than claim a bound we can't prove. | AC-D2, AC-D3, R3 |
| 4 | Config errors no longer fail scheduled runs. Validation fails on push or PR. Scheduled runs skip bad entries and keep exactly one open `config-error` issue. Added AC-K5, a no-overlap requirement with de-duplication by label listing. | AC-C6, AC-K5 |
| 5 | SSRF hardening: IPv4-mapped IPv6, decimal, octal, hex and short IP forms, all of `0.0.0.0/8`, and `168.63.129.16`. Each hop connects to the validated IP with no second lookup. Added an injectable resolver and HTTP client so "never requested" can be tested. Added AC-SEC1 to SEC3 (no `innerHTML`, inert issue text, no `${{ }}` in `run:`). | AC-C3, C5, C10, C11, AC-SEC1 to SEC3 |
| 6 | Honest latency. Added an outage-to-issue AC: a deterministic logic test plus field measurement. README-facing copy states about 30 to 60 minutes. Removed "before users do" from the copy and goals. M1 now requires at least one target not hosted on GitHub. | §1, P1, AC-A9, AC-S6, M1 |
| 7 | Visitor page: a plain sentence first that screen readers announce first, no color-only status, works at 200% zoom, plain wording replaces "Monitor stale" and "No data", and an optional owner-contact line (validated). | AC-P2 to P4, P10, P11, AC-C12, US12 |
| 8 | Testability: AC-X3 uses a new repo from the template on an existing account. `workflow_dispatch` runs count as runs. AC-S5 is verified with mocked API and clock instead of waiting 60 days. | §6 preamble, AC-X3, AC-S5 |
| 9 | Positioning: the README states the differences from Upptime and links to it, without overclaiming. | AC-X4, §8 |
| 10 | Added Risks: the Actions-terms grey area (medium confidence, same as Upptime), with infrequent checks as the mitigation. | R1 |
| 11 | Later list updated: webhooks (need a secret and owner approval), response-time charts, keyword checks, incident posts, onboarding for non-GitHub users (explicitly out of MVP), and an external dead-man's switch. | §2, §13 |
| 12 | Minor: up now means a final 2xx after redirects (the confusing "3xx-resolved-to-2xx" wording is gone), and "Monitor stale" overrides all other states. | AC-K1, AC-S3/S4 |
| 13 | Removed stored per-check fields (HTTP status, response time) as a consequence of #3. Only the last failure reason is kept, in the state record. | AC-D2, AC-K3 |
