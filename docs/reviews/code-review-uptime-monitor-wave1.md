# Code review: uptime-monitor wave 1 (commit 95b4ba3)

- **Reviewer:** code-reviewer (read-only). **Date:** 2026-10-29
- **Scope:** `src/`, `site/`, `test/`, `package.json`, `monitor.config.json` at 95b4ba3. `.github/workflows/` and `scripts/` are out of scope (DevOps is still working on them).
- **Checked against:** spec v2, architecture (including §15), design, threat model.
- **Tests:** `npm test` passes: 285 of 285 on Node 22.22.0. The architecture and `engines` require Node 24, and this sandbox only has 22. So the pinned-lookup tests and the WHATWG IPv4-normalization tests are not proven on the target runtime yet (see F7).

## Verdict: REQUEST CHANGES

**The most serious problem is F1.** A target URL that passes config validation can make the stored `status.json` fail its own strict re-validation on the next read. When that happens, the monitor silently starts fresh on every run. The result: no outage issue ever opens (the failure streak never gets past 1), the 90-day history of every target is wiped every run, and stale-gap detection is turned off. I reproduced this end to end through `main(['run'])`: 5 consecutive failed runs opened 0 outage issues, and `failStreak` stayed at 1.

---

## Findings (ranked)

### F1 MUST-FIX: config accepts URLs whose stored form fails `readData` validation, so state resets every run (no alerts, history wiped)
- **Where:** `src/config.js:273` checks `charLength(t.url) <= 500` on the **raw** input. `src/config.js:281` then stores `u.url.href`. `src/datastore.js:58` requires `isText(t.url, 500)` on the stored value, and `src/datastore.js:90` asserts that each record is at most 1,024 bytes. `contactLink` has the same gap: `config.js:224/228` against `datastore.js:49`.
- **Problem:** `URL.href` can be much longer than the input. Percent-encoding turns `é` into 6 characters and a space into 3, and IDN hosts become punycode. Reproduced:
  - `https://example.com/` + 100×`é`: config reports 0 errors, but `href` is 620 characters. `serializeData` succeeds, and `isValidStoredData` on the read-back returns **false**. So every run gets `prev = null`. With N = 2, the outage issue never opens (A2 broken). Every target's `days` resets to one check (P4/P5 numbers become meaningless). `detectGap` never runs (S7 broken). The only signal is a `::warning::` in the run log.
  - 200×`é`: `serializeData` throws `DataSizeError`. Every run exits 1 after doing its issue actions, and no data is ever written. The page goes stale or shows the load error forever, and the owner gets a failed-run email every 15 minutes.
  - One bad target poisons the **whole file**, including healthy targets.
- **Fix:** validate the normalized `u.url.href` (and the `contactLink` `href`) against the 500-character limit in `config.js`, so the value that is checked is the value that is stored. Add a round-trip property test: `parseConfig` → `applyRun` → `serializeData` → `JSON.parse` → `isValidStoredData === true`. Run it on adversarial inputs: spaces, a multibyte path at the limit, an IDN host, 50 four-byte name characters, and `contactLink` with Unicode. Also consider making `writeData` call `isValidStoredData` on its own output before the PUT, so a writer/reader mismatch fails loudly instead of silently resetting.
- **Why the tests missed it:** the worst-case test (`test/datastore.test.js:130`) builds the stored record directly from ASCII-only strings and never goes through `parseConfig`. Every CLI test uses short ASCII URLs.

