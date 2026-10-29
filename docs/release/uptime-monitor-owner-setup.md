# Owner setup checklist: uptime-monitor (gn0sh/gnosh-uptime)

For the repo owner (**gn0sh**) only. Agents may not change repository settings (threat model F15). Use the GitHub web UI and follow the steps in order. It takes about 5 minutes.

**The monitor is an internal tool with no public status page.** Nothing here sets up GitHub Pages, and nothing in the repository deploys (ADR-0005, superseded).

- Leave **Settings → Pages** off.
- If an earlier `pages` run created an environment called **`github-pages`**, delete it in **Settings → Environments**.
- If you set the repository variable `GU_DEPLOY_APPROVAL_CONFIGURED`, delete it in **Settings → Secrets and variables → Actions → Variables**.

Today's default branch is **`claude/project-thread-0jnua7`**. Nothing below names it, so you don't need to change anything when the default branch becomes `main`.

## 1. Actions

**Settings → Actions → General**

- [ ] 1.1 **Actions permissions:** choose "Allow gn0sh, and select non-gn0sh, actions and reusable workflows". Tick "Allow actions created by GitHub". Leave "Marketplace verified creators" unticked and the allow list empty.
- [ ] 1.2 If you see **"Require actions to be pinned to a full-length commit SHA"**, tick it. Every action in our workflows is already pinned to a full commit SHA.
- [ ] 1.3 **Approval for fork pull request workflows:** choose "Require approval for all external contributors".
- [ ] 1.4 **Workflow permissions:** choose "Read repository contents and packages permissions". Each job asks for the permissions it needs.
- [ ] 1.5 Untick **"Allow GitHub Actions to create and approve pull requests"**. Click **Save**.

## 2. Rulesets (threat model F6)

The monitor job's `contents: write` token could change the code that the next scheduled run executes. These rules make sure that code only reaches the default branch through a checked pull request.

**Settings → Rules → Rulesets → New ruleset → Import a ruleset.** Import each file, check that it matches the description below, then click **Create**.

- [ ] 2.1 `docs/release/rulesets/default-branch.json`, named "default-branch":
  - **Enforcement:** Active. **Bypass list:** empty.
  - **Target:** "Include default branch". The rule follows the default branch when it changes.
  - **Rules:** Restrict deletions; Block force pushes; Require a pull request (0 approvals); Require status checks, with the check **`validate`**.
  - **Residual risk (F15):** with 0 required approvals, anyone with write access can merge their own pull request once its checks pass. That includes agents, if they hold write credentials. A pull request can also change `validate.yml` itself. So "the owner merges" is a habit, not something GitHub enforces. When agents get their own GitHub identity, raise the required approvals to 1.
- [ ] 2.2 `docs/release/rulesets/monitor-data.json`, named "monitor-data":
  - **Enforcement:** Active. **Bypass list:** empty.
  - **Target:** the branch `monitor-data`.
  - **Rules:** only Restrict deletions and Block force pushes. This protects the saved results history. Don't add "Restrict updates" or "Require a pull request", because they would block the monitor's data writes.

## 3. First run

- [ ] 3.1 Go to **Actions → monitor → Run workflow** and run it once on the default branch. Then check that:
  - the `monitor-data` branch exists;
  - the run summary lists the targets;
  - the keepalive line reports success.
- [ ] 3.2 Watch the repository for Issues: **Watch → Custom → Issues → Apply**.
- [ ] 3.3 Write down today's date as the "last human commit" for the 60-day keepalive watch (T19, ADR-0002).

Nothing else is needed: no secrets, personal access tokens, apps, Pages or environments. Only `GITHUB_TOKEN` is used.
