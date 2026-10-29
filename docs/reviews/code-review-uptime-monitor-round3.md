# Code review: uptime-monitor round 3 (e03c90c..4b688c2)

- **Reviewer:** code-reviewer (read-only). **Date:** 2026-10-29
- **Scope:** `git diff e03c90c..4b688c2 -- src site test scripts .github`, plus the ruleset, the setup doc, the README deploy-variable lines and architecture §11, but only where they back a code change.
- **Not reviewed:** `test/sim/` and `docs/qa/`.
- **Tests:** `npm test` passes, 345 of 345, on Node 22.22.0. Node 24 still waits for the first CI run (round 2 R8).

## Verdict: APPROVE WITH NITS

Every round 2 finding (R1 to R7) is fixed and has a test where a test makes sense. The new changes are correct. I found no must-fix and no should-fix.

**The most serious problem left is N1, and it is a nit.** When the only errors are in page settings (`siteName`, `contact`, `contactLink`) or are duplicate keys, the new "settings" wording in the config-error issue says *"the monitor uses its default for it."* For page settings, `scripts/build-site.mjs:55-56` actually fails the page build. For a duplicate key, the parser keeps one of the values, not the default. Only the owner sees this text, it doesn't change what visitors see, and `validate` fails on the same errors anyway.

## Round 2 findings

| # | Status | Evidence |
|---|---|---|
| R1 | **Fixed** | `src/config.js:294-302` adds `skippedTargetCount`: it counts distinct entry `index` values, so one entry with several problems counts once, and settings and duplicate keys don't count. It is used for `configErrorCount` (`src/cli.js:171`). Tests in `test/cli.test.js` cover a setting typo with all sites up rendering `all-up`, one entry with several problems counting once, and the stored count. The new fixture `site/fixtures/config-error-count.json` puts the "couldn't check" state through axe. |
| R2 | **Fixed** | `.github/workflows/monitor.yml:25` gives `keepalive` the same gate as `monitor`. The lint asserts that both gates are identical (`test/workflows.test.js:139`). Scheduled runs always pass the gate, so the 60-day keepalive is unaffected. |
| R3 | **Fixed (doc)** | `docs/release/uptime-monitor-owner-setup.md:45` now states the residual risk plainly: a PR with 0 approvals can be self-merged, and a PR can change `validate.yml`. It points to F15. |
| R4 | **Fixed** | `docs/release/rulesets/default-branch.json:29` requires `validate` and `a11y`. Neither has a path filter. |
| R5 | **Fixed** | Architecture §11 now matches the workflows: no path filter on validate, default-branch gating with no branch name, the config path triggering pages, the deploy variable, and the keepalive dispatch note in reason 4. |
| R6 | **Fixed** | `scripts/a11y-check.mjs`: `missingFetches` fails the run if any case, including the 404 load-error case, was never requested. See N2 for a small remaining gap. |
| R7 | **Fixed** | `pages.yml` paths include `src/ssrf.js` and `src/jsonloc.js`. The lint checks the full list. |

## New changes reviewed

- **Deploy gate:** `if: vars.GU_DEPLOY_APPROVAL_CONFIGURED == 'true'` on `deploy` (`pages.yml`). A job-level `if` without a status function still gets the implicit `success()`, so the job is still skipped when `build` is skipped or fails. The variable can't be injected: it appears only in an `if:` and is compared to a literal. The lint pins both the variable name and the fact that it is used only in `if:`. On a personal-account repo only the owner can create repository variables, so collaborators and agents can't turn the gate on. It is a second lock; the environment reviewer stays the main one. The setup doc orders the steps correctly (reviewer first, variable last), and README step 5 and its troubleshooting line cover template users.
- **QA B1, config-error wording:** `configErrorImpact` returns `nothing`, `some` or `settings` (`src/issues.js:311-315`). The title is now part of the hash, so a change of impact PATCHes both title and body, and that is tested. The run summary matches. The `held` and unparseable cases say "no site was checked". This is correct apart from N1.
- **QA B4, surrogates:** `\p{Cs}` is added in all four control-character regexes (`src/config.js:29-30`, `src/datastore.js:23`, `src/issues.js:19`). No other copies exist in `src/`, `site/` or `scripts/`. Names, `siteName`, `contact` and `contactLink` reject lone surrogates. In URLs, `new URL` turns a lone surrogate into an encoded U+FFFD, and the href length limit already covers that. `isValidStoredData` now rejects them in stored data (tested). The writer and the reader use the same set, so the F1-style silent reset can't come back. One side effect: data written before this change that contains a lone surrogate would be reset once. Nothing has been released yet, so this doesn't apply.
- **QA B5, stale wording:** the text now fits one site or many. It is static, with no new interpolation.
- **New fixture:** valid against the renderer, and picked up automatically by `fixtureNames`. It is asserted in `test/build-site.test.js`.

## Nits

### N1: the "settings" issue wording is wrong for page settings and duplicate keys
- **Where:** `src/issues.js:321` (`impactSentence`, the `settings` branch).
- **Problem:** the text says "the monitor uses its default for it." For `siteName`, `contact` and `contactLink` errors the page build fails (`scripts/build-site.mjs:55-56`), so the next deploy is blocked. For a duplicate key, one of the given values is used, not the default.
- **Fix:** say "Until a setting below is fixed, the monitor uses its default for it, and the status page can't be rebuilt if it is the page name or contact", or word it per error type.

### N2: the a11y fetch check counts requests, not successful loads
- **Where:** `scripts/a11y-check.mjs` (the `hits` counter).
- **Problem:** if the browser makes the request but then refuses to use the response, axe still tests the load-error page and the check still passes. One cause would be a future CORS or content-type change. Today the server sets the CORS header itself, so this risk is low.
- **Fix (optional):** have the page set a `data-state` attribute that the check can read, or count the hits as "served 200" separately from 404s.

## Assumptions
- On personal-account repositories, only the owner can manage Actions variables. I did not re-check this against current GitHub docs in this round.
- I changed no file except this report.
