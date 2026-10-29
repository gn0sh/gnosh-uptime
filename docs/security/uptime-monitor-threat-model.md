# Threat model: uptime-monitor (T16, design time)

- **Author:** Security Engineer. **Date:** 2026-10-28. **Status:** v1, design review (no code reviewed)
- **Inputs:** `docs/architecture/uptime-monitor.md` (v1, esp. §13), ADR-0001 to 0007, `docs/specs/uptime-monitor.md` (v2), `docs/decisions-uptime-monitor.md`, `docs/design/uptime-monitor.md` (contact-line and outage-link sections only)
- **Scope:** public repo, GitHub Actions (schedule/dispatch/push/PR), GitHub Pages, GitHub Issues, `GITHUB_TOKEN` only, zero runtime deps.
- **Note on path:** T16 in `docs/tasks/uptime-monitor.md` names `docs/security/uptime-monitor.md`; the manager's brief named this file. The architect should fix the task file to point here.

## Release recommendation

**BLOCK (release), design may proceed to build.** One **high** finding (F1, outage issues are open to public comments and the page sends visitors there). The fix is small. No critical findings. Everything else is medium/low and can land with the build tasks it names.

## Summary of findings

| ID | Sev | Title | Owner |
|---|---|---|---|
| F1 | **High** | Public comments on outage issues linked from the page enable phishing of visitors | backend-engineer (lock), ux-designer (copy) |
| F2 | Medium | Build-time HTML injection of the contact line (SC-7) into the page shell | frontend-engineer, software-architect |
| F3 | Medium | Contact-line link: page linkifier must not trust validator or data; validator digit exemption lets `javascript:0` through | frontend-engineer, backend-engineer |
| F4 | Medium | `inert()` bypass via HTML named entities (`&commat;`, `&num;`, `&lbrack;`) — mentions and links (needs verification) | backend-engineer |
| F5 | Medium | `status.json` and issue lists are trusted by the monitor: values flow into issue text, HTML-comment markers and API paths | backend-engineer |
| F6 | Medium | Default branch unprotected; monitor job's `contents: write` can rewrite the code the next run executes (answers ask 4 / T8) | devops-engineer, owner |
| F7 | Low | Ports: allow any, but reject port 0 and the Fetch "bad ports" list (answers ask 1) | backend-engineer |
| F8 | Low | IPv6 blocklist is deny-list based; `fec0::/10`, Teredo, `64:ff9b:1::/48` not covered | backend-engineer |
| F9 | Low | Issue titles get Markdown backslash escaping they don't render (shows `Blog\.com`); bidi/format chars not stripped | backend-engineer |
| F10 | Low | Page issue links use `repo` from data instead of the deploy-time repo | frontend-engineer |
| F11 | Low | Secrets in URL query strings get published | backend-engineer, technical-writer |
| F12 | Low | `npx @axe-core/cli` pulls unpinned transitive deps; no-cache rule not stated | devops-engineer |
| F13 | Low | DNS lookup is not abortable; deadline must be a race, threadpool contention | backend-engineer |
| F14 | Low | Issues adopted by marker are not checked for bot authorship | backend-engineer |
| F15 | Low | Deploy gate is only as strong as identity separation between agents and owner | engineering manager / owner |

---

## 1. Assets

As in arch §13 (A1 to A6), plus:
- **A7** the visitors' trust in where the page sends them (outage-report links, contact link). Persona Rosa (P2) is non-technical and arrives during an outage, which is the classic target profile for tech-support scams.
- **A8** integrity of the default branch, because scheduled runs execute whatever code is on it with a write token.

## 2. Trust boundaries (additions to §13)

| Boundary | Direction | Notes |
|---|---|---|
| Any GitHub user → issue comments | inbound to A5, A7 | Public repo: anyone signed in can comment on unlocked issues. Not in §13. |
| `status.json` → **monitor** (not just page) | inbound to A1 | §13 only models data → page. The monitor reads its own previous file and uses its fields in issue text and API calls (F5). |
| Config → **build script** → HTML | inbound to A4 | SC-7 bakes the contact line into the shell at build time (manager decision). §10 still says the build injects only the data URL. |
| Monitor job token → default branch | outbound from A1 | `contents: write` is repo-wide, not limited to `monitor-data` (F6). |

