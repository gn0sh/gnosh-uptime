# ADR-0005: Page shell deployed by a Pages workflow behind the owner-approved github-pages environment, and monitor runs never deploy

- Status: Accepted (2026-10-28). Feature: uptime-monitor. ACs: P1, P8, X2. Hard stop 1 (production deploys)

## Decision
- Pages source is "GitHub Actions". `pages.yml` runs on `push` to `main` with paths `site/**` and `scripts/build-site.mjs`, plus `workflow_dispatch`.
- Job `build` (`contents: read`) runs `node scripts/build-site.mjs` and `actions/upload-pages-artifact`. Job `deploy` (`pages: write`, `id-token: write`) runs `actions/deploy-pages` with `environment: github-pages`.
- Environment `github-pages`: **required reviewer = the owner**, and deployment branches = `main` only. Environment protection rules are available on public repos on the Free plan.
- `monitor.yml` has no `pages` or `id-token` permission, no deploy step, and writes only to `monitor-data`.

## Why a data run can't deploy
No permission, no step, a branch and path filter mismatch, and commits made with `GITHUB_TOKEN` never trigger `push` workflows. That is four independent reasons.

## Alternatives considered
- **"Deploy from branch" Pages, building from a `gh-pages` branch that includes data:** every data commit would be a Pages build (with a build-rate limit), and no approval gate is possible. Rejected (Brain Trust, Operator).
- **No approval gate:** conflicts with hard stop 1 for our own production site.

## Consequences
- Changes to the page shell wait for the owner to click approve, which is intended. Config and data changes never wait.
- Template users must do two settings clicks (Pages source, and optionally the reviewer). This goes in the README (AC-X3).
