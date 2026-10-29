# Owner setup checklist: uptime-monitor (gn0sh/gnosh-uptime)

For the repo owner (**gn0sh**) only. Agents may not change repository settings, approve deployments or call the pending-deployments API (threat model F15). Do these in order, in the GitHub web UI. Takes about 10 minutes.

Today's default branch is **`claude/project-thread-0jnua7`**. The workflows and rulesets don't name a branch. The one place that does is step 2.4, so change that when the default branch moves to `main`.

## 1. Actions

**Settings → Actions → General**

- [ ] 1.1 **Actions permissions:** choose "Allow gn0sh, and select non-gn0sh, actions and reusable workflows". Tick "Allow actions created by GitHub". Leave "Allow actions by Marketplace verified creators" unticked and the allow list empty.
- [ ] 1.2 Tick **"Require actions to be pinned to a full-length commit SHA"** if you see it. Our workflows already do this.
- [ ] 1.3 **Approval for fork pull request workflows:** "Require approval for all external contributors".
- [ ] 1.4 **Workflow permissions:** "Read repository contents and packages permissions". Each job asks for what it needs itself.
- [ ] 1.5 Untick **"Allow GitHub Actions to create and approve pull requests"**. Click **Save**.

## 2. Pages and the `github-pages` environment (hard stop 1)

**Settings → Pages**

- [ ] 2.1 **Build and deployment → Source:** "GitHub Actions". Leave the custom domain empty for now.

**Settings → Environments → `github-pages`.** If it isn't listed, click **New environment**, type exactly `github-pages` and click **Configure environment**.

- [ ] 2.2 **Deployment protection rules:** tick "Required reviewers" and add **gn0sh**. Leave "Prevent self-review" **unticked**. Today you are the only reviewer and usually the one who merges, so ticking it would lock you out. Tick it only if agents get their own GitHub identity (F15).
- [ ] 2.3 Untick **"Allow administrators to bypass configured protection rules"**, so nobody using an admin identity can skip the approval. Click **Save protection rules**.
- [ ] 2.4 **Deployment branches and tags:** pick "Selected branches and tags". Click **Add deployment branch or tag rule** → Branch → `claude/project-thread-0jnua7` → **Add rule**. Remove any other rule, including `main` while `main` doesn't exist. **When the default branch becomes `main`:** add `main` here and remove the old rule.
- [ ] 2.5 Make sure the environment has **no secrets and no variables**. None are needed.

## 3. Rulesets (threat model F6)

**Settings → Rules → Rulesets → New ruleset → Import a ruleset.** Import each file below, check that it matches, then click **Create**. If import isn't offered, create a **New branch ruleset** by hand with the values given.

- [ ] 3.1 `docs/release/rulesets/default-branch.json`, named "default-branch":
  - Enforcement: **Active**. Bypass list: **empty**. Don't add GitHub Actions, apps or roles.
  - Target branches: **Include default branch**. That follows the default branch when it changes.
  - Rules: Restrict deletions; Block force pushes; Require a pull request before merging (0 approvals, because you are the only reviewer); Require status checks to pass, with the check **`validate`**.
  - Note: `validate` shows up in the check picker only after `validate.yml` has run once. Import the JSON to skip that wait.
- [ ] 3.2 `docs/release/rulesets/monitor-data.json`, named "monitor-data":
  - Enforcement: **Active**. Bypass list: **empty**.
  - Target: branch `monitor-data` (enter it as a pattern, even if the branch doesn't exist yet).
  - Rules: **only** Restrict deletions and Block force pushes. **Don't** turn on "Restrict updates" or "Require a pull request" here, because they would block the monitor's data writes.

**What changes after 3.1:** nobody, agents included, can push straight to the default branch. All changes go through a pull request that passes `validate`, and you merge it.

## 4. First deploy and first run (hard stop 1)

- [ ] 4.1 Merge the PR that adds `.github/workflows/`. `pages.yml` starts and its **deploy** job waits for you. Open **Actions → pages → the run → Review deployments**, tick `github-pages`, then click **Approve and deploy**. Approve only runs from the default branch that you expect.
- [ ] 4.2 **Actions → monitor → Run workflow** on the default branch, once. Then check four things: the `monitor-data` branch exists, the run summary shows the targets, the keepalive line says it succeeded, and the page loads data.
- [ ] 4.3 Write down today's date as "last human commit" for the 60-day keepalive watch (T19, ADR-0002).

## Not needed

- No secrets, personal access tokens or apps. Only `GITHUB_TOKEN` is used.
- No change to the default branch. Moving it to `main` is a separate decision. If you make it, only step 2.4 needs an update.