## 3. STRIDE pass (delta to §13)

I agree with §13 T1 to T12 except where a finding below changes the mitigation. Additions:

| # | STRIDE | Threat | Finding |
|---|---|---|---|
| T13 | S/I | Attacker comments on a linked outage issue: "site moved, call +1-…" or a lookalike link | F1 |
| T14 | T/E | Contact text breaks out of HTML at build time (meta refresh redirect, phishing link) | F2 |
| T15 | T | `javascript:` / non-allowlisted href in contact link | F3 |
| T16 | S | Mention/link injection via entities in issue text | F4 |
| T17 | T/E | Tampered `status.json` (or a buggy prior run) closes arbitrary issues/PRs, breaks out of markers | F5 |
| T18 | E | Compromised monitor run pushes code to the default branch, persisting across runs | F6 |
| T19 | I | Tokens in target query strings published on page and data branch | F11 |

---

## 4. Findings

### F1 (High): Outage issues are open to public comments, and the page sends visitors to them
- **Location:** arch §8.1 `open(target)`, §10 issue links; design §6.4 `OutageLink` ("The report is on GitHub. You don't need an account to read it.").
- **Exploit:** During an outage the page links every visitor to `issues/<n>`. Any GitHub account can comment there ("Our site moved to shop-example.help" or "call support at …"); bots that watch new issues can do this within minutes. Visitors read it as the owner's official update. The owner also gets notification spam.
- **Required change:**
  1. Immediately after creating an outage issue, lock it: `PUT /repos/{o}/{r}/issues/{n}/lock` with `{"lock_reason":"resolved"}` (works with `issues: write`). Collaborators can still comment. Do the same when **adopting** an existing outage issue that is unlocked. Apply to `config-error` and `monitor-stale` issues too (spam only, not linked from page).
  2. A lock failure is a `::warning::` and summary line, not a run failure (same reasoning as C6).
  3. Test: the fake `gh` records a lock call for every opened or adopted issue.
  4. UX copy on the page near the outage link: one short line saying updates come only from the site owner (ux-designer to word it; keep it plain).
- **Owner:** backend-engineer (T7 `issues.js`), ux-designer (copy), architect updates §8.1.
- **Why high:** realistic, cheap to exploit, aimed at the exact user the page is designed for, and the fix is one API call.

### F2 (Medium): Build-time injection of the contact line into HTML
- **Location:** manager decision SC-7 ("baked into the page at build time"); `scripts/build-site.mjs` (arch §2, §10 describe only the data-URL `<meta>`; the doc is out of date with SC-7).
- **Exploit:** A merged config change (a malicious or careless PR) sets `contact` to `"><meta http-equiv="refresh" content="0;url=https://evil.example">`. CSP blocks inline script but **not** meta refresh or plain `<a href>` phishing, so every visitor of the official page is redirected.
- **Required change:** `build-site.mjs` never builds HTML by string concatenation of config values. Put the contact text in one attribute, `<meta name="gu-contact" content="…">`, with full attribute escaping of `& < > " '`, and have `app.js` read it with `getAttribute` and render with `textContent` (plus F3 link rules). Add a test that a contact containing `"><meta http-equiv=refresh …>` produces exactly one `gu-contact` meta and no other new element. The build re-runs C12 validation and fails on errors. Architect updates §10 to describe this.
- **Owner:** frontend-engineer (T10/T11 build script), software-architect (§10).

### F3 (Medium): Contact link scheme handling
- **Location:** arch §5 `contact` rule; design "If the contact has a link, the link text is the contact text or 'Contact us'".
- **Exploit:** The validator regex skips a `scheme:` followed by a digit (to allow `10:30`), so `javascript:0,alert(1)` passes C12. If the page linkifier is looser than the validator ("first `x:` token becomes href"), the page renders a `javascript:` link. CSP (`script-src 'self'`) should block execution, but that is the last line of defence. The data path (tampered `status.json`, T8) bypasses the validator entirely.
- **Required change:** The **page** decides links itself with an allowlist: only substrings matching `/\bhttps:\/\/[^\s<>"]+/` or `/\bmailto:[^\s<>"]+/i`, then `new URL(s)` and `protocol === 'https:' || 'mailto:'`, set via `a.href = url.href`. Everything else is text. The validator drops the digit exemption for the schemes `javascript`, `data`, `vbscript`, `file` (reject them anywhere, case-insensitive). Unit tests for both, including `JaVaScRiPt:0`, `data:text/html,…`, and `https://ok` + `javascript:1` in one string.
- **Owner:** frontend-engineer (`render.js`/`app.js`), backend-engineer (`config.js`).

