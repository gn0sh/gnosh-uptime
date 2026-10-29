# Improvement backlog

Ranked by impact over effort. Maintained by `director-of-continuous-improvement`.

| # | Title | Type | Owner | Effort | Impact | Status |
|---|---|---|---|---|---|---|
| 1 | Config-error issue: page-setting and duplicate-key errors say "uses its default", but the page build fails instead (review round 3 N1) | bug | backend-engineer | S | Low | Open |
| 2 | a11y check counts data requests, not successful loads (review round 3 N2) | test gap | devops-engineer | S | Low | Open |
| 3 | Update design §10.3/§10.4 and architecture §8.2 issue wording to match code | docs | technical-writer | S | Low | Open |
| 4 | Confirm the real user at kickoff; seat that user in every panel (retro uptime-monitor) | process (CLAUDE.md, product-manager.md, focus-group skill) | manager, then product-manager | S | **High** | Proposed: Brain Trust first |
| 5 | One git worktree per writing agent; reviewers and QA test a pinned SHA only | process (CLAUDE.md, code-reviewer.md, qa-engineer.md) | manager, then devops-engineer | S | **High** | Proposed: Brain Trust first |
| 6 | Deploy jobs ship locked; check environment protection before the first push | agent (devops-engineer.md) | devops-engineer | S | **High** | Proposed |
| 7 | Cross-module invariants and a property test: "validator accepts ⇒ store accepts" | agent (software-architect.md) + tool (fast-check, Trial) | software-architect, backend-engineer | M | Medium | Proposed |
| 8 | Count bounces per problem, not per task; a fix that changes a shared value's meaning checks every consumer | process (CLAUDE.md, backend/frontend-engineer.md, code-reviewer.md) | manager | S | Medium | Proposed |
| 9 | Milestone-1 thin slice, then a mini-retro; cap review batches at about 800 changed source lines | process (CLAUDE.md) | manager | S | Medium | Proposed |
| 10 | `project-bootstrap` skill: visibility, plan, `main`, default branch, Pages, asked of the owner once at start | skill | devops-engineer, then technical-writer | S | Medium | Proposed |
| 11 | Workflow security lint (zizmor) in `validate` | tool (Trial) | devops-engineer (security-engineer reviews first) | S | Medium | Proposed |
| 12 | Record the public page, template setup and owner checklist as dormant; stop maintaining them | process / docs | product-manager, technical-writer | S | Medium | Proposed |
| 13 | Panel reports end with a "Decisions this changed" table | skill (brain-trust, focus-group) | manager | S | Low | Proposed |
| 14 | Start `docs/improvements/metrics.md`; record CI duration per run | process | director-of-continuous-improvement, devops-engineer | S | Low | Proposed |
| 15 | Fix the retro path mismatch (agent file says `docs/improvements/retro-<feature>.md`, practice is `docs/retros/<feature>.md`) | agent (director-of-continuous-improvement.md) | director-of-continuous-improvement | S | Low | Proposed |

Rank order by impact over effort: 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, then 1, 2, 3. Items 1 to 3 are low-impact nits, and mostly concern the now-dormant public page.

## Details: items 4-15 (from `docs/retros/uptime-monitor.md`)

Playbook edits below are proposals only. Nobody has edited CLAUDE.md or any agent file. Items 4, 5, 8 and 9 change how the whole team works, so they need a Brain Trust review before adoption. Give that panel a member who speaks for the CEO as the user.

### 4. Confirm the real user at kickoff (High, S, process, build)
- **Problem:** spec §2 made a hypothetical template user (P1) and a public visitor (P2) primary. At the end the CEO said he won't use the product and that it's an internal tool. About 1,500 lines of page and deploy code (about 43% of production code), 566 test lines, about 460 design lines, and the owner checklist and rulesets went to waste. At the first Brain Trust the User member said "Ask him." The manager asked only whether Brian trades.
- **Change (CLAUDE.md):**
  - Insert a new pipeline step before "1. **Define**": "0. **Confirm** (one batched message to the CEO, with a recommended answer for each, and keep working on the recommended answers): (a) Who will use this: you, the agent team, or named outside people? How often? (b) Public or internal? (c) What does done look like for you? (d) Repo prerequisites (see the `project-bootstrap` skill). The confirmed user goes in the spec as 'Primary user (confirmed by CEO, <date>)'."
  - Add to "Only pause for the human when (a)": "The primary user always counts as unclear until the CEO has named it."
  - In step 1, replace "Accept the PM's stated assumptions" with "Accept the PM's stated assumptions, except any assumption about who the user is."
