# Code review: uptime-monitor round 2 (commit e03c90c)

- **Reviewer:** code-reviewer (read-only). **Date:** 2026-10-29
- **Scope:** (1) the wave 1 findings in `docs/reviews/code-review-uptime-monitor-wave1.md`; (2) `.github/workflows/*.yml`, `scripts/build-site.mjs`, `scripts/a11y-check.mjs`, `test/workflows.test.js`, `docs/release/` (setup checklist and rulesets).
- **Checked against:** architecture (§7, §8, §9, §11), threat model (F6, F10, F12, F15), owner setup checklist.
- **Not reviewed:** `test/sim/` and `docs/qa/` (untracked, QA in progress).
- **Tests:** `npm test` passes, 323 of 323. This sandbox runs Node 22.22.0, so the Node 24 proof still waits for the first `validate` run in CI (R8).
- **Pins:** I checked every SHA with `git ls-remote --tags`, and each one matches its tag. The tags are lightweight, so there is no peeled-tag mismatch. The pins are: checkout `3d3c42e…` = v7.0.1, setup-node `949feb2…` = v7.1.0, upload-pages-artifact `fc324d3…` = v5.0.0, deploy-pages `368f825…` = v5.0.1. upload-pages-artifact v5.0.0 also pins its inner `actions/upload-artifact` to a SHA (`bbbca2d…`, v7.0.0).

## Verdict: REQUEST CHANGES

**The most serious problem is R1.** The F2 fix writes `configErrorCount = cfg.errors.length` into the data, and the page now reads that number as "sites we couldn't check". Any config error counts, including one that has nothing to do with a site: a misspelled setting, an out-of-range `timeoutSeconds`, a bad cron. When that happens, the page tells every visitor *"We couldn't check 1 of our sites because of a setup problem"* even though every site was checked. The page can also never reach "Everything is working." I reproduced this with `parseConfig('{"timeoutSecond":5,"targets":[{"name":"A","url":"https://example.com/"}]}')`, which gives 1 valid target and 1 error. The bug is new in this commit. Template users who edit the config in the web UI without rulesets are the main way to hit it.

R2 is the one security gap. The `monitor` job is gated on the default branch, but the `keepalive` job is not. So a manual run from any branch executes that branch's code with an `actions: write` token.

Both are small fixes. Everything else from wave 1 is fixed correctly and has meaningful regression tests.

---

## Part 1: wave 1 findings

| # | Status | What I checked |
|---|---|---|
| F1 | **Fixed** | `src/config.js:285` limits the normalized `u.url.href`, and `:229` does the same for the `contactLink` href. `src/datastore.js:96` re-runs `isValidStoredData` on the serialized output and throws on a mismatch, so a writer/reader gap fails loudly. Header bound raised to 2,048 B. Round-trip tests: `test/state.test.js:193` (property test: encoded, IDN, 4-byte characters) and `test/cli.test.js:294`, `:319` (end to end through `main`). |
| F2 | **Fixed, with a regression (R1)** | `src/cli.js` `hold` covers unparseable config, missing / misspelled / empty `targets` and "every entry invalid". In those cases nothing is checked or written, and the config-error issue is synced. Invalid entries with a name and an index of 20 or less are carried forward in config order (`src/cli.js` results loop, `src/state.js:77-86`). D4's `kept` now comes from the output targets, so carried records don't get a `close-removed`. I checked that the index alignment holds: each target entry yields exactly one error with an `index`, and duplicate-key errors carry no `index`. Duplicate names are excluded through `validNames`. The page side (`site/render.js:391-497`) never reaches `all-up` when the count is above 0. Tests: `test/cli.test.js:245`, `:265`, `:279`; `site/render.test.js:361`. |
| F3 | **Fixed** | `issueStep` wraps labels, stale, config-error, list and sync. A 410 only warns. A failure means exit 1, but the data is still written. If the list fails, `openIssueNumbers = null` (no inferred human close) and no outage sync runs; the next run opens the issue or adopts it by marker. `readData` failure stays fatal, which is correct. Test: `test/cli.test.js:225`. |
| F4 | **Fixed** | `src/issues.js:251-293` groups open issues by marker and keeps the linked issue, or the lowest number when adopting. The others are closed as duplicates. Stable over runs: `test/issues.test.js:257`, `:272`. |
| F5 | **Fixed** | `src/issues.js:231`: the SC-8 confirmation uses author plus marker, without the label. Test: `test/issues.test.js:283`. |
| F6 | **Fixed** | Config cause added to `staleBody` (`src/issues.js:374`). Test: `test/issues.test.js:297`. |
| F7 | **Partly fixed** | All three workflows pin `node-version: 24`, and the lint checks it (`test/workflows.test.js:87`). A real run on 24 is still needed (R8). |
| F8 | **Fixed** | `site/render.js:527` and `site/app.js:124`. Test: `site/render.test.js:351`. |

