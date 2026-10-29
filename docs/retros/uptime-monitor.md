# Retrospective: uptime-monitor (the team's first project)

- **Author:** director-of-continuous-improvement. **Date:** 2026-10-29.
- **Evidence read:**
  - `git log --stat`: 15 commits, `520e47b`..`6ec3727`.
  - Feature docs: spec, design, architecture, ADRs, tasks, threat model, `docs/release/`, the decisions file, `docs/status.md`, the backlog.
  - Panels: Brain Trust (first product, and spec v1) and the Focus Group.
  - Reviews and QA: code review wave 1, round 2 and round 3; QA T14 and T18.
  - Facts from the manager.
- **Path note:** my agent file says `docs/improvements/retro-<feature>.md`, and the manager asked for `docs/retros/`. I followed the manager. Backlog #15 fixes the mismatch.

## Summary

The team shipped a working monitor in about 75 minutes of commit time, and it now checks three of the team's live sites. Review and QA did their jobs: two of three review rounds sent work back with reproduced must-fix bugs, and QA caught size-budget bugs the tests missed.

The biggest failure was not in the code. **The team built a public product for a user who doesn't exist.**
- The spec's primary persona was a hypothetical small-site owner who copies a public template (spec §2, P1), plus a public page visitor (P2). The real user, the team, was "P0: dogfood".
- At the end the CEO said he won't use it and that it's an internal tool.
- The public status page, the template setup path, the owner checklist and most of the accessibility work were for people who will never see them. That is about 43% of the production code.

One kickoff question would have prevented this.

## Metrics (baseline)

| Metric | Value | Source |
|---|---|---|
| First spec commit to last commit | ~1 h 13 min | `793ec23` 23:40 → `6ec3727` 00:53 |
| Subagent runs | ~36: ~22 role runs, 9 Brain Trust members, 5 personas | manager |
| Panel share of runs | ~39% | |
| Code-review rounds | 3. Wave 1 REQUEST CHANGES (2 must-fix, 4 should-fix); round 2 REQUEST CHANGES (2 must-fix, 3 should-fix); round 3 APPROVE WITH NITS | `docs/reviews/` |
| Bugs introduced by fixes | at least 1 confirmed must-fix (R1, from F2). The config-error concept bounced 4 times (F2 → R1 → T18 B1 → N1) | reviews, T18 |
| QA bugs before release | T14: 3 major, 1 minor. T18: 5 minor, 3 nits | `docs/qa/` |
| Bugs after release | 0 so far (live for under an hour) | |
| Largest commit | 5,298 insertions (`95b4ba3`, T1-T11) | git log |
| Tests | 285 → 339 (Node 24 CI run 40794873724) | commit message, T18 |
| Hard-stop near-misses | 1 (unprotected `github-pages` environment) | ADR-0005 |
| CI duration | not recorded | backlog #14 |

## What went well

1. **Code review found real bugs and proved them.** Wave 1 F1 was reproduced end to end: 5 failed runs opened 0 outage issues because state reset every run. Round 2 caught R2: the `keepalive` job ran unreviewed branch code with `actions: write`. Round 3 approved only after listing what it checked.
2. **QA simulation beat unit tests.** T14 simulated a year of history and found that input the validator accepts could break the store's own byte budgets (B1-B4). It also measured `.git` growth (24 MiB/yr), which closed spec risk R3 with data.
3. **The spec Brain Trust improved the architecture.**
   - What it added: the data/deploy split (ADR-0004/0005), a single config-error issue instead of failing every run, the keepalive, and the stale-gap issue.
   - Where it cut scope: per-day aggregates instead of raw checks (the Budget Hawk).
   - All of it still serves the internal tool.
