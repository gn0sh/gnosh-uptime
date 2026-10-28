# Spec: uptime-monitor (MVP)

- **Repo:** `gn0sh/gnosh-uptime` (public)
- **Owner:** Product Manager
- **Status:** Draft v1. Red-team (Brain Trust) findings are folded in as binding requirements. Focus Group not yet run.
- **Priority:** MVP, unless an item is listed under "Later"

---

## 1. Problem statement

People who run one or a few small websites (hobby projects, small-business sites, side projects) usually hear about an outage from their own users, often hours after it started. When the site is down they also have nowhere to send people for a status update. Paid monitoring services cost money and need new accounts. Self-hosting a monitor means running a server, which can go down too.

The product is an uptime monitor and public status page that runs entirely on free GitHub features in one public repository:

- a scheduled GitHub Actions workflow checks a configured list of URLs,
- check history is stored in the repository, on a separate data branch,
- a static status page on GitHub Pages shows current status and uptime history,
- outages are reported as GitHub Issues that the workflow opens, then closes when the site recovers.

It costs $0, needs no accounts beyond GitHub, and needs no secrets beyond the built-in `GITHUB_TOKEN`.

**Honesty constraint, which shapes the whole product:** free scheduled Actions are best-effort. Runs can be delayed or skipped, and GitHub disables scheduled workflows in a public repo after 60 days without repository activity. The product must never present itself as more reliable than that. When it has not checked recently, it must say so.

## 2. Users and personas

| Persona | Description | Main need |
|---|---|---|
| **P1: Small-site owner (primary)** | Runs 1–5 small sites. Comfortable with GitHub (can fork or template a repo and edit a config file). Not an ops engineer. | Hear about an outage before users do, at $0, without running infrastructure. |
| **P2: Site visitor during an outage** | A user of P1's site who hit an error. May not be technical and does not have a GitHub account. | One public page that says, plainly, whether the site is known to be down and since when. |
| **P0: First real user, the team** | Monitors its own deployed GitHub Pages sites (e.g. `https://gn0sh.github.io/...`-style URLs; exact targets live in config). | Dogfood the product end to end. This is the team's first end-to-end project. |

## 3. Goals and non-goals

### Goals (MVP)
1. Check each configured URL on a schedule and record whether it is up or down.
2. Open a GitHub Issue when a target goes down, and close it automatically when the target recovers.
3. Publish a public status page with current status per target, the time of the last actual check, and uptime history.
4. Detect and display a stale monitor (no recent checks), including after GitHub has disabled the schedule.
5. Treat config as untrusted input: only well-formed public http/https URLs are checked.
6. Stay within $0, no new accounts, and only `GITHUB_TOKEN`.

### Non-goals (MVP)
- Email, Slack, SMS, webhooks, push, or any notification channel other than GitHub Issues. GitHub's own notifications for issues on watched repos are the delivery path.
- Monitoring private, internal, or authenticated endpoints. Config and results are public by design.
- Sub-5-minute checking, multi-region checks, or latency SLOs.
- Checks other than HTTP(S) (TCP, ping, DNS, TLS-expiry, keyword or content assertions).
- Manual incident posts or maintenance windows authored on the status page.
- Custom domains, theming, or branding beyond the repo/site name.
- A hosted multi-tenant service. Each user runs their own copy of the repo.
- Choosing implementation technologies beyond Actions, Pages, and Issues. That is the architect's call.

## 4. Success metrics

- **M1 (dogfood):** the team runs the monitor against its own sites for 30 consecutive days. Every real or simulated outage longer than 2× the check interval results in an opened issue.
- **M2 (honesty):** across those 30 days, there is no moment when the status page shows "operational" for a target while the last successful run is older than the staleness threshold (verified by AC-S1..S4).
- **M3 (alert quality):** at most 1 false-positive outage issue per target per 30 days at default settings.
- **M4 (cost):** $0 spent, and no secret other than `GITHUB_TOKEN` configured.

## 5. User stories

- **US1:** As a small-site owner, I want to list my URLs in one config file so that I can start monitoring without writing code.
- **US2:** As a small-site owner, I want a GitHub Issue opened when my site goes down so that I'm notified through GitHub, which I already use.
- **US3:** As a small-site owner, I want the issue closed automatically, with the outage duration recorded, when my site recovers so that I don't have to clean up by hand and I keep an incident record.
- **US4:** As a site visitor, I want a public page showing whether the site is up, down, or of unknown status so that I know if the problem is on their side.
- **US5:** As a site visitor, I want to see when the site was last actually checked so that I can judge how current the page is.
- **US6:** As a small-site owner, I want the page to clearly show "monitor stale" when checks have stopped so that a dead monitor is never mistaken for a healthy site.
- **US7:** As a small-site owner, I want to be warned before, or as soon as, GitHub disables my scheduled workflow for inactivity so that monitoring doesn't silently stop.
- **US8:** As a small-site owner, I want to see recent uptime history (per-day and percentage) so that I can tell whether outages are a pattern.
- **US9:** As a small-site owner, I want monitoring data kept off my main branch, with bounded growth, so that my repo history stays clean and the repo doesn't grow without limit.
- **US10:** As a repo owner accepting contributions, I want invalid or dangerous URLs in config rejected so that a malicious or careless config change can't point the checker at private or loopback addresses.

