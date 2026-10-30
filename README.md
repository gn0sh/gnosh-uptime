# gnosh-uptime

gnosh-uptime checks your websites on a schedule and tells you when one stops working. It runs entirely on GitHub, in one public repository that you copy from this template. GitHub Actions checks each site about every 15 minutes. When a site stops working, it opens a GitHub Issue, and GitHub notifies you. When the site works again, it closes the issue.

**It's an internal tool: there is no public status page.** Results reach you only as GitHub Issues and in the run summaries in the **Actions** tab. Nothing is published to GitHub Pages. (The `site/` folder holds an unfinished status page that isn't built or published.)

- **Free on public repositories.** No accounts beyond GitHub. No secrets or keys to set up. You edit one short settings file in your browser; you don't need to write code.
- **It's not instant.** You'll usually hear about a problem **about 30 to 60 minutes after a site stops working**, sometimes later. Checks run on GitHub's free schedule, and **checks can be late** or skipped when GitHub is busy. It doesn't check constantly.
- **All config and results are public.** Anyone can see your list of sites, their addresses and whether they were working. Don't put passwords, keys or private addresses in the settings file.

Want more features? See [How this differs from Upptime](#how-this-differs-from-upptime).

## Contents

- [What to expect](#what-to-expect)
- [Setup](#setup) (about 15 minutes)
- [Config file help](#config-file-help)
- [Changing how often sites are checked](#changing-how-often-sites-are-checked)
- [What the GitHub Issues mean](#what-the-github-issues-mean)
- [If checks stop](#if-checks-stop)
- [Troubleshooting](#troubleshooting)
- [Permissions](#permissions)
- [How this differs from Upptime](#how-this-differs-from-upptime)
- [Later](#later)
- [For developers](#for-developers)

## What to expect

- Each site is checked **about every 15 minutes**. GitHub runs scheduled checks when it can, so a check can be late, sometimes by an hour or more, or skipped.
- An issue opens after **2 failed checks in a row** (you can change this). With the defaults, you'll usually hear about a problem about 30 to 60 minutes after it starts, sometimes later.
- The monitor only sees a site at the moment it checks. A short problem between two checks can be missed.
- A check asks for your page and counts it as working if the site answers with a success code (200 to 299), after following up to 5 redirects. It doesn't look at what the page says.
- Checks come from GitHub's cloud servers. Sites that block cloud or bot traffic (for example with a strict firewall or "bot protection") may show as not working even when they work for people.
- GitHub's servers connect over IPv4. A site that can only be reached over IPv6 will show as not working.
- If the checks stop for more than 8 hours, you hear about it once they start again, through a **Monitor was stale** issue. Shorter gaps, which GitHub's schedule causes often, only go in one quiet **Late scheduled runs (rolling log)** issue. See [If checks stop](#if-checks-stop).

## Setup

**Before you start:** you need a GitHub account and the web addresses of the sites you want to check. Everything below happens in your web browser. **Do the steps in this order.**

1. **Make your own copy.**
   At the top of this page, click the green **Use this template** button, then **Create a new repository**.
   - *Owner:* your account.
   - *Repository name:* anything, for example `uptime`.
   - Leave **Include all branches** unticked.
   - Choose **Public**. (In a private repository, Actions minutes count against your plan's allowance.)
   - Click **Create repository**.
   - Don't use **Fork**: forks have scheduled checks turned off.

2. **Check that Actions are on.**
   Click the **Actions** tab. If you see a button that says **I understand my workflows, go ahead and enable them**, click it. If you see a list of workflows, they're already on.

3. **Add your sites.**
   Open the file **`monitor.config.json`** and click the pencil icon (**Edit this file**). Replace everything in it with this example, then change it to your own sites:

   ```json
   {
     "// About this file": "Lines that start with // are notes for you. The monitor ignores them.",
     "targets": [
       { "name": "Shop", "url": "https://shop.example.com/" },
       { "name": "Blog", "url": "https://blog.example.com/" }
     ]
   }
   ```

   - For each site, change the text after `"name":` (the name used in issues) and after `"url":` (the full address, starting with `https://`).
   - To add a site, copy a whole `{ "name": ..., "url": ... }` line and paste it below the last one. Put a comma at the end of every site line except the last.
   - To remove a site, delete its whole line. Then make sure the last site line has no comma after it.

   **Six rules that avoid most mistakes:**
   1. Put every name and every piece of text in **straight double quotes**: `"Shop"`. Not single quotes, and not the curly quotes (`“Shop”`) that some phones and word processors type.
   2. Put a **colon** between a setting and its value: `"name": "Shop"`.
   3. Put a **comma between items**, but **never after the last one** before a `}` or `]`.
   4. Keep the brackets: the whole file is inside one pair of `{ }`, and the list of sites is inside `[ ]`.
   5. To write a note, add a line like `"// my note": "any text",`. The setting name must start with `//`. You can't start a line with `//` on its own, because JSON doesn't allow that. Each note in the same `{ }` needs a different name, such as `"// note 1"` and `"// note 2"`.
   6. Spaces and line breaks don't matter, so you can line things up however you like.

   Then click **Commit changes…**, keep **Commit directly to the** … **branch** selected, and click **Commit changes** again.

4. **Check that the file is OK.**
   Click the **Actions** tab. Within a minute you'll see a run for your change.
   - Green tick next to **validate**: the file is fine. Go to step 5.
   - Red cross: click the run. The summary says which line and which site has a problem and why, for example `Line 6, Site #2 "Blog": The address must start with https:// or http://.` Fix it as in step 3. [Config file help](#config-file-help) explains every message.

5. **Run the first check now** (instead of waiting about 15 minutes).
   In the **Actions** tab, click **monitor** on the left, then **Run workflow** → **Run workflow**. Wait for the green tick (usually 1 to 2 minutes). Open the run to see a summary of each site. A branch called `monitor-data` now holds the saved results.

6. **Make sure you get alerts.**
   Problems are reported as **Issues** in your repository, and GitHub notifies you about them.
   - At the top of your repository, click **Watch** → **Custom** → tick **Issues** → **Apply**.
   - In your GitHub **Settings** → **Notifications**, check that "Watching" notifications go to your email, or to the GitHub mobile app.

The [owner setup checklist](docs/release/uptime-monitor-owner-setup.md) adds optional protection: which actions may run, read-only default permissions, and branch rules that stop unreviewed code from running with the monitor's write permissions. It was written for this project's own repository, so use your own account and branch names instead of the ones in it.

## Config file help

Everything is set in **`monitor.config.json`**, in the top folder of your repository. The file uses a format called **JSON**. Here is an example with every setting:

```json
{
  "// About this file": "Notes start with //. The monitor ignores them.",
  "failuresBeforeAlert": 2,
  "timeoutSeconds": 10,
  "staleAfterMinutes": 60,
  "targets": [
    { "name": "Shop", "url": "https://shop.example.com/" },
    { "// note": "Our blog moved here in May.", "name": "Blog", "url": "https://blog.example.com/" }
  ]
}
```

Only `targets` is needed. Setting names must be spelled exactly as shown, including capital letters: `timeoutSeconds` works, `timeoutseconds` and `timeout_seconds` don't.

### Settings

| Setting | What it does | Default | Allowed |
|---|---|---|---|
| `failuresBeforeAlert` | How many failed checks in a row before an issue opens. | `2` | Whole number, 1 to 10 |
| `timeoutSeconds` | How long to wait for a site to answer. | `10` | Whole number, 1 to 30 |
| `staleAfterMinutes` | If no checks ran for longer than this, the next run records the gap: in the rolling log for gaps up to 8 hours, or in a new "Monitor was stale" issue for longer ones. | `60` | Whole number, from twice the check interval (30 with the default schedule) to 1440 |
| `targets` | Your list of sites, in square brackets `[ ]`. | (needed) | 1 to 20 sites |

`siteName`, `contact` and `contactLink` are still accepted and checked, but they're only for the unpublished status page. You can leave them out.

Each site in `targets` has exactly two settings:

| Setting | What it does | Allowed |
|---|---|---|
| `name` | The name used in issues and run summaries. | Text, up to 50 characters, one line. Each name must be different (capital letters don't count as different). |
| `url` | The address to check. | Starts with `https://` or `http://`, up to 500 characters. Must be a public website. |

**Notes:** you can add a note anywhere as a setting whose name starts with `//`, like `"// note": "text"`. Notes are ignored. Each note in the same `{ }` needs a different name.

**Limits:** up to **20 sites**. A 21st site, and any after it, is skipped and reported as a problem. The first 20 are still checked.

**Sites the monitor won't check** (for safety, and because everything in this file is public):
- addresses with a username or password in them (`https://user:pass@...`),
- addresses with a part that looks like a password or key, such as `?token=`, `?key=`, `?api_key=`, `?secret=` or `?password=`,
- local and private addresses, such as `localhost`, names ending in `.local` or `.internal`, `192.168.x.x` or `10.x.x.x`,
- names without a dot, like `http://intranet/`,
- unusual ports (such as `:22` or `:25`). Normal web ports like 443, 80 and 8080 are fine.

### When something is wrong

You'll see problems in two places:
- **When you save the file:** the **validate** run in the **Actions** tab shows a red cross, and its summary lists each problem with its line number.
- **On scheduled checks:** the monitor opens one issue called **"Config file has problems: some sites are not being checked"**. It skips the bad entries and keeps checking the rest. If the file can't be read at all, or no site in it is usable, it checks nothing and keeps the last results until you fix it.

Common messages and how to fix them:

| Message | How to fix it |
|---|---|
| There is an extra comma after the last item in a list. Remove it. | Delete the comma after the last site, just before `]`. |
| There is an extra comma after the last setting in a { } block. Remove it. | Delete the comma just before the `}`. |
| A comma is missing between two items in a list / between two settings | Add a comma at the end of the line before the one named. |
| This text is missing its closing double quote ("). | Add the missing `"` at the end of the text. |
| Text must be in double quotes, like "My site". A quote mark may be missing. | Put the text in straight double quotes. Look for curly quotes. |
| Use double quotes ("), not single quotes ('). | Change each `'` to `"`. |
| Comments (// or /* */) are not allowed in this file. Remove the comment. | Turn the comment into a note: `"// my note": "text",`. |
| The file ends too early. A closing } or ] may be missing. | Add the missing `]` or `}` at the end. |
| "…" appears more than once. Keep only one. | Delete one copy, or give your notes different names. |
| This setting is not known. Check the spelling. | Fix the spelling and capital letters, for example `timeoutSeconds` or `staleAfterMinutes`. |
| Every site needs a "name". / Every site needs a "url". | Add the missing part to that site. |
| Names must be 50 characters or fewer. | Shorten the name. |
| Another site already uses this name. Each name must be different. | Rename one of them. |
| Only 20 sites are allowed. This entry is number 21, so it is skipped. | Remove sites until there are 20 or fewer. |
| The address must start with https:// or http://. | Write the full address, for example `https://www.example.com/`. |
| The address points to a private or local network address. / The address is a local name (like localhost). | The monitor only checks public websites. Remove this site. |
| The address contains a username or password. Remove it; everything in this file is public. | Remove the `user:password@` part. A site that needs a login can't be checked. |
| The address has a "token" setting that looks like a password or key. | Remove that part of the address. Everything in this file is public. |
| Must be a whole number from 30 (twice the check interval…) to 1440. | Use a number in that range for `staleAfterMinutes`. |

## Changing how often sites are checked

The schedule is in **`.github/workflows/monitor.yml`**, on this line:

```yaml
    - cron: '7,22,37,52 * * * *'
```

The numbers are the minutes past each hour when a check starts. The default is about every 15 minutes. To change it, edit only the numbers before the first space, keep the four `*` after them, and keep it all on one line. For example:
- about every 30 minutes: `'7,37 * * * *'`
- about every 10 minutes: `'2,12,22,32,42,52 * * * *'`

Checks can't be closer together than **5 minutes**. If they are, it's reported as a problem and the monitor assumes about 15 minutes. `staleAfterMinutes` must be at least twice your interval. Checking more often doesn't make GitHub's schedule more punctual, and it uses more of GitHub's free service, so please keep checks infrequent.

## What the GitHub Issues mean

The monitor reports everything as issues in your repository, each with a label. You don't need to reply to them.

| Issue | Label | What it means | What happens next |
|---|---|---|---|
| **Shop is down** (outage) | `outage` | A site failed `failuresBeforeAlert` checks in a row (2 by default). The issue says why, for example "No answer within 10 seconds (timeout)". | The monitor keeps checking. |
| **Shop is working again** (recovery: a comment on the outage issue) | `outage` | The first successful check after the outage. The comment says how long the outage lasted. | The issue is closed. If you closed it yourself earlier, the monitor doesn't reopen it, but still adds this comment. |
| **Late scheduled runs (rolling log)** | `monitor-stale` | No checks ran for longer than `staleAfterMinutes` but no more than 8 hours. GitHub's free schedule does this often. | There is only ever one open. Each new gap is added to its table by editing it, with no comment, so it sends no notifications. If you close it, the next gap starts a new one. |
| **Monitor was stale from … to …** | `monitor-stale` | No checks ran for more than 8 hours, so problems in that time may have been missed. It's opened by the first run after the gap. | It doesn't close by itself, so you know you've seen it. Close it when you're done. If it happens often, read [If checks stop](#if-checks-stop). |
| **Config file has problems: some sites are not being checked** (config error) | `config-error` | `monitor.config.json` has a problem. The issue lists each entry and its problem, but never repeats the bad address. | There is only ever one. When the problems change, it's updated and gets a comment. It closes by itself on the first run after the file is fixed. |

If you remove a site from the file while its outage issue is open, the issue is closed with a note that the site is no longer monitored.

**Issues are locked.** The monitor locks each issue it opens, so only people with access to your repository can comment. This stops strangers posting on your public outage reports.

## If checks stop

**How to tell:**
- you get a **Monitor was stale from … to …** issue (a gap of more than 8 hours), or
- the **Actions** tab shows no recent **monitor** runs, or says the workflow was disabled.

**How to start them again:**
1. Click the **Actions** tab, then **monitor** on the left.
2. If you see a message that the workflow was disabled, click **Enable workflow**.
3. Click **Run workflow** → **Run workflow** to run a check now. If the gap was longer than `staleAfterMinutes`, it's recorded: in the rolling log up to 8 hours, or in a **Monitor was stale** issue beyond that.

If Actions are turned off for the whole repository, turn them back on in **Settings** → **Actions** → **General**.

**Why checks stop, and the limits:**
- **GitHub's schedule is best-effort.** At busy times runs are late or skipped. A short gap once in a while is normal and needs nothing from you.
- **The 60-day rule.** GitHub turns off scheduled workflows in a public repository after 60 days with no activity in it. To prevent this, every run includes a **keepalive** step that asks GitHub to keep the schedule turned on. GitHub doesn't say whether this resets the 60-day count. Other people report that it does, but we haven't confirmed it ourselves yet. If the schedule gets turned off anyway, follow the steps above. Committing a change to the repository yourself also counts as activity.
- If the keepalive step fails, the run shows a warning and its summary says so, with a link here.
- **No alert while checks are stopped.** The "Monitor was stale" issue is opened by a run, so it only arrives after checks start again. While no checks run at all, **nothing tells you**: the only sign is that the **Actions** tab shows no recent **monitor** runs. An alert for that case needs a service outside GitHub, which isn't part of this project yet (see [Later](#later)).

## Troubleshooting

**There's no `monitor-data` branch, or the run summary shows no results.**
- The first check may not have run yet. Run it as in [Setup](#setup) step 5.
- The first successful **monitor** run creates the `monitor-data` branch. If the run failed, click it in the **Actions** tab to see why.

**No issues arrive when a site is down.**
- An issue opens only after `failuresBeforeAlert` failed checks in a row (2 by default), so it usually takes 30 to 60 minutes, sometimes longer.
- Check that you're watching the repository for Issues and that notifications reach you ([Setup](#setup) step 6).
- Check that the **monitor** runs have green ticks in the **Actions** tab, and see [If checks stop](#if-checks-stop).

**A site shows "not working" but works for you.**
- Open its outage issue to see the reason.
- "The site answered with HTTP 403" or "HTTP 429" usually means the site blocks traffic from cloud servers or bots. Ask whoever runs the site to allow it, or remove the site.
- "No answer within 10 seconds (timeout)": the site was slow to answer. Try a larger `timeoutSeconds` (up to 30).
- "The connection was refused or dropped" for a site that works: the site may only be reachable over IPv6, which GitHub's servers can't use.
- "A redirect pointed to a private or blocked address": the monitor never follows those, for safety.

**The validate run fails, but not because of my config file.**
The same run also runs this project's tests. If the summary says `monitor.config.json has no problems`, the failure is somewhere else. Open the step with the red cross to see what failed.

## Permissions

The only key used is `GITHUB_TOKEN`, which GitHub creates for each run and throws away afterwards. You don't set up any secrets. Each workflow starts with no permissions, and each job asks only for what it needs:

| Workflow | Job | Permissions | Why |
|---|---|---|---|
| `monitor.yml` | `keepalive` | `actions: write`, `contents: read` | To ask GitHub to keep the schedule turned on (see [If checks stop](#if-checks-stop)). |
| `monitor.yml` | `monitor` | `contents: write`, `issues: write` | To save results to the `monitor-data` branch, and to open, comment on, lock and close issues. It never commits to your default branch. |
| `validate.yml` | `validate` | `contents: read` | To check the config file and run the tests. |

No job has `pages` or `id-token` permission, and nothing is deployed.

A manual **Run workflow** of **monitor** does anything only when it's run from your default branch, so code on other branches never gets the write permissions.

## How this differs from Upptime

[Upptime](https://github.com/upptime/upptime) is a mature, popular open-source project built the same way: GitHub Actions checks, GitHub Issues for incidents, and a GitHub Pages status site. **If you want more features, or a public status page, use Upptime.** gnosh-uptime is smaller on purpose and has no public page. It focuses on:

- **Telling you when the monitor itself stopped**, with a "Monitor was stale" issue.
- **Storing only totals**: per site and per day, the number of checks and how many worked, for 90 days, on a separate `monitor-data` branch with a size limit.
- **Treating the settings file as untrusted**: only public website addresses are checked, and names can't add links or mentions to issues.

We haven't checked how Upptime handles each of these, so this isn't a claim that it doesn't.

## Later

Not in this version, but being considered:
- an alert from outside GitHub when no checks run at all,
- a public status page (the unfinished one is in `site/`),
- Discord, Slack, email or SMS alerts,
- response-time charts and a "slow" state,
- keyword checks, expected status codes and certificate-expiry warnings,
- incident notes and maintenance windows,
- more than 20 sites, or more than 90 days of history.

## For developers

Needs Node.js 24 or later. There are no dependencies to install.

```sh
npm test               # unit tests
npm run validate       # check monitor.config.json, as the validate workflow does
```

A full `git clone` also downloads the `monitor-data` branch, which grows by about 25 MB a year; `git clone --single-branch` avoids it.

Design documents are in [`docs/`](docs/). Changes are listed in [CHANGELOG.md](CHANGELOG.md).
