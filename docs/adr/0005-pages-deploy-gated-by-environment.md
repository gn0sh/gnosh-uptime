# ADR-0005: Page shell deployed by a Pages workflow behind the owner-approved github-pages environment, and monitor runs never deploy

- Status: **Superseded (2026-10-29): no Pages deploy.** The CEO confirmed the monitor is an internal tool with no public status page. `pages.yml`, the page build script and the a11y job were removed; nothing in the repo deploys. Architecture §11 describes the current workflows. The text below is kept as the record of the design. If a page comes back, this design applies again: restore `pages.yml` from git history (823cf30 or earlier) **and** add the `github-pages` reviewer before enabling Pages, since GitHub auto-creates that environment with no reviewer.
- Originally accepted 2026-10-28. Feature: uptime-monitor. ACs: P1, P8, X2. Hard stop 1 (production deploys)

## Decision
- Pages source is "GitHub Actions". `pages.yml` runs on `push` (any branch except `monitor-data`) with paths `site/**`, `scripts/build-site.mjs`, `monitor.config.json`, `src/config.js`, `src/ssrf.js`, `src/jsonloc.js` and `.github/workflows/pages.yml`, plus `workflow_dispatch`. No branch name is hard-coded. Job `build` runs only when `github.ref` is the repository's **current default branch** (`if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)`). Today that is `claude/project-thread-0jnua7`; later it will be `main`, with no workflow change.
- Job `build` (`contents: read`) runs `node scripts/build-site.mjs` and `actions/upload-pages-artifact`. Job `deploy` (`pages: write`, `id-token: write`) runs `actions/deploy-pages` with `environment: github-pages`.
- Environment `github-pages`: **required reviewer = the owner**, and the deployment branch is the default branch, named explicitly (environments can't follow the default branch). Environment protection rules are available on public repos on the Free plan.
- **Second lock (added 2026-10-29):** `deploy` also needs `if: vars.GU_DEPLOY_APPROVAL_CONFIGURED == 'true'`. The first CI run showed that GitHub **auto-creates `github-pages` with no reviewer**, so that run reached `deploy-pages` without any approval wait. It failed only because Pages was off. The owner sets the variable as the **last** setup step, after adding the reviewer (`docs/release/uptime-monitor-owner-setup.md`).
- `monitor.yml` has no `pages` or `id-token` permission, no deploy step, and writes only to `monitor-data`.

## Why a data run can't deploy without the owner
- `monitor.yml` has no Pages or `id-token` permission and no deploy step.
- Data commits go to `monitor-data`. `pages.yml` ignores that branch, and its build runs only on the default branch.
- Commits made with `GITHUB_TOKEN` don't trigger `push` workflows.
- **Correction:** the keepalive job's `actions: write` token *can* dispatch `pages.yml`. A `workflow_dispatch` made with `GITHUB_TOKEN` does start a workflow. Such a run still builds only from the default branch and still waits for the owner's approval, so it is not a bypass. The keepalive job is gated to the default branch as well.
- Config edits on the default branch **do** start `pages.yml`, because siteName and the contact line are baked in at build time (SC-7). That deploy waits for approval. New targets still reach the page through data alone (C1).

The approval gate is therefore the control that matters, which is why it has a second lock.

## Alternatives considered
- **"Deploy from branch" Pages, building from a `gh-pages` branch that includes data:** every data commit would be a Pages build (with a build-rate limit), and no approval gate is possible. Rejected (Brain Trust, Operator).
- **No approval gate:** conflicts with hard stop 1 for our own production site.

## Consequences
- Changes to the page shell wait for the owner to click approve, which is intended. Data changes never deploy. Config edits create a pending deploy request that waits for the owner. If siteName and contact didn't change, the request can be left alone.
- Template users must do three settings steps: Pages source, the `GU_DEPLOY_APPROVAL_CONFIGURED` variable, and, recommended, the reviewer added before the variable. This goes in the README (AC-X3).