## Part 2: workflow questions, answered

- **Can the monitor run with a write token from an unreviewed branch?** The `monitor` job (`contents: write`, `issues: write`) cannot. Scheduled runs always use the default branch. A manual run is gated by `if: github.event_name == 'schedule' || github.ref == format('refs/heads/{0}', github.event.repository.default_branch)` (`.github/workflows/monitor.yml:45`). `github.event.repository.default_branch` is present in `workflow_dispatch` payloads, and tags and other branches fail the comparison. **The `keepalive` job can (R2).** One caveat applies to both: anyone who can push a branch with a changed workflow file can grant that branch any job permissions. So the `if` stops *unchanged-workflow, changed-src* branch runs. It is not a boundary against people with push access, who are trusted (threat model line 194).
- **Can a monitor run ever deploy?** No, not without the owner approving. Neither monitor job has `pages` or `id-token`, or an `environment`. `pages.yml` deploys only through the `github-pages` environment, which has a required reviewer and a deployment-branch rule. One correction to the architecture's "four reasons" (R5): the keepalive's `actions: write` token **can** dispatch `pages.yml` (a `workflow_dispatch` made with `GITHUB_TOKEN` does start workflows). The run it starts still builds from the default branch and still waits for approval, so this is not a bypass.
- **Default-branch gating in `pages.yml`:** correct. `build` has `if: github.ref == …default_branch` (`pages.yml:34`). `deploy` `needs: build`, so it is skipped when `build` is skipped. No branch name is hard-coded. `branches-ignore: monitor-data` with no tag filter means tag pushes don't trigger the workflow. The environment branch rule in setup step 2.4 is the second, independent gate.
- **Injection:** no `${{ }}` inside any `run:`. The only expressions are `github.token`, `github.repository`, `runner.temp` and `steps.deployment.outputs.page_url`, and they appear only in `env:` / `url:`. The lint enforces this (`test/workflows.test.js:35-49`). No `pull_request_target`, no `workflow_run`, no secrets. `build-site.mjs` validates `GITHUB_REPOSITORY` against a strict regex, takes page settings from `parseConfig`, injects them only through `meta-inject.js`, and refuses to build into a folder outside `root`.
- **Permissions:** `permissions: {}` at the top of all three workflows. The lint checks each job's grants exactly (`test/workflows.test.js:20-24, 51-61`). All three files use `persist-credentials: false`, Node 24, and no cache. `npm ci --ignore-scripts` uses the locked `tools/a11y` (F12).

---

## Findings (ranked)

### R1 MUST-FIX: every config error is shown to visitors as "a site we couldn't check"
- **Where:** `src/cli.js:171` (`configErrorCount: cfg.errors.length`) and `site/render.js:393-396` (the sentence "We couldn't check N of our sites…", plus the `partly` state at `:492`).
- **Problem:** `cfg.errors` includes setting errors (unknown key, `timeoutSeconds`, `staleAfterMinutes`, `siteName`, contact, cron) and duplicate-key errors, and none of these skip a site. With one such error and every site up, the page says "Everything we have checked is working. We couldn't check 1 of our sites because of a setup problem." The title says "Some sites not checked". Both statements are false, and the all-up state can't be reached until the typo is fixed. On the `some-down` path the sentence also replaces "Everything else is working." The wave 1 F2 fix only needed the count of **target entries that were skipped**.
- **Fix:** write the number of skipped sites, for example `cfg.errors.filter((e) => Number.isInteger(e.index)).length`. That counts invalid entries, carried or not, plus entries past 20. Use it either in place of `configErrorCount` or as a new `skippedTargetCount` header field; the field needs `isValidStoredData` and `render.js` validation. Keep the setting-error count for the summary and the issue only. Add a test: an unknown setting key plus an out-of-range `timeoutSeconds`, with all sites up, gives `all-up`. Also add a test where one invalid target entry gives "couldn't check 1".