- **Change (`product-manager.md`, Rules):** "If the primary user isn't confirmed by the CEO, put it first under Open questions, marked 'changes the goal'. Don't make up a primary persona. Write 'Users nobody has confirmed' for hypothetical segments."
- **Change (`focus-group` SKILL.md, step 1):** "At least one persona must be the confirmed primary user. If the only real user is the CEO or the agent team, don't simulate them. Ask the CEO three questions instead."
- **Impact:** high. This one question would have removed most of this project's over-build. **Risk:** more pauses for the CEO. It's limited to one batched message per project, and work goes on with the recommended answers in the meantime.

### 5. Worktree isolation and pinned-SHA verification (High, S, process, adopt git worktree)
- **Problem:**
  - T14 had to give two verdicts (`95b4ba3` and "uncommitted working tree") and hash `src/` to know what it had tested.
  - Tests were flaky while files changed mid-run.
  - T18 cites lines past the end of files (`src/transport.js:378`, `pages.yml:131`).
  - Review F1 and QA B1 are the same bug, found twice at the same time.
- **Change (CLAUDE.md, "Rules for the manager"):**
  - "Run each writing agent in its own git worktree (`git worktree add ../<repo>-<role> <branch>`, or the Agent tool's worktree isolation), and merge through commits."
  - "Give `code-reviewer`, `security-engineer` and `qa-engineer` a commit SHA. They check it out in a clean worktree, and their report names that SHA."
  - "Never review or test an uncommitted tree."
- **Change (`code-reviewer.md` and `qa-engineer.md`, Rules):** "Start by recording `git rev-parse HEAD` and `git status --porcelain`. If the tree is dirty, stop and ask for a SHA."
- **Impact:** high. It removes the flakiness and the ambiguous verdicts. **Risk:** merge conflicts move to merge time, which keeps them visible. Worktrees use some disk.

### 6. Deploy jobs ship locked (High, S, agent, build)
- **Problem:** in a hard stop 1 near-miss, run 40793957262 reached `deploy-pages` with no approval, because GitHub auto-creates `github-pages` with no reviewer (ADR-0005, owner checklist).
- **Change (`devops-engineer.md`, Rules):**
  - "Any job that deploys to an environment real users can reach lands disabled: `if: vars.<NAME>_DEPLOY_ENABLED == 'true'`. The owner sets the variable as the last setup step."
  - "Before the first push of such a workflow, run `gh api repos/{owner}/{repo}/environments/{env}`. If the environment doesn't exist yet, record that GitHub will create it unprotected on first use."
  - "A workflow test asserts the lock is present."
- **Impact:** high. It closes a gap in a hard stop. **Risk:** one extra owner step per product.

### 7. Invariants and property tests for budgets (Medium, M, agent + tool, adopt)
- **Problem:** review F1 and QA T14 B1-B4 share one cause. The validator checked the raw input, but the store checked the normalized form (`URL.href`, punycode, lone surrogates). Architecture §7's header budget left out `siteName` and `contactLink`.
- **Change (`software-architect.md`, Rules):** "For every size or limit budget, list each field with its maximum encoded size in bytes. State cross-module invariants (e.g. 'anything `parseConfig` accepts, `serializeData` and `readData` accept') as tasks with a property test."
- **Change (engineers):** write the property test with fast-check as a devDependency (zero runtime deps still holds).
- **Tool:** fast-check, https://registry.npmjs.org/fast-check: latest 4.10.2 (2026-09-19), MIT. Security review needed before install.
- **Risk:** slower tests. Cap the number of runs in CI.

