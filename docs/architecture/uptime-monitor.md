# Architecture: uptime-monitor (MVP)

- **Spec:** `docs/specs/uptime-monitor.md` (v2). **Review:** `docs/reviews/brain-trust-uptime-monitor-spec.md`
- **Owner:** Software Architect. **Status:** v1, 2026-10-28
- **ADRs:** 0001 to 0007 in `docs/adr/`. **Tasks:** `docs/tasks/uptime-monitor.md`

---

## 1. Context

The product is one public GitHub repo. A scheduled Actions workflow checks up to 20 URLs and opens or closes Issues. It writes one small JSON file of aggregates to a data branch. A static page on GitHub Pages fetches that file when someone views it. Constraints: $0, only `GITHUB_TOKEN`, no external services, MVP of a few hundred lines.

The repo is empty apart from docs, so there is no existing stack to follow. The stack is picked in ADR-0001.

## 2. Stack (ADR-0001)

| Concern | Choice | Why |
|---|---|---|
| Runtime | **Node.js 24 LTS** (`actions/setup-node`, `node-version: 24`) | Preinstalled tooling, built-in `fetch`, `node:test`, `net.BlockList`, `node:https`. Node 24 is in LTS until about April 2028. |
| Runtime dependencies | **None** | Removes supply-chain risk from the job that holds a write token. `package.json` exists only for `"type": "module"`, `engines` and `scripts`. |
| Tests | `node --test` (built in) | No framework needed. |
| Config format | **JSON** (`monitor.config.json`) | A YAML parser would be a dependency. Parse errors are reported with line and column. Trade-off: JSON is less friendly to edit (see ADR-0001). |
| Page | Plain static `site/index.html` + `site/style.css` + `site/app.js` (ES module) + `site/render.js` (pure, unit-testable in Node) | No framework, no bundler. |
| Build step | One tiny script, `scripts/build-site.mjs`. It copies `site/` to `_site/` and writes the data URL into a `<meta>` tag. | Justified: the page has to know its repo's data URL without guessing from `location`. That guess breaks for `<owner>.github.io` user-site repos and for custom domains later. |
| Dev-only tool | `@axe-core/cli` run with `npx` at a pinned version in a CI job, using the runner's preinstalled Chrome | Needed for AC-P10. It never runs in the monitor job. |
| Third-party actions | Only first-party `actions/*` (`checkout`, `setup-node`, `configure-pages`, `upload-pages-artifact`, `deploy-pages`), **pinned to full commit SHAs** | Supply chain. |

Size target: about 700 to 900 lines of non-test code in total: `src/` about 550, `site/` about 300 including HTML and CSS, plus three workflow files.

## 3. Repository layout

```
monitor.config.json             # owner-edited config (the only file AC-X3 users edit)
package.json                    # type: module, engines.node >=24, scripts.test, no deps
src/
  cli.js                        # entry: `node src/cli.js run|validate|keepalive`
  config.js                     # parse + validate config, derive interval from cron
  ssrf.js                       # URL syntax rules, host normalization, address blocklist
  check.js                      # checkTarget(): redirects, IP pinning, timeout
  transport.js                  # default HTTP transport (node:http/https, pinned lookup)
  state.js                      # pure: applyRun(prevData, results, cfg, now) -> {data, actions}
  issues.js                     # labels, outage/config-error/stale issue sync, inert text
  github.js                     # tiny REST client over fetch (injectable)
  datastore.js                  # read/write status.json on the data branch via Contents API
  keepalive.js                  # PUT .../workflows/monitor.yml/enable
  summary.js                    # writes $GITHUB_STEP_SUMMARY
site/
  index.html  style.css  app.js  render.js
scripts/build-site.mjs
test/  *.test.js  fixtures/
.github/workflows/
  monitor.yml                   # schedule + dispatch: keepalive job, monitor job. NEVER deploys.
  validate.yml                  # push/PR: config validation, unit tests, workflow lint, axe
  pages.yml                     # deploy page shell; environment github-pages (owner approval)
```

## 4. Components and responsibilities

| Component | Responsibility | Key ACs |
|---|---|---|
| `config.js` | Parse JSON, validate each entry and each setting, return valid targets plus `errors[]`. Derive the interval from `monitor.yml`'s cron (ADR-0007). | C1, C2, C4, C6 to C9, C12 |
| `ssrf.js` | Scheme and userinfo rules, host normalization, blocked-name suffixes, address blocklist including mapped, compatible and NAT64 forms. | C2 to C4 |
| `check.js` | One check per target. Resolve, validate **all** addresses, connect to the pinned address, follow redirects hop by hop (at most 5), apply the deadline. Never reads the body. | C3, C5, C10, C11, K1 to K4 |
| `transport.js` | The default transport. `node:https`/`node:http` `request()` with a `lookup` override that returns only the pinned IP, with SNI and certificate checks against the original hostname. | C10 |
| `state.js` | Pure state machine for streaks, outages, day aggregates, retention and removed targets. Emits the issue actions to perform. | A2 to A5, A7, D2, D4, S7 detection |
| `issues.js` | Ensures labels exist. De-duplicates by **listing open issues by label** plus a hidden marker. Opens, comments on and closes issues. Neutralizes all text. | A1 to A8, C6, K5, S7, SEC2 |
| `datastore.js` | Reads `status.json` and its blob `sha` through the authenticated Contents API (fresh, not from the CDN). Writes it with `PUT` plus that `sha` (optimistic concurrency). Bootstraps the orphan branch. | D1, D3, D5 |
| `keepalive.js` | Calls the enable-workflow API and reports the result in the run summary. | S5 |
| `site/*` | Fetches data at view time, works out staleness in the browser, renders with `textContent` only, handles load failure. | P1 to P11, S1 to S4, SEC1 |
| Workflows | Triggers, per-job permissions, concurrency, the deploy gate. | K5, P8, X2, SEC3 |