### R2 MUST-FIX: `keepalive` runs unreviewed branch code with `actions: write` on a manual run
- **Where:** `.github/workflows/monitor.yml:21-39`. The job has no `if`, and `test/workflows.test.js:128` asserts that it has none.
- **Problem:** "Run workflow" on a branch whose `src/` differs from the default branch skips `monitor`, but `keepalive` checks out that branch and runs its `src/cli.js` with an `actions: write` token. That token can disable `monitor.yml` (which silently stops all monitoring), cancel or re-run runs, delete logs, artifacts and caches, and dispatch workflows on any ref. This contradicts the reasoning in the comment at `monitor.yml:42-44` and in threat model F6. The `if` costs nothing here: scheduled runs, which are the only runs the 60-day keepalive needs, always pass it.
- **Fix:** give `keepalive` the same `if:` as `monitor`. In the test, change `:128` to assert that both jobs have the same gate.

### R3 SHOULD-FIX: "you merge it" is not enforced; F6(b) is reduced, not closed
- **Where:** `docs/release/rulesets/default-branch.json:18` (`required_approving_review_count: 0`) and `docs/release/uptime-monitor-owner-setup.md:44`.
- **Problem:** with 0 approvals, any identity with write access (agents included, if they share or hold write credentials) can open a PR and merge it once `validate` is green. The PR can even change `validate.yml` itself, because PR runs use the head's workflow files. So "nobody, agents included, can push straight to the default branch" is true, but "you merge it" is a habit, not a control. 0 approvals is forced while agents and the owner share an identity (F15), because a person can't approve their own PR.
- **Fix:** state the residual risk plainly in step 3.1 and point to F15. When agents get their own identity, raise the count to 1 and tick "Prevent self-review" in step 2.2. No code change.

### R4 SHOULD-FIX: the accessibility check is not a required status check
- **Where:** `docs/release/rulesets/default-branch.json:29` (only `validate`); the setup doc, step 3.1.
- **Problem:** AC-P10 says there must be zero serious or critical violations, but the `a11y` job can fail and the PR still merges.
- **Fix:** add `{ "context": "a11y" }`. It has no path filter either, so it always reports.

### R5 SHOULD-FIX: architecture §11 no longer matches the workflows
- **Where:** `docs/architecture/uptime-monitor.md:318-320, 326, 328`.
- **Problem:** the table still says `validate` has path filters (it intentionally has none), `pages.yml` triggers on `main`, and the deployment branch is `main`. "Why data refreshes never deploy" reasons (2) and (4) are now wrong: `monitor.config.json` is in `pages.yml` paths (`pages.yml:21`), so every config edit on the default branch opens a pending deployment that waits for the owner. Reason (3) misses that `actions: write` can dispatch a workflow. The conclusion still holds because of the approval gate, but the doc must say why.
- **Fix:** update §11 to match the workflows as built, and say that adding a target creates a pending (harmless) deploy request.

### R6 NIT: the a11y check can pass while testing only the load-error page
- **Where:** `scripts/a11y-check.mjs:95-101, 116-124`.
- **Problem:** the page might not reach the fixture server: a CSP `connect-src` change, a certificate or `host-resolver-rules` problem, or CORS. If so, every fixture renders the load-error state, and axe reports a clean run on 13 copies of one page.
- **Fix:** count data-server hits per fixture name, and fail if any fixture other than `load-error` was never fetched.

### R7 NIT: `pages.yml` paths miss files the build imports
- **Where:** `.github/workflows/pages.yml:18-23`.
- **Problem:** `build-site.mjs` → `src/config.js` → `src/ssrf.js` and `src/jsonloc.js`. A change there that affects page settings won't trigger a rebuild. `workflow_dispatch` covers it, so this is low impact.
- **Fix:** add `src/ssrf.js` and `src/jsonloc.js`, or just `src/**`.

### R8 NIT: Node 24 is still not proven
- The first CI `validate` run is the proof for wave 1 F7: the R6 lookup tests and the WHATWG re-check tests. Check that run's log before you tick F7.

## Notes and assumptions
- Assumed: a repository's "Read" default for workflow permissions does not stop a workflow file from requesting write permissions. That is why I call the `if` gates protection against branch code, not against people with push access.
- I fetched the `@axe-core/cli@4.13.0` tarball into the scratchpad to check how `--chrome-options` is parsed. It splits on `,` and on `;`, so `scripts/a11y-check.mjs:112` is correct.
- No tracked file was changed apart from this report.