### 8. Bounce counting by problem; check every consumer of a changed value (Medium, S, process)
- **Problem:** "config error" bounced 4 times: F2 → R1 (bug introduced by the fix) → T18 B1 → N1. The ">3 bounces → architect re-plans" rule never fired, because the bounces fell under different finding IDs.
- **Change (CLAUDE.md, loop limit):** "Count bounces per problem area across code review, security and QA, not per task. When one area comes back a third time, the architect defines the concept and lists every consumer before the next fix."
- **Change (engineer agents):** "When a fix changes what a stored or shared value means, grep every consumer, list them in the commit message, and add a test at each."
- **Change (`code-reviewer.md`):** "For fix commits, review each consumer of the changed values, not only the diff."

### 9. Thin slice first, smaller review batches (Medium, S, process)
- **Problem:** the first Brain Trust's agreed milestone and mini-retro never happened. T1-T11 went in as one 5,298-line commit. Placeholder targets survived until T18.
- **Change (CLAUDE.md, step 3):** "Build milestone 1 as a thin end-to-end slice on the real user's real data. Then run `director-of-continuous-improvement` for a mini-retro before widening. Send work to review in batches of about 800 changed source lines or less."
- **Change (CLAUDE.md, rule 9):** "Process recommendations from panels are findings too. Give each an owner, or write down why not."

### 10. `project-bootstrap` skill (Medium, S, skill, build)
- **Problem:** the private-repo blocker surfaced at the first Brain Trust. The direct push to `main` was blocked, so the default branch is `claude/project-thread-0jnua7`. ADR-0005, the owner checklist and the rulesets carry workarounds for it.
- **Change:** add `.claude/skills/project-bootstrap/SKILL.md`, a checklist the owner answers in the step-0 message:
  - repo visibility and plan (Pages, environments, Actions minutes);
  - create `main` and make it the default;
  - Pages source;
  - who has push access.

### 11. Workflow security lint (Medium, S, tool, adopt, Trial)
- **Problem:** round 2 R2 (`actions: write` on unreviewed branch code) was found by hand. The team also hand-wrote a YAML mini-parser for its workflow tests (`test/helpers/mini-yaml.js`, 136 lines).
- **Change:** trial zizmor in `validate`.
  - Link: https://pypi.org/pypi/zizmor/json (1.31.1, MIT; source: github.com/zizmorcore/zizmor; docs: docs.zizmor.sh).
  - Not yet verified: whether it would have flagged R2 specifically. The trial should replay R2.
  - Security review comes first.

### 12. Record dormant scope (Medium, S, process / docs)
- **Problem:** the page, `pages.yml`, the a11y job, the owner checklist, AC-X3 and AC-X4, and backlog items 1-3 now serve no user, but CI and the docs still maintain them.
- **Change:** the PM marks these "Dormant (internal tool, 2026-10-29)" in the spec. The writer cuts the README down to internal usage. The manager decides whether the a11y job stays in CI.
- **Product decision:** keep the code, don't delete it. Deletion is reversible through git, but it isn't needed.

### 13. "Decisions this changed" table in panel reports (Low, S, skill)
- **Problem:** the Focus Group changed decisions only by adding scope for users who don't exist. Nothing made that visible.
- **Change:** `brain-trust` and `focus-group` SKILL.md reports end with a table: finding | decision changed (yes/no) | adds or cuts scope | owner.

### 14. Metrics file (Low, S, process)
- **Change:** create `docs/improvements/metrics.md` from the retro's baseline:
  - about 36 subagent runs, 39% of them panels;
  - 3 review rounds, 4 must-fix findings;
  - QA: 3 major, 5 minor;
  - 0 post-release bugs so far;
  - largest commit 5,298 lines.
- devops-engineer adds CI run duration to it.

### 15. Retro path mismatch (Low, S, agent)
- **Change:** in `director-of-continuous-improvement.md`, change "Write the retro to `docs/improvements/retro-<feature>.md`" to "Write the retro to `docs/retros/<feature>.md` (sections: what went well, what hurt with evidence, root causes, proposals)."
