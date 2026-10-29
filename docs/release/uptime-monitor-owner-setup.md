# Owner setup checklist: uptime-monitor (gn0sh/gnosh-uptime)

For the repo owner (**gn0sh**) only. Agents may not change repository settings, approve deployments or call the pending-deployments API (threat model F15). Do the steps **in this order**, in the GitHub web UI. It takes about 10 minutes.

Today's default branch is **`claude/project-thread-0jnua7`**. The workflows and rulesets don't name a branch. The one place that does is step 1.3, so update that step when the default branch moves to `main`.

> **⚠ Do step 1 before you turn on Pages (step 3).** GitHub created the `github-pages` environment by itself on the first `pages` run (run 40793957262), and it has **no required reviewer**. That run went straight to the deploy step with no approval wait. It only failed because Pages wasn't turned on yet. If you turn on Pages first, the next push deploys to production with nobody approving it. As a second lock, the deploy job stays skipped until you set the variable in step 5, which is the last step.

## 1. The `github-pages` environment: add yourself as reviewer first (hard stop 1)

**Settings → Environments → `github-pages`.** If it isn't listed, click **New environment**, type exactly `github-pages` and click **Configure environment**.

- [ ] 1.1 **Deployment protection rules:** tick "Required reviewers" and add **gn0sh**.
  - Leave "Prevent self-review" **unticked**. Today you are the only reviewer and usually the one who merges, so ticking it would lock you out.
  - Untick **"Allow administrators to bypass configured protection rules"**, so no one using an admin identity can skip the approval.
  - Click **Save protection rules**.
- [ ] 1.2 Reload the page and check that "Required reviewers: gn0sh" is shown.
- [ ] 1.3 **Deployment branches and tags:** choose "Selected branches and tags". Click **Add deployment branch or tag rule** → Branch → `claude/project-thread-0jnua7` → **Add rule**. Remove every other rule, including `main` while `main` doesn't exist. **When the default branch becomes `main`:** add `main` here and remove the old rule.
- [ ] 1.4 Check that the environment has **no secrets and no variables**. None are needed.

## 2. Actions

**Settings → Actions → General**

- [ ] 2.1 **Actions permissions:** "Allow gn0sh, and select non-gn0sh, actions and reusable workflows". Tick "Allow actions created by GitHub". Leave "Marketplace verified creators" unticked and the allow list empty.
- [ ] 2.2 Tick **"Require actions to be pinned to a full-length commit SHA"** if you see it. Our workflows already pin every action this way.
- [ ] 2.3 **Approval for fork pull request workflows:** choose "Require approval for all external contributors".
- [ ] 2.4 **Workflow permissions:** choose "Read repository contents and packages permissions". Each job asks for its own permissions.
- [ ] 2.5 Untick **"Allow GitHub Actions to create and approve pull requests"**. Click **Save**.

## 3. Pages (only after step 1)

**Settings → Pages**

- [ ] 3.1 **Build and deployment → Source:** choose "GitHub Actions". Leave the custom domain empty for now.

## 4. Rulesets (threat model F6)

**Settings → Rules → Rulesets → New ruleset → Import a ruleset.** Import each file, check that it matches the description below, then click **Create**.

- [ ] 4.1 `docs/release/rulesets/default-branch.json`, named "default-branch":
  - Enforcement: **Active**. Bypass list: **empty**.
  - Target: **Include default branch**. This follows the default branch automatically when it changes.
  - Rules: Restrict deletions, Block force pushes, Require a pull request (0 approvals), and Require status checks **`validate`** and **`a11y`**.
  - **What this protects, and what it doesn't (residual risk, F15):** nobody can push straight to the default branch, and every change needs a pull request whose checks pass. But with 0 required approvals, **anyone with write access can merge their own PR once the checks are green, agents included** if they hold write credentials. A PR can also change `validate.yml` itself, because PR checks run the PR's own workflow files. So "the owner merges" is a habit, not something GitHub enforces. 0 approvals is unavoidable while agents and you share one GitHub identity, because nobody can approve their own PR. **When agents get their own identity:** set required approvals to 1 here, and tick "Prevent self-review" in step 1.1 (threat model F15).
- [ ] 4.2 `docs/release/rulesets/monitor-data.json`, named "monitor-data":
  - Enforcement: **Active**. Bypass list: **empty**.
  - Target: branch `monitor-data`.
  - Rules: **only** Restrict deletions and Block force pushes. Don't add "Restrict updates" or "Require a pull request", because either one would block the monitor's data writes.

## 5. Turn deploys on: last step

- [ ] 5.1 Check step 1.2 again: the reviewer is gn0sh.
- [ ] 5.2 **Settings → Secrets and variables → Actions → Variables tab → New repository variable.**
  - Name: `GU_DEPLOY_APPROVAL_CONFIGURED`
  - Value: `true`
  - Click **Add variable**.

  Until this exists, the `pages` workflow builds the page but **skips the deploy job**. To stop all deploys later, delete the variable or set it to anything other than `true`.

## 6. First deploy and first run (hard stop 1)

- [ ] 6.1 **Actions → pages → Run workflow** on the default branch. The deploy job must show **"Waiting for review"**. If it starts deploying without waiting, cancel the run and repeat step 1.
  - Open **Review deployments**, tick `github-pages`, and click **Approve and deploy**.
  - Approve only runs from the default branch that you expect.
- [ ] 6.2 **Actions → monitor → Run workflow** on the default branch once. Then check that:
  - the `monitor-data` branch exists;
  - the run summary lists the targets;
  - the keepalive line says it succeeded;
  - the page loads data.
- [ ] 6.3 Write down today's date as the "last human commit" for the 60-day keepalive watch (T19, ADR-0002).

## What to expect afterwards

- Editing `monitor.config.json` on the default branch starts a `pages` run whose deploy waits for your approval. That is because the site name and contact line are part of the page. New targets show up on the page through data within about 2 runs, whether or not you approve. If you didn't change the site name or contact line, you can leave that deploy request unapproved or reject it.
- Nothing else is needed: no secrets, personal tokens or apps. Only `GITHUB_TOKEN` is used.