4. **The first Brain Trust found a blocker before any code.** `gnoshcodes` is private, so no free Pages and no environment gates. That led to the public `gnosh-uptime` repo.
5. **Hard stops held.** When the environment gate turned out to be missing, devops added a second lock instead of working around it. Nobody routed around the blocked push to `main`.
6. **Evidence habits.** QA hashed `src/*.js` to prove what it had tested. Reviews cite files and run IDs.

## What hurt (with evidence)

1. **The real user was never confirmed.**
   - The spec's primary user was invented (spec §2). Assumption 1 ("Owners … can create a repo from a template") went through under the playbook rule "Accept the PM's stated assumptions."
   - At the first Brain Trust the User member said "Ask him." The manager asked only "does Brian trade?", never "will you use what we build, and how?"
   - The real answer arrived at the end (decisions file, 2026-10-29).
2. **Over-built for that invented user.** The public page alone is about 43% of production code (engine `src/` is 2,018 lines). Everything built for P1 and P2:

   | Built for P1/P2 | Size |
   |---|---|
   | `site/` page code (non-test) | 1,151 lines |
   | `build-site.mjs`, `a11y-check.mjs`, `pages.yml` | 349 lines |
   | Page tests | 566 lines, plus 13 fixtures |
   | `tools/a11y` lockfile | 1,141 lines |
   | Visitor-page design (§3-§8) | ~460 of 838 lines |
   | Template README setup and positioning | ~200 lines |
   | Owner checklist and rulesets | 125 lines |
   | Also | ADR-0004/0005, threat model F1-F4, AC-X3/X4 |

   Review and QA effort followed the code:
   - Wave 1 F8; round 2 R1, R4, R6 and R7; round 3 N2; T18 B2 and B3; and backlog items 1-3 are all page or template-setup findings.
   - T14 B3, the header overflow, came from `siteName` and `contactLink`, two fields that exist only for the page.
3. **The Focus Group added scope in the wrong direction.**
   - None of its 5 personas was the real user.
   - It drove the plain-language and screen-reader headline, the contact line, the Upptime positioning and the AC-X3 wording. All of that is now unneeded.
   - Its top theme ("the monitor needs monitoring") repeated the Brain Trust's.
   - Its "hypotheses to check with real users" can never be checked.
4. **Agents shared one working tree.**
   - T14 gave two verdicts ("`95b4ba3`" and "current working tree (uncommitted fixes)") and says "`src/` changed under me partway through." Some tests were flaky while files changed mid-run.
   - T18 cites `src/transport.js:378` (the file has 86 lines) and `pages.yml:131` (76 lines).
   - Review F1 and QA T14 B1 are the same bug, found twice at the same time.
5. **Fixes caused regressions, and one problem bounced 4 times.**
   - The F2 fix wrote `configErrorCount = cfg.errors.length`, and the page read that as "sites we couldn't check" (R1: "The bug is new in this commit").
   - The same concept came back as T18 B1 and round 3 N1.
   - The ">3 bounces → re-plan" rule never fired.
6. **Byte budgets were wrong, and nothing tested them.** Architecture §7 left out `siteName` and `contactLink`. The validator checked raw input, but the store checked `URL.href`, punycode and lone surrogates (F1, T14 B1-B4). §7 kept the old numbers afterwards (T14 "Doc drift").
7. **Hard stop 1 near-miss.** The first `pages` run (40793957262) reached `deploy-pages` with no approval, because GitHub auto-creates `github-pages` with no reviewer. It failed only because Pages was off (ADR-0005, owner checklist).
8. **Big-bang build, and the agreed shakedown was skipped.**
   - The first Brain Trust's compromise was a milestone 1 (one URL, page, staging) followed by a mini-retro. Neither happened.
   - `95b4ba3` landed T1-T11 (5,298 lines) at once.
   - The real targets replaced the `example.com` placeholders only in the second-to-last commit (T18 B4).
9. **Repo setup came last.** The direct push to `main` was blocked, so the default branch is `claude/project-thread-0jnua7`. Workarounds for it are spread through ADR-0005, the owner checklist (step 1.3) and the rulesets.