### F2 MUST-FIX: a config mistake on an existing target erases its history, closes its live outage issue, and lets the page say "Everything is working"
- **Where:** `src/state.js:135-141` (targets missing from `results` are dropped, and `close-removed` is emitted). `src/issues.js:239-258` (the issue is closed as "No longer monitored", and reconcile closes any unknown marker). `src/config.js:237-248` (a missing, non-list or misspelled `targets` key still returns `parsed: true` with zero targets). `src/cli.js:298` (the SC-11 guard covers only unparseable JSON). `site/render.js` never reads `configErrorCount`.
- **Problem:**
  1. The owner breaks the URL of a site that is **currently down** (for example by adding a `?token=` parameter, or a typo in the scheme). The next scheduled run drops the record. That deletes 90 days of history from the current file, closes the outage issue as `not_planned`, and the site disappears from the page. With the remaining targets up, the page renders **"Everything is working."** (`render.js:485-490`), and `configErrorCount = 1` is ignored. That is a misreport-as-up. Architecture §7 accepts the drop only on the basis that "the page shows `configErrorCount`", and the page does not.
  2. If `"targets"` is misspelled (`"tagrets"`) or is not a list, the run is `parsed: true` with 0 targets. **Every** target's history is wiped, **every** open outage issue is closed, and the page says "There are no sites on this status page yet." The push-time `validate` check fails, but scheduled runs keep running against the bad config.
- **Fix (pick a minimal combination):**
  - (a) Treat "targets missing, not a list, or empty, while previous data has targets" the same way as SC-11: sync the config-error issue, check nothing, do not write.
  - (b) Carry an invalid entry's previous record forward unchanged when its error has an `index` and a `name` that matches a stored record. Do not emit `close-removed` for it; that is the right reading of "skip bad entries".
  - (c) In `render.js`, never let the page reach `all-up` when `configErrorCount > 0`. Use the partly-checked wording ("Some sites could not be checked").
  - Add tests: a down target with an open issue whose config entry becomes invalid; `"targets"` misspelled when data already exists.

### F3 SHOULD-FIX: any Issues API failure aborts the run before the data write, so the page dies with it
- **Where:** `src/cli.js:282` (`ensureLabels` runs before any check), `:294` (config-error sync), `:315` (`listBotIssues`), `:324` (`syncOutages`). All of them come before `writeData` at `:327`, and one `try` wraps them all.
- **Problem:** a single 5xx or a timeout on any issues or labels call means no checks, or no write, for that run. If Issues are disabled on the repo (which template users can do; GitHub then answers issue endpoints with 410, I believe), **every** run fails and the page never gets data. The reasoning for "issues before write" (§8, K5) is about not duplicating issues. De-duplication is by marker listing, so writing the data after a failed issue step is safe: the next run adopts or opens the issue.
- **Fix:** wrap the issue steps, turn failures into `warn()` with `openIssueNumbers = null`. `applyRun` already supports `null`, which means "no human close is inferred". Always write data when checks ran, and keep exit code 1 for the failure if DevOps wants the signal. Test: issues endpoints return 500 or 410, and the data is still written with the correct streaks.

### F4 SHOULD-FIX: duplicate bot outage issues for one target make the linked issue flip every run
- **Where:** `src/issues.js:251-264`.
- **Problem:** given two open bot issues with the same marker (A is linked, B is an orphan, which a K5 race or manual re-run could leave behind), reconcile adopts B and overwrites `issue = A`. On the next run A is unreferenced and gets adopted again. The page link and the recovery target alternate, and on recovery only one is closed; the other is closed later by the "working again" branch with no outage summary.
- **Fix:** when a down target already has an issue, close any other open marker issue for the same target as a duplicate (with a comment) instead of re-adopting it.

### F5 SHOULD-FIX: a recovery comment can be skipped forever after a label change, leaving an open issue
- **Where:** `src/state.js:92` and `src/issues.js:231`.
- **Problem:** if anyone removes the `outage` label from an open bot issue, `listBotIssues` stops returning it. A7 then infers "a person closed it" and sets `suppressed = true`, and the page drops the link. On recovery, SC-8 requires `hasLabel(i, 'outage')`, so it only warns, and the issue stays **open** and never gets a recovery comment.
- **Fix:** for the SC-8 confirmation, the author and the marker are enough. If the issue is still open, comment and close it.

