# Status

| Feature | Stage | Blockers | Next step |
|---|---|---|---|
| uptime-monitor | Live (internal), monitoring 3 Pages sites; public page removed | none | Add each new team site to monitor.config.json |
| stale-alarms | Merged in PR #7: gaps up to 8h go to one silent rolling log issue; only gaps over 8h open "Monitor was stale". Old issues #2-#6 closed. | none | Later (not now): route real alerts into the Asks inbox |

## Run ledger
| Date | Role | Model/effort | Task | Outcome |
|---|---|---|---|---|
| 2026-10-30 | code-reviewer | sonnet/medium | stale-alarms review of 44bd851 | approve, 1 low-medium (stale-boundary-retry) + 3 low/nit, fixed in 883b313 |
| 2026-10-30 | code-reviewer | sonnet/medium | delta re-review of 883b313 | approve |
| 2026-11-19 | qa-engineer | sonnet/medium | QA of PR #20 (a30fda6) | pass, 8/8 AC, 3 minor/info; merged |
| 2026-11-19 | backend-engineer | opus/high | prove or drop 5 sweep suspects | 1 proven (issues/marker-injection-via-name) fixed 52808e7; 4 dropped as intended |
| 2026-11-19 | code-reviewer | sonnet/medium | review of PR #22 (52808e7) | approve, 1 nit (issues/marker-last-invariant) added fac5bfd; merged |