## Root causes

1. **The playbook pushes action over confirmation, and has no step that confirms the user.**
   - "Public template for strangers" vs "internal team tool" fits the playbook's own trigger for asking: "different readings would lead to substantially different products".
   - But nothing tells the manager to check who the user is.
   - The PM can't ask the CEO, so it invents personas, and step 1 tells the manager to accept them.
2. **Panels are built from the spec's personas,** so a wrong user propagates into every panel. Every panel finding went into spec v2 with no cost-benefit pass, so scope only grew.
3. **Process recommendations from panels have no owner.** Rule 9 ("act on it or say why not") was applied to spec findings and not to the milestone and mini-retro recommendation.
4. **Parallel work without isolation.** "Run independent agents in parallel" says nothing about worktrees or pinning reviewers and QA to a commit.
5. **Bounces are counted per task, not per problem.** No definition of the shared "config error" concept existed, and no rule says a fix must check every consumer of a value it changes.
6. **Budgets were arithmetic in a doc.** No invariant said "validator accepts ⇒ store accepts", and no property test checked it.
7. **The deploy gate was assumed.** Nobody checked environment protection before pushing a workflow with a deploy job.
8. **No bootstrap step for repo prerequisites:** visibility, `main`, default branch, Pages.

## Feedback-quality audit

| Panel or review | Changed decisions? | Value |
|---|---|---|
| Brain Trust: first product | Yes: picked C, found the private-repo blocker | High. Its best signal ("Ask him") was acted on too narrowly, and its process recommendation was dropped. Not unanimous, and dissent was kept. |
| Brain Trust: spec v1 | Yes, the most of any panel | High. The only panel that cut scope. Some hardening rested on "the template is public, so other people will run it." |
| Focus Group | Yes, but every change added scope for users who don't exist | Low. Lowest value per run. |
| Code review ×3 | Yes: 4 must-fix and 7 should-fix acted on | High |
| QA T14/T18 | Yes: size bugs, the AC-X3 gap, placeholder targets | High. T14 duplicated review F1. |

**Unchallenged changes:**
- The panels' additions to spec v2 (spec §14).
- The UX request for more Focus Group rounds.
- "JSON, not YAML", which was harmless.

## Proposals

Proposals are ranked in `docs/improvements/backlog.md`, items 4-15. Per my rules, only three are high priority:

1. **Confirm the real user at kickoff, and seat that user in every panel (#4).** CLAUDE.md, `product-manager.md` and the `focus-group` skill.
2. **One worktree per writing agent; review and QA a pinned SHA only (#5).** CLAUDE.md, `code-reviewer.md` and `qa-engineer.md`.
3. **Deploy jobs ship locked; check environment protection before the first push (#6).** `devops-engineer.md`.

Medium priority:
- an invariant and property test for budgets, with fast-check on Trial (#7);
- counting bounces per problem, and checking every consumer of a changed value (#8);
- a thin slice first, then a mini-retro, with smaller review batches (#9);
- a `project-bootstrap` skill (#10);
- zizmor workflow lint, on Trial (#11);
- recording the dormant public-page scope (#12).

Low priority: #13-15.

#4, #5, #8 and #9 change how the whole team works, so **I recommend a Brain Trust review of them before adoption**. Include a member who speaks for the CEO as the user of an internal tool. I edited no playbook or agent files. Every change above is a proposal.

## Assumptions

- "43%" is a line count: the non-test files under `site/`, plus `build-site.mjs`, `a11y-check.mjs` and `pages.yml` (about 1,500 lines), against `src/*.js` (2,018 lines). It is not a measure of effort.
- The out-of-range line citations in T18 are drift or error. I didn't work out which.
- The tool facts come from the npm and PyPI registry entries, which I opened. The GitHub API wasn't reachable for these repos in this session, so stars and open-issue counts are unverified.