### F6 NIT: the stale issue after SC-11 runs says the monitor "did not run" when it did
- **Where:** `src/cli.js:285-291` with `issues.js:339`.
- **Problem:** unparseable-config runs don't write `lastRunAt`. When the config is fixed, the gap issue says "The monitor did not run for X" and lists only schedule causes.
- **Fix:** acceptable as is, or add "or the config file could not be read" to the causes list.

### F7 SHOULD-FIX (test gap): the suite runs on Node 22, but the product targets Node 24
- **Where:** `package.json` (`engines: >=24`), `test/check.test.js:240-292`, `test/ssrf.test.js:93`.
- **Problem:** R6 (Node `lookup` semantics) and the WHATWG normalization re-check are exactly the tests the architecture says must pass **on 24**. Locally they pass on 22 only.
- **Fix:** make sure `validate.yml` (DevOps) pins `node-version: 24` and runs the whole suite. No code change.

### F8 NIT: a never-checked card still shows uptime lines
- **Where:** `site/render.js:512`.
- **Problem:** design §4.3 says "No uptime figures" in the never-checked state, but the card shows "Last 7 days: no checks yet".

---

## What I checked and found correct
- **State machine (§8.1):** blip with N = 2 opens nothing (A5). Streak ≥ N with no issue and not suppressed opens one (A2/A3). Recovery comments and closes (A4). Human close gives `suppressed` with the number kept, no reopen, and the SC-8 comment on recovery (A7). `outageStartedAt ??=` first failure. The reason is cleared on recovery. A9 latency is between 15 and 30 minutes.
- **Outage open/adopt:** a crash after `create` and before `writeData` is adopted by marker on the next run (verified in the CLI test with a failed PUT). Only issues by `github-actions[bot]` with `type: Bot` are touched (F14). Tampered issue numbers are re-confirmed before any comment.
- **Data writes:** the PUT carries the read `sha`. 409/422 fails the run without retry, and the old file is untouched. The bootstrap uses an orphan commit. Every call goes to `monitor-data`. The 256 KB, record and header asserts are present (but see F1).
- **Stale detection:** `detectGap` uses `>` against `prev.lastRunAt`. The marker is re-serialized from the parsed time. De-duplication covers open **and** closed issues since `now - 30d`. A retry after a failed write gives one issue.
- **SSRF:** syntax checks before any lookup on every hop. All addresses are checked, and a mixed answer is blocked. One resolve per hop, with the pinned address passed to the transport. `pinnedLookup` handles both callback shapes. `autoSelectFamily: false`, `agent: false`, SNI from the hostname (unset for IP literals), `Host` from the original URL. Redirect limit: exactly 5 hops followed, the 6th 3xx is `too many redirects`. An unparseable `Location` is `HTTP <status>`. Bad ports and userinfo are re-checked on redirects. One deadline covers all hops through `Promise.race` (F13). IPv6 mapped, compatible, NAT64 and 6to4 extraction, plus default-deny outside `2000::/3`. SIIT `::ffff:0:a.b.c.d` falls through to default-deny.
- **Time and UTC:** `utcDay` and the window `today-89..today` are UTC string comparisons. The day roll-over test is at 00:01Z. `fmtTime` and `absTime` are UTC-only. A future `lastRunAt` never gives a negative age.
- **Uptime math:** `percentText` uses integer tenths rounded down (SC-6). 95/5 gives 95.0%, and 100% appears only when every check passed. The 7-day and 90-day windows are UTC-day bounded, and missing days are excluded.
- **Page honesty:** stale overrides everything, per-target staleness (SC-3), unknown or malformed data gives the load error and never "Working" (P9), and a refresh failure keeps old data with a notice while staleness is still computed against `Date.now()`. The site code has no `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write`. Links use the deploy-time repo (F10). The contact comes only from metas (F2).

## Notes and assumptions
- Out of scope: `.github/workflows/`, `scripts/`, `tools/`, `test/sim/` (untracked, other agents).
- While reproducing F1, I briefly created and then deleted a temporary test file (`test/zz-reviewer-tmp.test.js`). No tracked file was changed by this review apart from this report.