### F4 (Medium, needs verification): `inert()` entity bypass; answer to ask 2
- **Location:** arch §8.3.
- **Exploit:** Step 2 does not escape `&`. CommonMark decodes all HTML5 named entities, so `&commat;octocat` renders as `@octocat`, and GitHub's mention/reference filters run on the rendered text (my understanding of GitHub's pipeline; I could not render a test through the GitHub Markdown API from this sandbox, the proxy blocks it). That would defeat the AC-SEC2 test intent: a target named `&commat;someone` notifies `someone` when the issue opens. `&lbrack;x&rbrack;&lpar;https&colon;//evil&rpar;` does **not** form a link (entities can't create Markdown syntax), but `&num;` → `#` could make `&num;1` a reference. Numeric entities are already broken because `#` is escaped.
- **Review of the rest of the escape set (ask 2):**
  - Mentions `@` + U+200B: sound. Also covers email autolinks (`a@b.com`) and GFM's `mailto:`/`xmpp:` extended autolinks, which need `@`.
  - `#` + U+200B: sound for `#123` and `owner/repo#123`. **Not covered:** `GH-123` (GitHub links and cross-references it) and bare 7 to 40 hex-char strings (commit autolinks). Both are harmless beyond a timeline cross-reference; accepted as low.
  - `://` → `:\/\/`: stops `http(s)://` autolinks. **Needs verification:** GFM's `www.` extended autolink needs no scheme; whether `www\.evil\.com` still autolinks in cmark-gfm is not certain.
  - `:emoji:` shortcodes: cosmetic only, accepted.
  - HTML: `<` `>` escaped, sound.
- **Required change (more robust than extending the escape list):** in **bodies and comments**, render every config-derived value as an inline code span: strip control and format chars, collapse whitespace, then wrap in a backtick fence one longer than the longest backtick run in the value, with a space inside each fence (`` `` `a`b` `` ``). Inside code spans CommonMark decodes no entities, makes no autolinks, and GitHub makes no mentions or references. This also matches the UX recommendation (design line 576). If backslash-escaping is kept instead, add `&` and `/` to the step-2 set and insert U+200B after `www`.
- **Tests:** names `&commat;octocat`, `www.evil.example`, `` a`b ``, `` ` `` only, `@octocat [x](https://evil.example)`. The rendered-HTML check (via the Markdown API, which is unauthenticated and side-effect free) should run once in QA (T15) and confirm no `<a>` and no `user-mention` class.
- **Owner:** backend-engineer (T7), QA verifies in T15.

### F5 (Medium): The monitor trusts its own stored data and issue lists
- **Location:** arch §7 `readData`, §8 stale marker, §8.1 `recover(n, …)`, T8 in §13 (which considers only the page).
- **Exploit:** Fields from the previous `status.json` reach privileged actions: `prev.lastRunAt` goes into the stale-issue **title** and into `<!-- gnosh-uptime:stale:<prev.lastRunAt> -->` (a value containing `-->` escapes the comment and injects Markdown); `outageStartedAt` goes into issue bodies; `issue` (a number) goes into API paths and is closed on recovery. A tampered file (push access, or a bug in an earlier run) with `"issue": 1` makes the monitor comment on and close issue or PR #1; `"issue": "1/lock"` or non-integers can change the API path.
- **Required change:**
  1. `readData` validates the full schema strictly: `v === 1`, ISO-8601 UTC regex `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$` for every timestamp, `issue` is `null` or a positive safe integer, counts are non-negative integers with `ok ≤ checks`, `state` and `lastFailureReason` from the fixed vocabularies, names re-validated like config. **Any** violation → treat as `data: null` (fresh start) with a summary warning, keep the `sha` for the write.
  2. `state.js` builds new records from known fields only (no spreading or `Object.assign` of parsed objects).
  3. `recover(n)` and comment/close actions only act on `n` when `n` is in the **listed open `outage` issues authored by the bot** (see F14). Otherwise drop the number and log.
  4. Never put a stored string into a marker; markers use only values the run generated and formatted itself (e.g. re-serialize the parsed date with `toISOString()`).
- **Owner:** backend-engineer (T5 `state.js`, T7 `issues.js`, T8 `datastore.js`).

### F6 (Medium): Default branch protection; answer to ask 4 (T8)
- **Location:** arch §11, §13 T6/T8; manager decision that the default branch is currently `claude/project-thread-0jnua7`.
- **Exploit:** (a) The monitor job's `GITHUB_TOKEN` with `contents: write` can update **any** branch through the API, including the default branch (it cannot edit `.github/workflows/*`, which needs the `workflows` permission GITHUB_TOKEN never has, but it can change `src/`). Anything that gets code execution in that job (e.g. a Node HTTP/TLS parser bug triggered by a hostile target) can rewrite `src/check.js`, and every later scheduled run executes it with the write token. (b) Today the default branch is a `claude/*` branch with no protection, so any agent push is executed on the next schedule with write permissions, with no review.
- **Required change (T8 answer: yes, add rulesets, but not "restrict updates" on the data branch):**
  1. Ruleset on the **default branch** (whatever it is now, then `main`): require a pull request, require the `validate` status check, block force pushes, block deletion. No bypass for GitHub Actions.
  2. Ruleset on `monitor-data`: block force pushes and deletion only. These don't affect the Contents API `PUT` (a fast-forward commit). Don't add "restrict updates": it would block the bot unless GitHub Actions can be a bypass actor, which I could not confirm (**needs verification**), and push-access users are trusted at the same level as `main` anyway (agree with §13 T8 residual).
  3. The `github-pages` environment's deployment-branch rule must name the **actual** default branch; `pages.yml` must trigger on the same branch. Today they say `main`, which doesn't exist yet.
  4. Optional defence in depth (architect's call, cost is a second job and an artifact hand-off): split the monitor into a `check` job with `permissions: {}` that does all network I/O and writes `results.json` as an artifact, and a `write` job with `contents: write, issues: write` that does no outbound requests except to `api.github.com`.
  5. Keep repo settings: workflow permissions "Read", "Allow GitHub Actions to create and approve pull requests" **off**.
- **Owner:** devops-engineer (ruleset JSON + README steps, T12/T13), owner (applies settings; hard stop for our repo), software-architect (decides on item 4).

### F7 (Low): Ports; answer to ask 1
- **Decision:** confirm "any port", with two changes. Every address is already public, and GET with a WHATWG-encoded path (CR/LF are percent-encoded, verified on Node 22) can't smuggle a second protocol command, so the remaining risk is using GitHub's IPs to poke at non-HTTP services, which is abuse-flavoured (R1).
- **Required change:** in `checkUrlSyntax`, reject port `0` (WHATWG accepts `https://a.com:0/`, verified) and the Fetch standard's "bad port" list (1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665 to 6669, 6697, 10080) with reason "port not allowed". Apply on every redirect hop. This is what browsers refuse, so no real website needs them.
- **Owner:** backend-engineer (T2).

### F8 (Low): IPv6 deny-list gaps
- **Location:** arch §6.2.
- **Exploit:** `fec0::/10` (deprecated site-local, still routed on some internal networks) is outside `fc00::/7` and `fe80::/10`; Teredo `2001::/32` and local NAT64 `64:ff9b:1::/48` embed or translate IPv4 and aren't unwrapped. Exploitability is low because GitHub-hosted runners usually have no IPv6 egress (**needs verification**; the ADR-0006 note assumes the same).
- **Required change:** for IPv6, **allow only** `2000::/3` (global unicast) after the embedded-IPv4 checks, then apply the existing deny list within it, and add `2001::/32` and `64:ff9b:1::/48`. Strip or reject zone IDs (`%eth0`) before `BlockList.check` (WHATWG already rejects them in URLs; `dns.lookup` results can't carry them, but the check must not throw).
- **Owner:** backend-engineer (T2).

### F9 (Low): Issue titles and Unicode format characters
- **Location:** arch §8.3 step 4 ("Use it for titles as well").
- **Problem:** Issue titles render only a little Markdown (inline code, emoji, references), so backslash escapes show literally: "Blog\.example is down". Separately, the control-char rule covers C0/C1 only, so bidi overrides (U+202A to 202E, U+2066 to 2069) and other `Cf` characters can make names display reversed or spoofed in titles, the page and the run summary.
- **Required change:** titles use a lighter transform: strip control and `Cf` chars, collapse whitespace, U+200B after `@` and `#`, no backslash escapes. Config validation rejects names and contact containing any Unicode `Cf` or `Cc` character (regex `/[\p{Cc}\p{Cf}]/u`), as a config error.
- **Owner:** backend-engineer (T3, T7).

### F10 (Low): Issue links built from `repo` in data
- **Location:** arch §10 ("Issue links are built as `https://github.com/${repo}/issues/${n}` … `repo` matches regex").
- **Exploit:** A tampered `status.json` with `"repo": "attacker/lookalike"` sends visitors to the attacker's issue. The regex allows any repo.
- **Required change:** `build-site.mjs` injects `<meta name="gu-repo">` from `GITHUB_REPOSITORY`; the page uses that for links and ignores `data.repo` (or requires equality, else no link).
- **Owner:** frontend-engineer.

### F11 (Low): Secrets in target URLs
- **Problem:** C4 blocks userinfo but not `?token=…` or `/hooks/<secret>` paths; health-check URLs often carry keys. The URL is published in `status.json` (public branch), on the page and in issues.
- **Required change:** config validation emits a config error for query parameter names matching `/^(token|key|api[_-]?key|secret|sig|signature|password|pass|auth|access[_-]?token)$/i`. README states plainly that everything in `monitor.config.json` is public.
- **Owner:** backend-engineer (T3), technical-writer (T17).

### F12 (Low): Dev tooling supply chain and caches
- **Location:** ADR-0001 (axe via `npx` at a pinned version).
- **Problem:** pinning `@axe-core/cli@x.y.z` doesn't pin its transitive deps (selenium/chromedriver and others resolve by semver, and chromedriver runs an install script). Impact is limited: the validate job has `contents: read` in a public repo and no secrets, so the worst case is a faked check result. Separately, Actions caches are shared across workflows on a branch; a poisoned cache entry would matter if the monitor or pages jobs ever restored one.
- **Required change:** commit a lockfile for the dev tool (e.g. `tools/a11y/package.json` + `package-lock.json`, `npm ci` there), and state in arch §11: no `actions/cache` and no `setup-node` `cache:` in `monitor.yml` or `pages.yml`. Pin `setup-node` with `node-version: 24` (latest patch, which is what we want for HTTP parser fixes) and don't pin an old patch.
- **Owner:** devops-engineer.

### F13 (Low): Deadline vs DNS
- **Location:** arch §6.3 step 7 (one `AbortController` deadline).
- **Problem:** `dns.promises.lookup` (getaddrinfo) can't be aborted and runs on libuv's threadpool (4 threads by default) while check concurrency is 5. A target with a slow-to-fail DNS name holds the check past `timeoutMs` and can stall the others.
- **Required change:** wrap each check in `Promise.race([check, deadline])` so the result is `timeout` on time even if the lookup is still pending, and set `UV_THREADPOOL_SIZE=8` in the monitor job `env:`. Also: a `Location` that `new URL()` can't parse returns down, not a thrown error (assume `connection error` or add `bad redirect` to the vocabulary).
- **Owner:** backend-engineer (T4).

### F14 (Low): Adopting issues by marker without checking the author
- **Location:** arch §8 de-duplication, §8.2, stale lookup.
- **Problem:** Labels can't be set by outsiders, so label filtering is the real barrier. But issue templates with `labels:` frontmatter do auto-apply labels for anyone, and collaborators with triage rights can label. A planted issue with the marker would be adopted and later commented on and closed by the bot.
- **Required change:** only adopt issues where `user.login === 'github-actions[bot]'` (and `user.type === 'Bot'`). The README warns not to add issue templates that apply the `outage`, `config-error` or `monitor-stale` labels.
- **Owner:** backend-engineer (T7), technical-writer.

### F15 (Low, process): Deploy gate and identity
- **Problem:** The `github-pages` required reviewer is the owner. If agent tooling acts with the owner's GitHub identity, it can approve its own pending deployment via `POST /actions/runs/{id}/pending_deployments`, which would route around hard stop 1 silently.
- **Required change:** the manager records the rule that no agent calls the pending-deployments API or approves environments; deployment approvals come only from the owner in the UI. If agents get their own identity later, turn on "Prevent self-review" for `github-pages`.
- **Owner:** engineering manager (CLAUDE.md is theirs to change), owner.

---

## 5. Answers to the four asks in §13

1. **Any port:** confirmed with changes. Reject port 0 and the Fetch bad-port list (F7).
2. **`inert()` vs GFM:** mention, `#ref`, `://` and HTML handling are sound. Gaps: `&` entities (F4, needs verification), `www.` autolinks (needs verification), `GH-n` and SHA refs (accepted). Recommended change: code spans for config values in bodies, a light transform for titles (F4, F9).
3. **`pinnedLookup` on Node 24 with `agent: false`:** verified on **Node 22.22.0** in a local experiment (Node 24 isn't installed here): `http.request({host:'evil.example', lookup, agent:false})` calls `lookup` exactly once per request, with `{hints:32}` when `autoSelectFamily:false` and `{hints:32, all:true}` when it is true or left at the default. So the dual-shape callback is required, and pinning holds even if `autoSelectFamily` is left on, as long as the `all` shape returns only the pinned address. A bracketed IPv6 host (`[2606:4700::1]`) is passed to `lookup` as-is and connects to the pinned address. `net.connect` calls `lookup` only for non-IP hosts, TLS does no resolution, `agent:false` rules out reuse of pooled sockets across hops, and Node ignores proxy env vars by default, so I found no re-resolve path. A `family` option is not needed. **Needs verification on Node 24:** the planned T4 real-transport test must also assert the `lookup` call count is exactly 1, that it is called with both `autoSelectFamily` values, and that `servername` equals the original hostname for names and is unset for IP literals (detect IP literals after stripping `[]`).
4. **T8 ruleset:** yes for the default branch (require PR + status check, no force push, no deletion), and force-push/deletion protection only on `monitor-data` (F6). The monitor must also treat stored data as untrusted (F5).

## 6. What I checked and found sound

- SSRF syntax rules (§6.1): verified on Node 22 that WHATWG normalizes `http://0/` → `0.0.0.0`, `0x7f.1` → `127.0.0.1`, full-width digits `①②⑦.0.0.1` → `127.0.0.1`, `%2E` in host, a trailing dot on IPv4 literals, `[::ffff:127.0.0.1]` → `[::ffff:7f00:1]`, `[::127.0.0.1]` → `[::7f00:1]` (so the compatible-form extraction is necessary, as designed), and that `net.BlockList` matches mapped forms. `LOCALHOST.` comes out as `localhost.`, so the single trailing-dot strip is needed, as designed.
- Rejecting the whole hop if any A/AAAA record is blocked; per-hop re-validation before any request; reading no body; dropping headers; a fixed reason vocabulary with no raw `err.message`.
- Workflow design: `permissions: {}` default, per-job grants, no `${{ }}` in `run:`, no `pull_request_target` or `workflow_run`, SHA-pinned first-party actions, `persist-credentials: false`, the monitor job doesn't deploy (four independent reasons), keepalive in its own job with `actions: write` only.
- Page: `textContent` only plus a grep test, CSP meta (`script-src 'self'`, `connect-src` raw only, `form-action 'none'`, `base-uri 'none'`). Accepting clickjacking is fine because the page has no actions. Optional hardening: add `require-trusted-types-for 'script'` to the CSP (blocks `innerHTML` sinks at runtime in Chromium, at no cost). Also cap the response size before `JSON.parse` (e.g. reject text over 1 MB) so a tampered file can't hang a visitor's tab.
- `GITHUB_TOKEN`-only: no secrets needed anywhere (X2 holds). Shared `<owner>.github.io` origin across the owner's project pages: acceptable, the page stores nothing.

## 7. Assumptions

- Users with push access are trusted (agree with §13 T6/T8). The findings about tampered data (F5, F10, F3's data path) are defence in depth against bugs and a compromised run, not against trusted users.
- GitHub's mention filter runs on rendered text (basis for F4); not confirmed here.
- GitHub-hosted runners lack IPv6 egress (lowers F8); not confirmed here.
