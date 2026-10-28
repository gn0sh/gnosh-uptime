# ADR-0007: The check interval is derived from monitor.yml's cron, not a config field

- Status: Accepted (2026-10-28). Feature: uptime-monitor. ACs: C9, P6, S3

## Context
Actions schedules live only in the workflow file. A separate `interval` config field could disagree with the real cron, which would make the staleness threshold and the page copy wrong.

## Decision
`config.deriveIntervalMinutes(workflowText)` reads the `cron:` line of `.github/workflows/monitor.yml`. It supports minute fields `*/n`, `a-b/n` and comma lists, with hour, day-of-month, month and day-of-week all `*`. It returns the **largest cyclic gap** between scheduled minutes (the conservative choice for staleness). If the result is under 5 or can't be parsed, that is a config error, and 15 is used. The default schedule is `7,22,37,52 * * * *`, which is off the top of the hour, so the interval is 15. The interval is written into `status.json` so the page can show it.

## Alternatives considered
- **A config field plus a 5-minute cron that skips early:** about 288 runs a day for the defaults. That is wasteful and worsens the ToS concern R1.
- **A config field that must match the cron:** two sources of truth.

## Consequences
- Changing the interval means editing the workflow file. That is documented as an advanced step, and AC-X3 only needs the defaults.
- `staleAfterMinutes` is validated to be at least 2 × the derived interval.
