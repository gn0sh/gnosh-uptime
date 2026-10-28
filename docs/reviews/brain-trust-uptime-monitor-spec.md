# Brain Trust: uptime-monitor spec v1

Date: 2026-10-28. Members, each run independently on a neutral brief: Skeptic, Opponent (assigned devil's advocate), Operator, Budget Hawk. The User seat was covered by the Focus Group, whose report is in `docs/research/focus-group-uptime-monitor.md`.

## Verdicts
| Member | Verdict | Biggest concern |
|---|---|---|
| Skeptic | Fix First | Metrics measure "issue opened", not how long until the owner hears. Detection takes about 30–60+ min at the defaults. Dogfood targets on github.io fail together with the monitor. |
| Opponent (DA) | **Rethink** | Upptime already does this. The stale watchdog only warns page visitors, so a dead monitor still goes unnoticed and US7 isn't met. |
| Operator | Fix First | Owner-approved prod deploys conflict with auto-refresh every 15 minutes (AC-P8). |
| Budget Hawk | Fix First | We'd store raw per-check history that nothing in the MVP displays. That one choice creates the rollup logic, the growth simulation and the history-rewrite risk. |

Not unanimous, so no extra pre-mortem round.

## Where they agree
- **Data refresh must be separate from the deploy (3/4).** With a required reviewer on Pages, every 15-minute run would wait for a human. `GITHUB_TOKEN` pushes don't trigger other workflows, so a push-then-deploy chain silently fails. Branch-built Pages also have a build-rate limit (medium confidence).
- **AC-C6 floods the owner (2/4).** Failing every scheduled run on one bad entry means about 96 emails a day, which trains the owner to ignore the same channel the outage alerts use.
- **SSRF list gaps (2/4):** IPv4-mapped IPv6, non-decimal IP forms, 0/8, 168.63.129.16, DNS rebinding, and escaping of target names.
- **Some ACs can't be tested as written (2/4):** the fresh-account test (AC-X3), waiting on real cron, and waiting 60 days.

## Disagreement
- **Opponent says Rethink: deploy Upptime in an hour and build something new.** Brian has already chosen to build this as the team's first end-to-end project, knowing Upptime exists. The Opponent's strongest point stands: as written, the product's key differentiator doesn't reach the owner. We act on it. Staleness must notify the owner, and the README must position the product honestly against Upptime. With both fixes, the build goes ahead.
- **SSRF depth: Budget Hawk (lighter, accept residual rebinding risk) vs. Operator and Skeptic (pin the resolved IP).** Operator and Skeptic are stronger. Pinning is a small change in most HTTP clients, and the template is public, so other people will run it.

## Top changes (handed to PM for spec v2)
1. Staleness reaches the owner: a keepalive using only `GITHUB_TOKEN`, plus a "monitor was stale" issue whenever a run detects a gap.
2. Separate data from deploy: the page shell deploys rarely through the approved path, and the page fetches data from the data branch at view time.
3. Store per-day aggregates instead of raw checks. Handle config errors with one issue, not a failed run every time. Add a concurrency group.
Also: the SSRF additions, an honest detection-latency AC, at least one non-GitHub target, testable ACs, and a note on the Actions terms risk.

## Owner of each change
All go to the product-manager for spec v2. The architect owns the keepalive mechanism and IP pinning.