## 5. Configuration contract (`monitor.config.json`)

```json
{
  "contact": "Questions? Email help@example.com",
  "failuresBeforeAlert": 2,
  "timeoutSeconds": 10,
  "staleAfterMinutes": 60,
  "targets": [
    { "name": "Blog", "url": "https://example.com/" }
  ]
}
```

| Field | Rule | Default |
|---|---|---|
| `targets` | Array of 1 to 20 entries. Entries past index 19 are invalid (C7). | none (required) |
| `targets[].name` | String of 1 to 60 chars after trim. No control chars (U+0000–001F, U+007F–009F), no newline. Unique, case-insensitive (C8). | required |
| `targets[].url` | At most 500 chars. Passes `ssrf.checkUrlSyntax` (C2 to C4). | required |
| `contact` | Optional plain text of at most 200 chars, no control chars. Every `scheme:` token that looks like a link must be `https:` or `mailto:` (regex `/\b([a-z][a-z0-9+.-]*):/gi`, ignoring a following digit as in `10:30`) (C12). | absent |
| `failuresBeforeAlert` | Integer from 1 to 10. | 2 |
| `timeoutSeconds` | Integer from 1 to 30. | 10 |
| `staleAfterMinutes` | Integer of at most 1440 and **at least 2 × interval** (S3). | 60 |
| interval | **Not a config field.** It is derived from the minute field of `monitor.yml`'s cron. It must be at least 5 (C9). If it can't be parsed, that is a config error and 15 is assumed. (ADR-0007) | 15 |

An invalid **setting** falls back to its default and becomes a config error. An invalid **target** is skipped. Unknown keys are config errors, which catches typos. A file that doesn't parse as JSON is one config error ("config file is not valid JSON at line L, column C"). In that case a scheduled run checks nothing, but it still updates `lastRunAt` and keeps the `config-error` issue, so the owner is told and the page doesn't go stale for a config typo. Assumption: this is the right reading of "every valid target is still checked" when no target can be read.

**Function signatures**

```js
// config.js
parseConfig(configText: string, workflowText: string)
  -> { settings: {failuresBeforeAlert, timeoutMs, staleAfterMinutes, intervalMinutes, contact|null},
       targets: Array<{ name: string, url: string /* URL.href */ }>,
       errors:  Array<{ entry: string /* "targets[3] \"Shop\"" or "staleAfterMinutes" */, reason: string }> }
deriveIntervalMinutes(workflowText: string) -> number | null   // max cyclic gap of the cron minute field; hour/day fields must be '*'
```

The `validate` CLI exits 1 if `errors.length > 0` (push/PR, C6) and prints each `entry: reason` to stdout and to `$GITHUB_STEP_SUMMARY`. Inside `run`, errors never change the exit code.

## 6. SSRF design (ADR-0006)

### 6.1 Syntax and host rules (`ssrf.checkUrlSyntax(str) -> {ok:true,url} | {ok:false,reason}`)
1. `new URL(str)` (WHATWG). Rejects unparseable input. **The WHATWG parser already turns `2130706433`, `0177.0.0.1`, `0x7f.0.0.1`, `0x7f000001` and `127.1` into `127.0.0.1`.** This was verified on Node 22. Re-verify on 24 in a unit test.
2. `url.protocol` must be `http:` or `https:` (C2).
3. `url.username` and `url.password` must be empty (C4).
4. `host = url.hostname`, lowercased, with `[]` stripped and **one trailing dot stripped**. Reject `localhost`, and anything ending in `.localhost`, `.local` or `.internal` (C3).
5. If `net.isIP(host)` is non-zero, run `isBlockedAddress(host)` now (literal IPs are rejected at validation time, before any resolve).
6. A hostname with a single label and no dot (e.g. `intranet`) is rejected. This is an assumption that goes beyond the spec: such names only resolve through search domains.