## 6. Acceptance criteria

All criteria must be testable by QA. "Interval" means the configured check interval. Defaults are listed in §7.

### Configuration (C)
- **AC-C1:** Targets are defined in one config file in the repo. Each target has at least a display name and a URL. Adding a valid target and pushing to the default branch causes that target to appear on the status page within 2 completed scheduled runs.
- **AC-C2:** A URL is accepted only if its scheme is `http` or `https`. URLs with any other scheme (`file:`, `ftp:`, `gopher:`, `data:`, `javascript:`, etc.) are rejected.
- **AC-C3:** A URL is rejected if its host is a literal IP or a name that resolves (at check time) to any of these: loopback (`127.0.0.0/8`, `::1`), RFC 1918 private (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`, `fe80::/10`, which includes cloud metadata `169.254.169.254`), carrier-grade NAT (`100.64/10`), unspecified (`0.0.0.0`, `::`), IPv6 unique-local (`fc00::/7`), multicast, or broadcast. A host of `localhost` or ending in `.localhost`, `.local`, or `.internal` is also rejected. Test: one config entry per category; each is rejected and none is requested.
- **AC-C4:** A URL is rejected if it contains userinfo (`user:pass@host`), because config and results are public.
- **AC-C5:** If an HTTP redirect is followed, every redirect target is checked against AC-C2..C4. A redirect to a rejected address makes the check result "down (blocked redirect)", and the blocked address is not requested. At most 5 redirects are followed; more counts as down.
- **AC-C6:** Invalid entries do not stop valid ones. Each valid target is still checked. Each invalid entry is listed by name with a human-readable reason in the workflow run's log/summary, and that run ends in a failed state, so GitHub's standard failed-workflow notification reaches the repo owner.
- **AC-C7:** The config enforces a maximum of 20 targets. Entries beyond 20 are treated as invalid under AC-C6.
- **AC-C8:** Duplicate target names are rejected under AC-C6, since names identify targets in issues and history.
- **AC-C9:** Config cannot set the check interval below 5 minutes (GitHub's minimum schedule granularity). A lower value is rejected with a clear error.

### Checking (K)
- **AC-K1:** On each run, each valid target gets one HTTP(S) request. It is **up** if the final response status is 2xx or 3xx-resolved-to-2xx within the timeout. Otherwise it is **down**: non-2xx final status, timeout, DNS failure, TLS error, connection error, or blocked redirect.
- **AC-K2:** The per-request timeout is configurable, with a default of 10 s. A target that takes longer than the timeout is recorded as down with reason "timeout".
- **AC-K3:** Each check result records at least: target name, UTC timestamp of the check, up/down, HTTP status (if any), response time in ms (if any), and a short failure reason (if down). It never stores response bodies or response headers.
- **AC-K4:** One target hanging or failing does not prevent the other targets from being checked in the same run. Test: one target that never responds plus one healthy target; the healthy one is recorded as up in the same run.

### Alerts via GitHub Issues (A)
- **AC-A1:** Issues are created, commented on, and closed only by the workflow using `GITHUB_TOKEN`. No other secret or account is used.
- **AC-A2:** When a target has been down for N consecutive checks (configurable, default N = 2), exactly one open issue exists for it. The title includes the target name and the word "down". The body includes the URL, the first-failure time (UTC), and the failure reason.
- **AC-A3:** Further failed checks while the issue is open do not create additional issues. Test: 5 consecutive failures produce exactly 1 open issue for that target.
- **AC-A4:** On the first successful check after an open outage issue, the workflow posts a comment with the recovery time and total outage duration, then closes the issue.
- **AC-A5:** A single failed check followed by a success (with N = 2) opens no issue.
- **AC-A6:** Outage issues carry a dedicated label (e.g. `outage`) so they can be filtered. If the label is missing, the workflow creates it.
- **AC-A7:** If a human closes an outage issue while the target is still down, the workflow does not reopen it or open a new one until the target has recovered and gone down again. (This avoids spam and respects a human decision.)
- **AC-A8:** Issue text contains only data the monitor itself generated. Nothing from the remote server's response (body, headers, error pages) is included.

### Status page (P)
- **AC-P1:** A public status page is served from GitHub Pages for the repo and is readable without a GitHub account or login.
- **AC-P2:** For each target the page shows: display name, current state (Up / Down / Unknown), and the time the target was last actually checked (absolute UTC time plus a relative "N minutes ago").
- **AC-P3:** The page shows an overall summary state: "All systems operational", "Partial outage" (some down), "Major outage" (all down), or "Monitor stale" (see S). "Monitor stale" overrides every other summary.
- **AC-P4:** For each target the page shows uptime percentage over the last 7 and 90 days, plus a per-day history for the last 90 days. A day with zero recorded checks is shown as "no data", distinct from up and from down, and is excluded from the uptime percentage. It is never counted as up.
- **AC-P5:** Uptime % = successful checks ÷ total recorded checks for that target in the window, shown with one decimal place. Test: a fixture with 95 up and 5 down checks shows 95.0%.
- **AC-P6:** The page states, in visible text, that checks run on a best-effort schedule of about every <interval> and may be delayed, and that uptime is measured only at check times.
- **AC-P7:** A target currently in an open outage links to its GitHub Issue from the page.
- **AC-P8:** The page updates after a completed run without manual steps. Test: after a run that changes a target's state, the page reflects it within 10 minutes of the run finishing (allowing for Pages deploy time).
- **AC-P9:** The page is usable on a 360 px-wide mobile viewport and, at that width, shows all targets' current state without horizontal scrolling.

### Staleness watchdog and schedule health (S)
- **AC-S1:** The page shows the timestamp of the most recent completed check run, labeled as such (e.g. "Last check: 2026-10-28 14:05 UTC (7 min ago)").
- **AC-S2:** Staleness is evaluated **in the viewer's browser at view time**, by comparing the last-run timestamp with the current time. It does not depend on a new run or redeploy, because a dead monitor can't update the page. Test: freeze the data, advance the client clock past the threshold, reload, and see the stale state.
- **AC-S3:** When the last completed run is older than the staleness threshold (configurable, default 60 minutes, and never less than 2× the interval), the page switches to a visually distinct "Monitor stale" state. It shows the summary "Monitor stale: status unknown since <time>". Per-target states display as "Unknown (last seen up/down at <time>)", not as Up.
- **AC-S4:** In the stale state the page never shows "All systems operational" or any per-target "Up" without the stale qualifier.
- **AC-S5 (60-day inactivity):** The product includes a documented, automated measure, using only `GITHUB_TOKEN`, that keeps the scheduled workflow from being disabled by GitHub's 60-day public-repo inactivity rule. If it cannot be prevented, the product detects it and surfaces it. Acceptance: in the docs, the architect names the mechanism and how it was verified against current GitHub behavior. Whatever the mechanism, if the schedule is disabled anyway, AC-S2/S3 make the page show "Monitor stale" within the threshold. The page's stale message links to a README section explaining how to re-enable the workflow.
- **AC-S6:** When the monitor has not completed a run for longer than the threshold, the page shows that fact. The project never claims a guaranteed check frequency anywhere (page, README, issue text). Test: grep the docs and page copy for "guaranteed", "every 5 minutes exactly", "real-time", and similar; none apply to check timing.

### Data storage (D)
- **AC-D1:** Check history and generated status data live on a dedicated data branch, not the default/main branch. Test: after 10 runs, the default branch has no new commits from the workflow.
- **AC-D2:** Raw per-check records are kept for at most 90 days (configurable). Older records are rolled up into per-day aggregates (checks, successes) per target or deleted, so AC-P4 still works for 90 days.
- **AC-D3:** Growth is bounded. In a simulation of 1 year of runs at the default interval with 20 targets, the data branch's **current tree** stays under 10 MB, and the repository's total clone size attributable to the data branch stays under 50 MB. (Note: git history keeps old file versions, so this bound applies to history, not just current files. How to meet it is up to the architect.)
- **AC-D4:** Removing a target from config removes it from the status page within 2 runs. Its historical data may be kept or pruned, but it is not shown.
- **AC-D5:** A run that fails partway leaves the previously published data valid and readable. A partial write never shows a broken or empty page.

### Constraints (X)
- **AC-X1:** The whole system runs in one public GitHub repo, using only GitHub Actions, GitHub Pages, and GitHub Issues. No paid plan, external service, or account is required.
- **AC-X2:** No repository or environment secret other than the automatically provided `GITHUB_TOKEN` is needed. The workflow requests only the token permissions it needs, and the README lists them.
- **AC-X3:** A new user can go from "use this template/fork" to a live status page for one URL by following the README, editing only the config file and enabling Pages/Actions in repo settings. QA test: a fresh account completes setup in 15 minutes or less without editing workflow files.

## 7. Defaults (product decisions)

| Setting | Default | Rationale |
|---|---|---|
| Check interval | 15 min (min 5) | Public-repo Actions minutes are free, but cron is best-effort and each run writes data. 15 min balances detection speed against run volume and data growth. 5 min is allowed for those who want it. |
| Failures before issue (N) | 2 consecutive | Avoids issues from one-off network blips (M3). |
| Request timeout | 10 s | Typical for small sites. |
| Staleness threshold | 60 min (≥ 2× interval) | Leaves room for routine cron delays before declaring stale. |
| Raw history retention | 90 days | Matches the 90-day history view. |
| Max targets | 20 | Keeps run time and data bounded for the target persona (1–5 sites). |

## 8. Competitor: Upptime

[Upptime](https://github.com/upptime/upptime) is a mature, popular open-source project with essentially the same architecture: GitHub Actions checks, GitHub Issues for incidents, and a GitHub Pages status site. Anyone who just wants this working today should consider it. We are building our own mainly because it is the team's first end-to-end project and a dogfooding exercise, not because we expect to beat Upptime. Within that, we deliberately differ in a few narrow ways. First, a smaller scope (HTTP checks, Issues, one page). Second, a first-class staleness watchdog evaluated in the browser, so a stalled or disabled schedule is shown as "monitor stale" instead of last-known-good. Third, explicit, user-visible honesty about best-effort cron timing. Fourth, keeping all check data on a separate, size-bounded data branch. Fifth, strict validation of config URLs as untrusted input. We have not audited how Upptime handles each of these, so we make no claims that it lacks them.

## 9. Assumptions

1. Target users already have a GitHub account and can edit a file in a repo. Visitors (P2) need no account.
2. GitHub Actions minutes for standard runners stay free for public repos, and the cron schedule has a 5-minute minimum and is best-effort. Delays of 10+ minutes, and occasional skipped runs, are expected.
3. "Notification" for the owner means GitHub's standard notifications (web/email/mobile per the user's GitHub settings) for issues in a repo they own or watch. We configure nothing beyond creating the issue. Users must be watching the repo, and the README must say so.
4. Monitored URLs and their status are public. Users who can't accept that are out of scope.
5. Checks come from GitHub-hosted runners, whose IPs and location vary. A site that blocks datacenter IPs or bots may show as down; the README documents this.
6. "Up" is judged on HTTP status only (AC-K1). Content correctness is out of scope.
7. Times are stored and shown in UTC; the relative "N min ago" is computed on the client.
8. The team's own GitHub Pages sites are valid first targets. Exact URLs are config, not spec.
9. Whether commits made by the workflow (e.g. to the data branch) count as "repository activity" for the 60-day rule is **unverified**. The architect must confirm it before relying on it (see AC-S5 and Q1).

## 10. Open questions (with recommended answers)

- **Q1: How is the 60-day inactivity disable handled?** *Recommended:* the architect picks a `GITHUB_TOKEN`-only mechanism, documents it, and verifies it against current GitHub docs. The browser-side stale state (AC-S2/S3) is the backstop either way. No need to escalate unless it requires a non-`GITHUB_TOKEN` credential, which would be a hard stop (new secret).
- **Q2: Should "monitor stale" also raise a GitHub Issue?** It can't come from the stalled workflow itself. *Recommended:* not in MVP. The page state plus GitHub's failed-run emails are enough; revisit under Later.
- **Q3: Should 3xx count as up without following redirects?** *Recommended:* no. Follow up to 5 validated redirects and judge the final status (AC-C5, AC-K1).
- **Q4: Should 4xx, e.g. 401/403 on a protected page, count as down?** *Recommended:* yes in MVP. A per-target "expected status" setting is in Later.
- **Q5: Does the status page live in this repo's Pages site or on a custom domain?** *Recommended:* this repo's default Pages URL. Custom domain is in Later.
- **Q6: Is "use this template" the supported install path, rather than a fork?** *Recommended:* yes (forks have Actions disabled by default and other quirks). The UX designer and architect should confirm.

## 11. Later (explicitly cut from MVP)

- Other notification channels (email, Slack, Discord, webhooks). These would need accounts or secrets.
- A stale-monitor alert via an external watcher.
- Per-target expected status codes, keyword/content checks, TLS-certificate expiry warnings.
- Response-time charts and latency thresholds ("degraded" state).
- Manual incident notes and scheduled maintenance windows on the page.
- Custom domain and theming.
- Badges (SVG status/uptime badges for READMEs).
- More than 20 targets, multiple status pages per repo.
- History longer than 90 days.

## 12. Recommended next steps

- **Focus Group** (simulated P1 and P2 users): test whether "free, GitHub-only, honest about staleness" lands against "just use Upptime", and whether visitors understand "Monitor stale".
- **ux-designer** and **software-architect**, in parallel. The architect owns AC-S5 (inactivity mechanism), AC-D3 (bounded history), and URL/redirect validation (AC-C3, AC-C5).
