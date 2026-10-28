# ADR-0002: Keepalive by calling the enable-workflow API with GITHUB_TOKEN on every run

- Status: Accepted with an open risk (2026-10-28). Feature: uptime-monitor. ACs: S5, X2. Spec Q1, R4

## Context
GitHub docs (checked 2026-10-28): "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days." The docs don't define "activity". A dummy commit to the default branch would conflict with AC-D1, which says the workflow makes no commits to the default branch. Only `GITHUB_TOKEN` may be used.

## Decision
`monitor.yml` gets a separate `keepalive` job with `permissions: { actions: write, contents: read }`. On every scheduled or dispatched run it calls `PUT /repos/{owner}/{repo}/actions/workflows/monitor.yml/enable` with `GITHUB_TOKEN`. A response of 204 is success. Anything else gives a `::warning::` and a summary line, but the job does not fail.

## Evidence
- **Verified in the docs:** the endpoint exists, returns 204, needs the "Actions" repository permission (write), and supports installation tokens. `GITHUB_TOKEN` with `actions: write` therefore can call it. **No secret is needed.**
- **Not verified in the docs:** that calling enable on an *already enabled* workflow resets the 60-day timer. This rests on community reports: the `keepalive-workflow` action's `use_api` mode (`actions: write`), write-ups on Qiita and Zenn, and several repos that replaced commit keepalives with `gh workflow enable` plus `GITHUB_TOKEN`. None of these cite GitHub or show a measured result. Confidence: **medium**.

## Alternatives considered
- **A dummy commit on the default branch** (`contents: write`). This is the most widely relied-on method, but it violates AC-D1 and adds noise to `main`. It is the fallback if the enable call proves ineffective, and that needs a PM decision (escalation E1).
- **A separate scheduled keepalive workflow.** That workflow would itself be disabled after 60 days. Putting the keepalive in the same workflow means that if the workflow is running at all, it is still enabled.
- **A PAT or GitHub App token.** That is a new secret, so it is a hard stop and is rejected.
- **Relying on the data-branch commits counting as activity.** Undocumented, and it may only count on the default branch. It may help, but nothing relies on it.

## Consequences
- One API call per run (about 96 a day), which is negligible.
- If the reset doesn't work, the workflow dies at about day 60 after the last human activity. The page shows the stale state (S3) with a link to re-enable, and AC-S7 opens an issue after the owner re-enables. The README must say this plainly.
- Verification under AC-S5 is a unit test with a mocked API and a fake clock. Real-world confirmation needs at least 60 days of dogfooding with no human commits. The team should record when the repo was last touched by a human and watch for that.