### 6.2 Address blocklist (`ssrf.isBlockedAddress(ip: string) -> boolean`)
First normalize IPv6 forms that embed IPv4: `::ffff:a.b.c.d` / `::ffff:XXXX:XXXX` (mapped), `::a.b.c.d` / `::XXXX:XXXX` (compatible, except `::` and `::1`), `64:ff9b::/96` (NAT64), `2002::/16` (6to4, bits 16 to 47). Extract the embedded IPv4 and check it **as well as** the IPv6 address itself. (Node's `BlockList` matches `::ffff:` mapped forms but not compatible forms, so the extraction is explicit.) Then check a `net.BlockList`:

| IPv4 | IPv6 |
|---|---|
| `0.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10`, `127.0.0.0/8`, `169.254.0.0/16`, `172.16.0.0/12`, `192.0.0.0/24`, `192.0.2.0/24`, `192.168.0.0/16`, `198.18.0.0/15`, `198.51.100.0/24`, `203.0.113.0/24`, `224.0.0.0/4` (multicast), `240.0.0.0/4` (reserved, includes `255.255.255.255`), `168.63.129.16/32` | `::/128`, `::1/128`, `fc00::/7`, `fe80::/10`, `ff00::/8`, `2001:db8::/32`, `100::/64` |

Ranges beyond the spec (documentation, benchmarking, reserved) are blocked deliberately: they aren't public sites.

### 6.3 Check flow with pinning (`check.checkTarget`)

```js
checkTarget(url: string, opts: {
  resolver?:  (hostname: string) => Promise<Array<{address: string, family: 4|6}>>, // default: dns.promises.lookup(h,{all:true,order:'ipv4first'})
  transport?: (req: {url: URL, address: string, family: 4|6, signal: AbortSignal})
                => Promise<{status: number, location: string|null}>,             // default: transport.js
  timeoutMs: number, maxHops?: 5, now?: () => Date
}) -> Promise<{ up: boolean, reason: string|null /* null when up */, checkedAt: string /* ISO */ }>
```

For each hop, up to 6 requests (the original plus 5 redirects):
1. `checkUrlSyntax(currentUrl)`. Failing this on hop 0 is impossible (config already passed it). On a later hop the result is `down`, reason `blocked redirect`, and **no request is made**.
2. If the host is a literal IP, `addresses = [host]`. Otherwise `addresses = await resolver(host)`. No addresses gives `DNS failure`.
3. If **any** returned address is blocked, the result is down: `blocked address` on hop 0, `blocked redirect` on a later hop. This is conservative: a mixed public/private answer is treated as hostile.
4. `pinned = addresses[0]`. `transport({url, address: pinned, family, signal})` is the **only** network call. The resolver is called exactly once per hop and **never again** for that hop (C10).
5. If the status is 3xx with `Location`: `next = new URL(location, currentUrl)`, hop++. If hops exceed 5, the result is `too many redirects`. If 3xx has no `Location`, the result is `HTTP <status>`.
6. 2xx means up. Any other status gives `HTTP <status>`.
7. One `AbortController` deadline of `timeoutMs` covers **the whole check, including all hops** (the reason is `timeout`). This is an assumption that reads AC-K2 strictly, and it bounds run time at about 20 × 10 s in the worst case before concurrency.

Fixed reason vocabulary (A8: the monitor generates every reason itself): `timeout`, `DNS failure`, `TLS error`, `connection error`, `HTTP <3-digit>`, `blocked address`, `blocked redirect`, `too many redirects`. Raw `err.message` is never stored.

### 6.4 Default transport (`transport.js`)
- `(url.protocol === 'https:' ? https : http).request({ host: url.hostname, port, path: url.pathname + url.search, method: 'GET', headers: { 'user-agent': 'gnosh-uptime (+https://github.com/<repo>)', accept: '*/*' }, lookup: pinnedLookup, autoSelectFamily: false, servername: <hostname unless IP literal>, signal, agent: false })`.
- `pinnedLookup(hostname, options, cb)` ignores `hostname` and returns the pinned address. **It must support both callback shapes:** when `options.all` is true, `cb(null, [{address, family}])`, otherwise `cb(null, address, family)`. Node 20 and later call `lookup` with `all: true` when `autoSelectFamily` is on, so the engineer turns that off as well.
- TLS: the default CA store and `rejectUnauthorized: true`. The certificate is checked against `servername`, which is the original hostname. The `Host` header is the original host.
- On `response`: read `statusCode` and `headers.location`, then `res.destroy()` straight away. **The body is never read** (K3), and headers other than `location` are dropped.
- Error mapping: `ENOTFOUND`/`EAI_*` give `DNS failure`, `CERT_*`/`ERR_TLS_*`/`*_SELF_SIGNED*`/`UNABLE_TO_*` give `TLS error`, `AbortError` gives `timeout`, anything else gives `connection error`.
- Proxy env vars are not honored (Node's default). `NODE_USE_ENV_PROXY` is never set.

**Test seam (C11):** tests pass a fake `resolver` and a recording `transport`. The rebinding test (C10): the resolver returns `93.184.216.34` on call 1 and `127.0.0.1` on any later call. The assertion is that the transport saw `address === '93.184.216.34'` and that the resolver was called once. A second test runs the **real** `transport.js` against a local `http.createServer` with the pinned address `127.0.0.1` (calling transport directly, below `checkTarget`) and confirms the `lookup` override is honored on Node 24.

**Ports:** any port is allowed. This is an assumption: the spec doesn't restrict ports, and every address is already public. Flagged for the security engineer.

## 7. Data model (ADR-0003)

**Location:** branch `monitor-data` (an orphan branch with no shared history with `main`), single file `status.json`, minified JSON, UTF-8.

```jsonc
{
  "v": 1,
  "repo": "gn0sh/gnosh-uptime",            // from GITHUB_REPOSITORY, used for issue links
  "lastRunAt": "2026-10-28T14:05:12Z",     // (c) completed run time = when this file was built
  "intervalMinutes": 15,
  "staleAfterMinutes": 60,
  "failuresBeforeAlert": 2,
  "contact": "Questions? Email help@example.com",   // or null
  "configErrorCount": 0,                   // page may say "some targets could not be checked"
  "targets": [
    {
      "name": "Blog",
      "url": "https://example.com/",
      "state": "up",                       // "up" | "down" | "unknown" (never checked)
      "lastCheckedAt": "2026-10-28T14:05:03Z",
      "lastFailureReason": null,           // from the fixed vocabulary, or null
      "failStreak": 0,
      "outageStartedAt": null,             // ISO time of the first failure in the current streak
      "issue": null,                       // open outage issue number (int) or null
      "suppressed": false,                 // A7: a human closed the issue during this outage
      "days": [["2026-10-27", 96, 96], ["2026-10-28", 57, 56]]  // [UTC date, checks, ok], ascending, at most 90
    }
  ]
}
```

**Rules**
- `days` holds the window `today-89 … today` (UTC). Older entries are dropped on every run. A missing date means "Not checked this day" (P4). Each run only increments today's tuple.
- A target that is in the data but not in the valid config is **dropped from the file on the next run** (D4: it is gone from the page after 1 run, and its data is gone at the same moment, well inside 90 days). A target that is temporarily *invalid* (a config error) is also dropped. This is an assumption chosen for simplicity, and the page shows `configErrorCount`. Any open outage issue for a dropped target is closed with the comment "No longer monitored".
- Uptime % (P5) is computed in the browser: `sum(ok)/sum(checks)` over the window, to one decimal place. A window with no checks shows "Not checked" rather than a percentage.
- Targets are matched across runs by exact `name`.

**Size bound (D3)**
| Record | Max bytes | Basis |
|---|---|---|
| Day tuple `["YYYY-MM-DD",nnnnn,nnnnn],` | **32** | 12 + 2 × 5 digits + punctuation. 288 checks a day at most (5-minute interval) fits in 3 digits. |
| Target state record (all fields except `days`) | **1,024** | name ≤ 60 chars and url ≤ 500 chars. Multibyte UTF-8 can make the name up to 240 bytes. Reason ≤ 24, plus keys and timestamps of about 250. The writer **asserts** each record ≤ 1,024 bytes. |
| Header (all top-level fields except `targets`) | **1,024** | contact ≤ 200 chars (≤ 800 bytes UTF-8) plus about 200 bytes of fixed fields |

Worst case: `20 × (90 × 32 + 1,024) + 1,024 = 79,104 bytes` (about 77 KB, under 1 MB by a factor of 13). `datastore.writeData` refuses to write more than **256 KB** (a hard assert). Typical size at 3 targets is about 6 KB.

**Git history growth (R3):** each run adds one commit, one tree and one blob of up to about 80 KB, about 35,000 commits a year at defaults. Server-side packing delta-compresses consecutive blobs, which differ by a few bytes. Expected growth is a few tens of MB a year at 20 targets. That is an estimate, not a proof. Task T14 measures it with a simulated year (`git gc --aggressive` then `du .git`) and reports the result.

**Atomicity (D5):** one file per commit, written by one `PUT /contents` call. The raw CDN serves whole blobs, so a reader sees either the previous version or the new one. If a run dies before the `PUT`, the previous file is untouched. The page validates `v === 1` and the field types before rendering, and anything else triggers AC-P9.

**Concurrent writer safety:** `PUT` carries the `sha` read at the start of the run. A stale `sha` returns 409 or 422, and the run fails without retrying. The previous data stays valid and the next run recomputes. This backs up the `concurrency` group.

### Datastore contract

```js
readData(gh) -> Promise<{ data: object|null, sha: string|null }>
   // GET /repos/{repo}/contents/status.json?ref=monitor-data  (Accept: application/vnd.github.raw+json for content; sha via the object form)
   // 404 on the branch or the file -> {data:null, sha:null}. Unparseable or wrong version -> {data:null, sha} plus a summary warning; state starts fresh.
writeData(gh, data, sha) -> Promise<void>
   // sha null + branch missing -> bootstrap: POST git/blobs, git/trees (no base), git/commits (parents: []), git/refs refs/heads/monitor-data
   // else PUT /contents/status.json {message:"data: run <ISO>", content: base64, sha, branch:"monitor-data"}
```

Note: the Contents API returns file contents inline only up to 1 MB. The 256 KB cap keeps the file well under that.

## 8. Run sequence (`node src/cli.js run`)

```
schedule/dispatch ─► job keepalive (actions: write) ──► PUT /actions/workflows/monitor.yml/enable ─► summary
                 └─► job monitor  (contents: write, issues: write)
   1  read config + monitor.yml from the checkout (default branch)       parseConfig
   2  readData()                                                         previous state + sha
   3  stale-gap check: gap = now - prev.lastRunAt                        S7
        gap > staleAfterMinutes  ->  ensure exactly one monitor-stale issue with marker gap=<prev.lastRunAt>
   4  ensureLabels(outage, config-error, monitor-stale)                  A6
   5  sync config-error issue (open/update/close)                         C6
   6  check valid targets, concurrency 5, Promise.allSettled              K1 to K4
   7  applyRun(prev, results, settings, now) -> {data, actions}           pure
   8  list open `outage` issues once; perform actions (open/comment+close/suppress), write issue numbers into data
   9  writeData(data, sha)                                                D1, D5
  10  write step summary (per target, errors, keepalive result)
```

Ordering notes:
- Issues come **before** the data write, and de-duplication uses the issue list, not stored numbers. If a run opens an issue and then dies before step 9, the next run finds the issue by its marker and adopts it. No duplicate is opened (A3, K5).
- The stale check uses `prev.lastRunAt`, the last *completed* run, because `lastRunAt` is only written at step 9. The marker `<!-- gnosh-uptime:stale:<prev.lastRunAt> -->` makes it idempotent. Before opening, the run lists open **and closed** `monitor-stale` issues from the last 30 days (`since=`) and looks for the marker. "One gap, one issue" therefore holds even if the owner closed it quickly.
- First run ever (`prev === null`): no stale check, labels created, branch bootstrapped.

### 8.1 Outage state machine (`state.applyRun`), per target, N = `failuresBeforeAlert`

| Prev | Check | Next | Action |
|---|---|---|---|
| any, `failStreak = 0` | up | up | none |
| `failStreak > 0`, `issue = null` | up | up, streak 0, outage cleared, `suppressed = false` | none (A5: a blip opens nothing) |
| `issue = n` | up | as above | `recover(n, outageStartedAt, checkedAt)`: comment "Recovered at X (UTC). Down for D." then close (A4) |
| any | down | streak+1, `outageStartedAt ??= checkedAt`, `state = down` | if `streak ≥ N && issue = null && !suppressed`, then `open(target)` (A2) |
| `issue = n`, and n is **not** in the open-outage list | down | `issue = null`, `suppressed = true` | none (A7: a human closed it, so don't reopen or open again until recovery) |

`open(target)` first looks for an open `outage` issue whose body has `<!-- gnosh-uptime:outage:<id> -->`, where `id = sha256(name).slice(0,12)` hex (a name can never break out of the comment). If one exists it is adopted, otherwise a new one is created. Title: `<inert name> is down`. Body: URL (inert), first failure time (UTC), reason, and a link to the README's alerts section.

A9 logic: the outage starts at t0 between runs. Run R1 is the first failure (streak 1) and R2 the second (streak 2 = N), so the issue opens at R2, the 2nd completed run after t0. That is 15 to 30 minutes plus cron delay with the defaults. Unit test T6 covers it with simulated times.

### 8.2 Config-error issue
Exactly one open issue labeled `config-error`, found by listing. The body is a generated list `- <inert entry>: <reason>` plus a marker containing a hash of the list. If the list changes, the body is edited (`PATCH`) and a short "Updated" comment is added. If errors are now empty and the issue is open, it gets the comment "Config is valid again." and is closed.

### 8.3 Issue text neutralization (`issues.inert(s: string) -> string`), AC-SEC2
1. Strip control chars and collapse whitespace to single spaces.
2. Backslash-escape the Markdown/HTML metacharacters ``\ ` * _ { } [ ] ( ) < > # + - . ! | ~``.
3. Insert U+200B after every `@` (blocks mentions) and after every `#` (blocks issue cross-references), and break `://` as `:\/\/` so URLs aren't auto-linked.
4. Use it for titles as well as bodies. URLs are shown as inert text, not links (owners know their own URLs).

Every body is built only from monitor-generated strings and `inert()` output (A8).

### 8.4 GitHub REST client (`github.js`)

```js
makeGitHub({ token, repo, fetchImpl = fetch, apiBase = 'https://api.github.com' })
  -> async (method, path, body?) => { status, json }    // throws GitHubError{status} on >=400 except where caller opts in (e.g. 404)
```

Headers: `authorization: Bearer <token>`, `x-github-api-version: 2022-11-28`, `accept: application/vnd.github+json`. List calls use `per_page=100` (at most 20 targets, so one page is enough; pull requests are filtered out with `!('pull_request' in item)`). Budget: about 5 to 15 calls per run, far below the `GITHUB_TOKEN` limit of 1,000 per hour per repo.

## 9. Keepalive (ADR-0002), AC-S5

- **Mechanism:** a separate `keepalive` job inside `monitor.yml` with `permissions: { actions: write }`. It calls `PUT /repos/{owner}/{repo}/actions/workflows/monitor.yml/enable` with `GITHUB_TOKEN` on **every run**. That is one cheap call, so the call cadence equals the check interval, well inside 60 days.
- It is a separate job, so a broken monitor job (bad config, a code bug) doesn't stop the keepalive. It runs in the same workflow because a separate scheduled keepalive workflow would be disabled by the same 60-day rule.
- `keepalive({gh, workflowFile, now}) -> {ok: boolean, status: number|null, at: ISO}`. `204` means ok. Anything else writes `::warning::Keepalive failed (HTTP <s>)` and a summary line linking to the README re-enable section. **The job doesn't fail**, because a failing job on every run would flood the owner (same reasoning as C6).
- **What is verified (2026-10-28, current GitHub docs):**
  - REST "Enable a workflow": `PUT /repos/{owner}/{repo}/actions/workflows/{workflow_id}/enable`, returns 204, needs the "Actions" repository permission (write), and works with installation tokens. `GITHUB_TOKEN` is an installation token, and `permissions: actions: write` grants that permission. **So the call works with `GITHUB_TOKEN` only, and no secret is needed.**
  - The docs say: "In a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days." They **don't define "activity"**, and they **don't state** that calling enable on an enabled workflow resets the timer.
  - The reset is a community-reported behavior: the `keepalive-workflow` action's API mode (`actions: write`), Qiita and Zenn write-ups, and several repos replacing commit keepalives with `gh workflow enable` plus `GITHUB_TOKEN`. None cite GitHub, and none show a measured 60-day result. The `gh-workflow-immortality` note that "GITHUB_TOKEN lacks the required permissions" is about its **cross-repo** use. It doesn't apply to a workflow enabling itself.
- **Verdict: not a hard stop.** The mechanism needs only `GITHUB_TOKEN`. **Residual risk (medium):** GitHub doesn't document that it resets the timer. If it doesn't, the only documented-to-count fallback (a commit on the default branch) conflicts with AC-D1. See Escalation E1 in the handoff. The data-branch commits made every run *may* also count as activity, but that is also undocumented.
- **Detection if it fails:** the workflow becomes `disabled_inactivity`, nothing runs, the page goes stale (S3), and the stale sentence links to the README re-enable section. AC-S7 fires once the owner re-enables. Documented limit: nothing tells the owner while the monitor is fully dead (the Later item: external dead-man's switch).

## 10. Page and view-time data fetch (ADR-0004), AC-P8, R5

- **URL:** `https://raw.githubusercontent.com/<owner>/<repo>/monitor-data/status.json`. `scripts/build-site.mjs` injects it at deploy time as `<meta name="gu-data-url" content="…">` from `GITHUB_REPOSITORY`, which is a GitHub-provided value, not config.
- **Measured 2026-10-28:** `raw.githubusercontent.com` responds with `cache-control: max-age=300`, `access-control-allow-origin: *` and `etag`, through the Fastly CDN. **The worst-case staleness after a write is about 5 minutes of CDN time**, and the browser adds nothing because the page uses `fetch(url, {cache: 'no-store'})`. 5 minutes is under the 10-minute bound in AC-P8. **No query-string cache-buster**, because it would raise origin load and the rate-limit risk for no gain.
- **Rate limits:** GitHub tightened limits on unauthenticated raw downloads in May 2025 and publishes no figures. They are per IP. One page view makes one request, and the page **doesn't auto-poll** (a manual "Check again" button reloads the data). A 429 or any other failure gives the AC-P9 message. Residual risk: low for small sites.
- **Why not** the Contents API (unauthenticated limit of 60/hour per IP), jsDelivr (an external service, which breaks X1, and it caches branches for hours) or putting data in the Pages artifact (that would make every run a deploy, which breaks P8): see ADR-0004.
- **Rendering contract:** `render.js` exports pure `buildModel(data, nowMs) -> ViewModel` (staleness, summary sentence key, per-target state and labels, 7- and 90-day %, 90 day cells), and `app.js` turns that into DOM using only `createElement` and `textContent`. **No `innerHTML`, `insertAdjacentHTML`, `outerHTML` or `document.write`.** A test greps for them (SEC1). Exact copy comes from `docs/design/uptime-monitor.md` (UX).
- Staleness: `stale = nowMs - Date.parse(lastRunAt) > staleAfterMinutes × 60,000`, worked out in the browser (S2). When stale, the summary uses the stale sentence and every target shows the stale wording plus its last known state. "Working" never appears without it (S3, S4). Issue links are built as `https://github.com/${repo}/issues/${n}`, only when `Number.isInteger(n) && n > 0` and `repo` matches `^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$`.
- Validation: if `v !== 1`, a type is wrong, or the date strings are malformed, the page shows the AC-P9 message and never shows "Working".
- **CSP** via `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src https://raw.githubusercontent.com; base-uri 'none'; form-action 'none'">`. This is defense in depth for SEC1. (`frame-ancestors` can't be set by a meta tag, and Pages can't set headers, so clickjacking is accepted: the page has no actions.)

## 11. Workflows, permissions and deploys (ADR-0005)

Every workflow starts with `permissions: {}` and each job grants only what it needs. **No `${{ }}` inside any `run:`** (SEC3). Values reach steps through `env:`, and only GitHub-provided context is used (`github.repository`, `github.token`), never config. Actions are pinned by SHA. `pull_request_target` and `workflow_run` are never used.

| Workflow / job | Triggers | Permissions | Notes |
|---|---|---|---|
| `monitor.yml` / `keepalive` | `schedule: '7,22,37,52 * * * *'` (off the top of the hour, when cron is busiest), `workflow_dispatch` | `actions: write`, `contents: read` | Checkout (`persist-credentials: false`), then `node src/cli.js keepalive`. |
| `monitor.yml` / `monitor` | same | `contents: write`, `issues: write` | Checkout of the default branch with `persist-credentials: false`. The token goes in only as `env: GITHUB_TOKEN`. Writes go through the REST API (no `git push`). `timeout-minutes: 5`. |
| `validate.yml` / `test` | `push` to any branch and `pull_request`, paths `monitor.config.json`, `src/**`, `site/**`, `test/**`, `.github/workflows/**` | `contents: read` | `node src/cli.js validate` (fails on config errors, C6), `node --test`, workflow lint (no `${{` in `run:`), axe on the built `_site` served locally. |
| `pages.yml` / `build` | `push` to `main` with paths `site/**` and `scripts/build-site.mjs`, plus `workflow_dispatch` | `contents: read` | `node scripts/build-site.mjs`, then `upload-pages-artifact`. |
| `pages.yml` / `deploy` | needs `build` | `pages: write`, `id-token: write` | `environment: github-pages` (**required reviewer: the owner**, deployment branches: `main` only), `deploy-pages`. |

**Concurrency (K5)**
- `monitor.yml`: workflow-level `concurrency: { group: monitor, cancel-in-progress: false }`. GitHub runs one at a time and keeps at most one pending run (a newer pending run replaces an older one), which matches "waits or is dropped". The backstops are label-list de-duplication (§8) and the `sha` precondition on the data write (§7).
- `pages.yml`: `concurrency: { group: pages, cancel-in-progress: false }`.

**Why data refreshes never deploy:** (1) `monitor.yml` has no Pages permission and no deploy step. (2) Data commits go to `monitor-data`, but `pages.yml` only triggers on `main` with `site/**` paths. (3) Commits made with `GITHUB_TOKEN` (API or push) don't trigger `push` workflows anyway. (4) Config edits on `main` don't touch `site/**`, so a new target shows up through data alone (C1 within 2 runs), with no deploy. The AC-P8 test checks the Pages deployment history after a run.

**One-time owner setup (README; hard-stop items for our own repo):** Settings → Pages → Source "GitHub Actions". Settings → Environments → `github-pages` → Required reviewers: owner, Deployment branches: `main`. Actions → General → Workflow permissions can stay "Read" (the per-job `permissions:` override it). The first deploy is approved by the owner. For template users (AC-X3), the required reviewer is recommended but not needed for a live page.

**Install path (Q4):** "Use this template" is the supported path. Forks start with Actions disabled and scheduled workflows off. This is confirmed as the recommended path.

## 12. Non-functional concerns

- **Performance:** checks run with concurrency 5 and a 10 s deadline each, so the worst case is about 40 s. A run takes under a minute, and `timeout-minutes: 5` is the backstop.
- **Cost:** public repo with standard runners, so $0. About 96 runs a day × 2 jobs at about 20 to 40 s each.
- **Observability:** the step summary per run has a per-target table (name inert, state, reason), config errors, the keepalive result and the data size in bytes. The page shows `lastRunAt`. M1 latency (A9 field measurement) is taken from issue `created_at` minus `outageStartedAt`, which is printed in the issue body.
- **Clock:** the server uses the runner's UTC time and the browser uses its own clock. A skewed visitor clock can show stale or not-stale incorrectly (accepted, documented).
- **Testability:** all I/O (`resolver`, `transport`, `gh`, `now`) is injected. `state.js` and `render.js` are pure.

## 13. Threat model (for security-engineer)

**Assets:** (A1) the monitor job's `GITHUB_TOKEN` (`contents: write`, `issues: write`). (A2) the keepalive token (`actions: write`). (A3) integrity of `status.json`, which is what visitors believe. (A4) visitors' browsers. (A5) the owner's notification channel (issues). (A6) the runner's network position (Azure: IMDS `169.254.169.254`, `168.63.129.16`).

**Trust boundaries:** config (untrusted, editable by PR) → validator. Remote sites and DNS (untrusted) → checker. `status.json` (written by the monitor, but readable and writable by anyone with push access) → page. Third-party Actions → runner.

| # | Threat (STRIDE) | Vector | Mitigation | Residual |
|---|---|---|---|---|
| T1 | SSRF / information disclosure (I) | Config URL, redirect `Location`, or DNS answer that points at a private, metadata or loopback address | §6: syntax, blocklist including embedded IPv4, every hop validated, all A/AAAA records checked, pinned connect, body never read | Public-IP services on odd ports are reachable (by design). The status code of a public URL is exposed (by design). |
| T2 | DNS rebinding (T) | Resolver gives a public answer, then a private one | One resolve per hop, `lookup` override, test C10 | none known |
| T3 | XSS on the page (T/E) | Malicious target name, URL or contact in data | `textContent` only, grep test, CSP meta, issue links built from validated ints | A compromised `status.json` can still *lie* (show "Working"), but it can't run script |
| T4 | Markdown/mention injection in issues (S) | Name `@octocat [x](…)` | `inert()` (§8.3), names never in markers | Low |
| T5 | Workflow script injection (E) | `${{ }}` with attacker-influenced values in `run:` | Banned. Env only, and only GitHub context. Lint test. | — |
| T6 | Token misuse by malicious PR (E) | PR changes code or workflows | `pull_request` from forks gets a read-only token and no secrets. No `pull_request_target` or `workflow_run`. Monitor runs only default-branch code (schedule/dispatch). | Collaborators with write access are trusted (they could edit workflows anyway). |
| T7 | Supply chain (E) | Compromised dependency or action | Zero runtime npm deps. Only first-party actions, pinned by SHA. axe only in the validate job, which has `contents: read`. | GitHub-owned actions are trusted |
| T8 | Data tampering (T) | Someone with push access edits `monitor-data` | Accepted: people with push access are trusted at the same level as `main`. The page validates the shape, and SEC1 means a tampered file can lie but can't run script. | Medium-low |
| T9 | Notification flooding (D) | Bad config or a failing keepalive spams the owner | C6 single issue. Keepalive failure is a warning, not a failed job. Outage de-duplication. | — |
| T10 | Resource exhaustion (D) | Slow-loris or huge target | Whole-check deadline, body never read, concurrency 5, job timeout 5 min | — |
| T11 | Repudiation / honesty (R) | Page claims "Working" while the monitor is dead | Staleness worked out in the browser, stale overrides everything, AC-P9 | Visitor clock skew |
| T12 | Abuse of the template as a scanner (I) | Third parties use it to probe hosts | 20-target cap, 5-min minimum, GET only, identifying UA | Actions ToS risk R1 |

**Asks for the security engineer:** (1) confirm the "any port" decision. (2) Review the `inert()` escape set against GitHub's Markdown renderer (GFM autolinks, `#123` references, `:emoji:`). (3) Confirm the `pinnedLookup` approach on Node 24 with `agent: false`, and that no code path in `https.request` re-resolves (e.g. `family` hints). (4) Decide whether T8 needs a branch ruleset.

## 14. Risks

| # | Risk | Likelihood / impact | Mitigation |
|---|---|---|---|
| R4 | The enable API doesn't reset the 60-day timer | Medium / High (silent death after 60 days) | Escalation E1. The page stale state is the backstop. Dogfood beyond 60 days to observe. |
| R5 | Raw CDN caching above 10 min, or raw rate limits | Low / Medium | Measured max-age of 300. One request per view, no polling, AC-P9 on failure. Re-measure in QA (T15). |
| R3 | Data-branch history growth | Low / Low | Measured in T14. History reset is a Later item that needs owner approval. |
| R6 | Node `lookup` semantics change (e.g. `all: true` path) | Low / High (pinning bypassed) | Real-transport pinning test against a local server on every CI run. |
| R7 | JSON config is hard for P1 to edit | Medium / Low | Clear parse-error position in the PR check and in the issue. Example config with comments in the README. YAML is a later option (ADR-0001). |
| R1 | Actions ToS grey area | Medium / High | Infrequent checks, cap of 20, no marketing as bulk monitoring (spec). |

## 15. Changes made during the build (backend, T1 to T9)

These follow the manager decisions, the accepted UX changes (SC-1 to SC-11) and the threat model (`docs/security/uptime-monitor-threat-model.md`). The frontend was told about the data changes.

**Config (§5)**
- Target names are at most **50** characters (SC-1), not 60.
- New optional settings: `siteName` (text, at most 60 characters) and `contactLink` (`https:` or `mailto:` URL, SC-2). `contact` stays plain text.
- Keys that start with `//` are owner notes and are ignored (JSON has no comments). Any other unknown key is still a config error.
- Names, `siteName` and `contact` reject every Unicode `Cc`/`Cf` character and U+2028/2029 (F9). `contact` and `contactLink` reject `javascript:`, `data:`, `vbscript:` and `file:` anywhere (F3). A link-like token is `scheme:` followed by a non-space, non-digit, so "Note: …" and "10:30" are fine.
- Target URLs reject query parameter names that look like secrets (F11) and ports 0 plus the Fetch bad-port list (F7, also on every redirect hop).
- Errors are `{entry, reason, line, index?, name?}`. `line` comes from a small position-tracking JSON parser (`src/jsonloc.js`) that also gives plain-language messages for trailing commas, missing quotes, single quotes, missing commas and comments. Entries read `Site #4 "Shop"` or `Setting "timeoutSeconds"`.
- If `monitor.yml` is missing (template not yet set up, or `validate` run before T12), the interval is 15 with no error.

**SSRF (§6)**: IPv6 is allowed only in `2000::/3` after the embedded-IPv4 checks; `2001::/32` (Teredo) and `64:ff9b:1::/48` are added to the deny list (F8). An unparseable `Location` gives `HTTP <status>` (no new reason). The deadline uses `Promise.race`, so a lookup that never returns still ends as `timeout` (F13). `src/cli.js` sets `UV_THREADPOOL_SIZE=8` if unset; DevOps should also set it in the monitor job `env:`.

**Data (§7)**
- New top-level fields: `siteName` (string or null) and `contactLink` (string or null).
- SC-8: when a person closes an outage issue during the outage, the target keeps `issue: n` with `suppressed: true`. On recovery the monitor adds the recovery comment to that closed issue (after confirming it is the bot's own outage issue for that target) and does not reopen it. The page links an issue only when `issue` is an int and `suppressed` is false.
- `lastFailureReason` is cleared on recovery (matching the §7 example).
- `readData` validates the full schema strictly (F5): exact key sets, ISO timestamps, `issue` a positive safe int, counts with `ok ≤ checks`, ascending unique days, fixed vocabularies, names and URLs re-validated. Anything else starts fresh with a summary warning, keeping the `sha`.

**Run sequence (§8)**
- Labels are ensured **before** the stale check, so a first `monitor-stale` issue gets the label description.
- The bot's open `outage` issues are listed **before** `applyRun` and passed in as `openIssueNumbers`, so the A7 transition stays pure.
- SC-11: a config that doesn't parse syncs the config-error issue, checks nothing and **does not write data**, so the page goes stale honestly. (§5 said to still update `lastRunAt`; the manager decision overrides it.) The stale check is skipped on such runs.
- `syncOutages` also reconciles open bot outage issues the data doesn't know about: adopt for a down target, close for an up or removed target.

**Issues (§8.1 to §8.3)**
- Every bot-opened or adopted issue is locked with `lock_reason: resolved` (F1); a lock failure is a warning.
- Only issues authored by `github-actions[bot]` (`type: Bot`) are listed, adopted, commented on or closed (F14, F5).
- Config values in bodies are inline code spans with a fence longer than any backtick run (F4). Titles use a light transform with no backslash escapes (F9). `inert()` is still used for monitor text that may quote config fragments (problem descriptions) and now also escapes `&` and `/` and breaks `www`.
- Config-error rows read `Site 4 **Shop** (line 12)`, not `#4`, because `#4` would link to issue 4.
- Outage bodies do not include the page URL (it can't be known for custom domains); they say the page links to the issue. Bodies add one line saying only repo collaborators can comment (F1).

**Code review wave 1 fixes (`docs/reviews/code-review-uptime-monitor-wave1.md`)**
- F1: the 500-character limit applies to the **normalized** `href` of target URLs and `contactLink` (percent-encoding and punycode can make it longer than the input). `serializeData` re-runs `isValidStoredData` on its own output and refuses to write on a mismatch, so a writer/reader gap fails loudly instead of resetting state. The header bound is now **2,048 bytes** (contact 800 B + siteName 240 B + contactLink 500 B + fixed fields); the worst-case total is still under 100 KB.
- F2: a run with **no valid target** (unreadable file, `targets` missing, not a list, empty, or every entry invalid) is held like SC-11: config-error issue synced, nothing checked, nothing written, no stale check. A target whose entry is temporarily invalid (and has an index of 20 or less and a name) is **carried forward unchanged** in config order: no check, no new day counts, its outage issue stays open. This replaces the §7 rule "a target that is temporarily invalid is also dropped". Removed targets are still dropped after one run.
- F3: label, stale, config-error and outage issue calls never stop the checks or the data write. A failure is a warning, the data is written, and the run exits 1 (except HTTP 410, Issues turned off, which only warns). If the outage list can't be read, `openIssueNumbers` is `null` and no outage issue is opened that run.
- F4: one open bot outage issue per target. Extra open issues with the same marker are closed as duplicates of the linked one (or the lowest number, when adopting).
- F5: confirming the bot's own outage issue for the SC-8 comment uses author plus marker, not the label. An issue that is still open is commented on and closed.
- F6: the stale issue lists "the config file had a problem that stopped every site from being checked" as a possible cause.
