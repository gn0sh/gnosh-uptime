# QA report: T14, data bound and one-year history growth

- **Task:** T14 in `docs/tasks/uptime-monitor.md`. **AC:** AC-D3 (spec). The numbers feed back to Risk R3.
- **Measured against:** spec AC-D3 and R3, and architecture §7 "Size bound (D3)" and "Git history growth (R3)".
- **Script:** `test/sim/history-growth.mjs`. It is not in `npm test`.
- **Code under test:** two states. (1) Commit `95b4ba3`, where I found the bugs. (2) The **current working tree**, where the backend engineer made **uncommitted** edits to `src/config.js`, `src/datastore.js`, `src/state.js`, `src/cli.js` and `src/issues.js` while this task was running. The final numbers below come from state (2): `md5sum src/*.js | md5sum` = `64222b3e…`, the same before and after the final run. QA did not change anything in `src/` or `site/`.
- **Run by:** qa-engineer, 2026-10-29.
- **Environment:** Node v22.22.0. The package asks for Node 24 or later, but this container has no Node 24. git 2.43.0, Linux. No network and no pushes. All git work ran in scratch repos under the session scratchpad, with no remote.

## Verdict

| Code state | Verdict |
|---|---|
| `95b4ba3` (committed) | **FAIL**. Bugs B1, B2 and B3 are all open. |
| Current working tree (uncommitted fixes) | **PASS WITH MINOR ISSUES**. B1 and B2 are fixed, B3 is fixed for real text, and B4 is a minor leftover. The fixes still need to be committed, reviewed, and given regression tests. |

The arithmetic bound holds by a wide margin. A worst-case year at the 20-target maximum peaks at **57,141 B**. That is 18.4 times under 1 MB and 4.6 times under the writer's 256 KB cap. Git history grows by about **24 MiB a year** after `gc --aggressive`, or 27 MiB after plain `gc`. That works out to about 720 B per commit, and the growth is linear.

| Criterion | `95b4ba3` | Working tree | Evidence |
|---|---|---|---|
| AC-D3: current tree under 1 MB after 1 simulated year, 20 targets, defaults | PASS (max 56,361 B) | **PASS** (max 57,141 B) | Runs 1 and 4 below |
| AC-D3: each run changes only today's counts, state records and last-run time, with no unbounded growth | PASS | **PASS** | Each run's file went through `serializeData`, then `JSON.parse`, then `isValidStoredData`, then the next `applyRun`. `days` never went over 90. Tuples were 21 B or less against a 32 B budget. The size was flat from day 90 to day 365. |
| AC-D3: the per-record bounds hold for **every config the validator accepts** | **FAIL** (B1, B2, B3) | **PASS, minor gap** (B4) | Phase 1, scenarios C to I |
| AC-D3 / R3: `.git` growth measured and reported | PASS | **PASS** | 25,376,466 B (24.20 MiB) for 35,040 commits after `git gc --aggressive` |

## How to run

```
node test/sim/history-growth.mjs                 # 365 days x 96 runs x 20 targets, with git (about 3 min)
node test/sim/history-growth.mjs --no-git        # bounds and size only (about 80 s)
node test/sim/history-growth.mjs --days 100 --runs-per-day 288 --no-git   # 5-minute cron
node test/sim/history-growth.mjs --dir <scratch> --keep                   # keep the scratch repo
```

`npm test` doesn't run this script, because its glob is `test/**/*.test.js`. A bare `node --test` does pick it up, since that matches `test/**/*.mjs`. To handle that, the script checks `NODE_TEST_CONTEXT` and skips itself in about 40 ms. Checked: a bare `node --test` passed 288/288 with the sim marked as skipped, and `npm test` on the current tree passed 323/323.

The script exits 1 in four cases: the 1 MB bound is broken, a stored file fails read-back validation, `serializeData` throws, or the year config is invalid. A 21-target run checks the last case and exits 1 with `year config invalid`.

### What the simulation does
- **Inputs.** Everything goes through the real `parseConfig` with cron `7,22,37,52 * * * *`, which gives a 15-minute interval and N = 2.
  - **Targets:** 20.
  - **Names:** each is 50 characters, the maximum. 48 of them are 4-byte emoji, so each name is 194 B of UTF-8.
  - **URLs:** each is exactly 500 characters and survives URL normalization unchanged.
  - **Header:** the year run picks the largest header the writer accepts. On the current tree that is siteName 60 emoji, contact 200 emoji and contactLink 500 characters, which comes to 1,741 B. On `95b4ba3` it was the all-ASCII maximum, 961 B.
- **Runs.** 365 days × 96 runs.
  - **Timing:** each run is at its cron minute plus a random scheduler delay of 0 to 9 minutes.
  - **Outages:** each target has about 5 a year. Each lasts 1 to 192 runs, with reasons taken from the fixed vocabulary.
  - **Issues:** the bot opens one on each `open` action. A person closes a given issue about 0.05% of the time per run, which exercises the A7 path.
  - **Randomness:** seeded PRNG (`--seed 14`).
- **Per run.** `applyRun`, then `serializeData` (the production asserts), then a 1 MB check, `JSON.parse` and `isValidStoredData`. The validated object becomes the next run's `prev`, the same way `readData` and `writeData` hand state from run to run.
- **Git.** The script writes each version with `git fast-import` to an orphan `monitor-data` branch: one commit per run, a single `status.json`, with the bot as committer at the simulated time. It then runs `git gc --prune=now` and `git gc --aggressive --prune=now`, adds up the bytes in `.git`, and runs `git fsck`.
  - *Assumption:* fast-import stands in for 35,040 separate `git commit` calls, which would take about 30 minutes. Objects are content-addressed, so after `gc` the object set and packing match what per-commit `git commit` would produce.
  - GitHub's server-side packing is closer to plain `gc` than to `--aggressive`, so both figures are reported.

## Results

### Run 4 (final, current working tree): one year with git
Command: `node test/sim/history-growth.mjs --days 365 --dir <scratch>`. Exit 0, 2 m 44 s wall time.

```
Phase 1: D3 bounds with worst-case config-valid inputs
  A. 20 x (emoji name 50ch, ASCII url 500ch), no header text
    header 265 B, largest record 903 B, longest stored url 500 ch, serialize: ok 16997 B, read back: valid
  B. A + ASCII header maxima (siteName 60, contact 200, contactLink 500)
    header 1,019 B, largest record 903 B, longest stored url 500 ch, serialize: ok 17751 B, read back: valid
  C. A + multibyte header (siteName 60 emoji, contact 200 emoji)
    header 1,301 B, largest record 903 B, longest stored url 500 ch, serialize: ok 17513 B, read back: valid
  D. multibyte header + contactLink 500ch
    header 1,799 B, largest record 230 B, longest stored url 20 ch, serialize: ok 1550 B, read back: valid
  E. url 500ch with 150 quote chars (href grows to %22)
    config rejected: The address must be 500 characters or fewer once special characters are encoded. Shorten it.
  F. url 500ch with spaces (href grows to %20)
    config rejected: The address must be 500 characters or fewer once special characters are encoded. Shorten it.
  G. url 500ch of emoji path (href grows to %F0%9F...)
    config rejected: The address must be 500 characters or fewer once special characters are encoded. Shorten it.
  H. url 470ch ASCII + 10 quotes (href 500 -> 520)
    config rejected: The address must be 500 characters or fewer once special characters are encoded. Shorten it.
  I. lone-surrogate header (siteName 60, contact 200) + contactLink 500ch + names 50
    header 2,319 B, largest record 999 B, longest stored url 500 ch, serialize: THROWS: status.json header is over 2048 bytes, read back: n/a

Phase 2: 35,040 runs
  runs: 35,040 in 77.0 s; outage issues opened 828, recovered 827
  status.json final 56,962 B, max 57,141 B (at 2026-10-07T23:08:55Z), mean 52,368 B
  size at day 1: 19,657 B, 30: 31,814 B, 90: 56,971 B, 180: 56,979 B, 365: 56,962 B
  header 1,741 B (budget 2,048), largest target record 892 B (budget 1,024), largest day tuple incl. comma 21 B (budget 32), max days kept 90 (budget 90)
  architecture worst case 79,104 B; writer cap 262,144 B; AC-D3 limit 1,048,576 B
  AC-D3 current tree < 1 MB: PASS (margin x18.4)

Git (scratch repo .../scratchpad/sim/t14-sim-7VO7ov, branch monitor-data, no remote)
  commits: 35,040
  after fast-import            .git    26,022,360 B (24.82 MiB), pack 25,995,264 B, loose 0 B
  after git gc                 .git    28,546,593 B (27.22 MiB), pack 25,995,264 B, loose 0 B, took 0.8 s
  after git gc --aggressive    .git    25,376,466 B (24.20 MiB), pack 22,824,960 B, loose 0 B, took 80.7 s
  per commit after aggressive gc: 724.2 B; raw blob bytes written: 1,834,974,720 B
  git fsck: clean
```

The file stops growing at day 90, once the window is full, and stays flat from then on, so pruning holds for a full year. 1.83 GB of raw blob content packs down to 22.8 MB, about 80 times smaller.

### Run 1 (`95b4ba3`): one year with git, same command, exit 0

```
  status.json final 56,182 B, max 56,361 B (at 2026-10-07T23:08:55Z), mean 51,588 B
  header 961 B (budget 1,024), largest target record 892 B (budget 1,024), ...
  after git gc                 .git    28,473,987 B (27.15 MiB)
  after git gc --aggressive    .git    25,289,147 B (24.12 MiB), pack 22,737,920 B, took 81.9 s
  per commit after aggressive gc: 721.7 B
Phase 1 at 95b4ba3 (differences from run 4):
  C. ... header 1,301 B ... serialize: THROWS: status.json header is over 1024 bytes
  D. ... header 1,799 B ... serialize: THROWS: status.json header is over 1024 bytes
  E. ... largest record 1,010 B, longest stored url 800 ch, serialize: ok 1316 B, read back: REJECTED (readData would start fresh)
  F. ... largest record 1,030 B, longest stored url 820 ch, serialize: THROWS: status.json target record 1 is over 1024 bytes
  G. ... largest record 5,990 B, longest stored url 5780 ch, serialize: THROWS: status.json target record 1 is over 1024 bytes
  H. ... largest record 730 B, longest stored url 520 ch, serialize: ok 1036 B, read back: REJECTED (readData would start fresh)
```

### Run 2 (`95b4ba3`): 90 days with git, to check that growth is linear (`--days 90`)

```
  commits: 8,640
  after git gc                 .git     6,750,049 B (6.44 MiB)
  after git gc --aggressive    .git     5,990,848 B (5.71 MiB), pack 5,340,160 B, took 24.5 s
  per commit after aggressive gc: 693.4 B
```

Per commit, growth is 693 B at 90 days and 722 B at 365 days. So history grows linearly with the number of runs, and file size has no effect once the window is full.

### Run 3 (`95b4ba3`): 5-minute cron, 288 runs a day for 100 days, no git
Command: `--days 100 --runs-per-day 288 --no-git --seed 7`. Exit 0.

```
  runs: 28,800 in 26.5 s; outage issues opened 669, recovered 668
  status.json final 59,740 B, max 59,912 B (at 2026-04-06T20:44:15Z), mean 41,392 B
  header 961 B (budget 1,024), largest target record 896 B (budget 1,024), largest day tuple incl. comma 23 B (budget 32), max days kept 90 (budget 90)
  AC-D3 current tree < 1 MB: PASS (margin x17.5)
```

### Things that could have failed and didn't
- **Pruning:** the 90-day window held for a whole year. The most days kept was 90, and the size was flat from day 90 to day 365.
- **Read-back:** all 35,040 + 28,800 + 35,040 stored files passed `isValidStoredData`. That covers issue numbers, suppressed flags after a person closed an issue, and every reason in the vocabulary.
- **Day tuples:** they stayed under budget even at the highest allowed frequency of 288 checks a day (23 B against 32 B).
- **Target cap:** with 21 targets the sim exits 1, so the C1 cap is enforced.
- **Git integrity:** `git fsck` was clean on both 35,040-commit repos.

## Bugs

### B1 (major): a URL the validator accepts makes every later run start from empty state, so outage alerts never fire
- **Owner:** backend-engineer. **Status:** open at `95b4ba3`. **Fixed in the working tree** (uncommitted): `parseConfig` now limits `u.url.href`. Scenarios E and H are rejected and the repro below no longer gets past the config.
- **Cause:** `parseConfig` limited the URL **as typed** to 500 characters but stored `u.url.href`. Percent-encoding makes the href longer: a non-ASCII character becomes 6 to 12 characters, and a quote or space becomes 3. `isValidStoredData` requires the **stored** `url` to be 500 characters or fewer, so `readData` rejected the file the previous run wrote and returned `data: null` with a warning.
- **Impact:** every run starts fresh, for **every** target. `failStreak` never gets past 1, so with N ≥ 2 no outage issue ever opens (A3), and history never builds up (P5). The only sign is a warning line in the run summary. It doesn't take an unusual URL: a news-style Cyrillic slug of 139 characters is enough.
- **Repro:** `<scratch>/repro-readback.mjs`, not committed. It loops `readData`, then `applyRun` (target down), then `serializeData`, against a fake `gh`. At `95b4ba3`:
  ```
  $ node repro-readback.mjs "https://example.ru/novosti/$(python3 -c "print('о-перебоях-в-работе-сервиса-'*4)")"
  config ok: true input chars: 139 stored href chars: 599
  run 1: warning=null failStreak=1 checksToday=1 actions=none
  run 2: warning="The stored status.json could not be read, so the monitor starts fresh." failStreak=1 checksToday=1 actions=none
  ```
  With `'*3'` (111 characters, href 456 characters), run 2 shows `failStreak=2 actions=open`, which is correct.
- **Expected:** validate rejects the URL with a readable error. **Actual at `95b4ba3`:** validate passes, and from then on state resets silently on every run.

### B2 (major): a longer URL the validator accepts makes every run fail with `DataSizeError`
- **Owner:** backend-engineer. **Status:** open at `95b4ba3`, **fixed in the working tree**. Scenarios F and G are now rejected by the config.
- **Cause:** the same as B1. Once the normalized href pushes a target record over 1,024 B, `serializeData` throws and `cli.js run` exits 1 on every run. Issue actions run **before** the write, so issues can open or close while the stored data never moves forward.
- **Repro at `95b4ba3`:**
  ```
  node -e "import('./src/config.js').then(async({parseConfig})=>{const{serializeData}=await import('./src/datastore.js');const{applyRun}=await import('./src/state.js');const c=parseConfig(JSON.stringify({targets:[{name:'A',url:'https://example.com/'+'😀'.repeat(480)}]}));const{data}=applyRun(null,[{name:'A',url:c.targets[0].url,up:true,reason:null,checkedAt:'2026-01-01T00:00:00Z'}],{settings:{...c.settings},repo:'o/r'},new Date());console.log(c.ok,c.targets[0].url.length);serializeData(data)})"
  ```
  Output: `true 5780`, then `DataSizeError: status.json target record 1 is over 1024 bytes`. On the working tree, `c.targets` is empty and the error is "The address must be 500 characters or fewer once special characters are encoded."

### B3 (major): a header the validator accepts can go over the header assert, so every run fails
- **Owner:** backend-engineer, with the software-architect for the budget. **Status:** open at `95b4ba3`. **Fixed for real text in the working tree**: `MAX_HEADER_BYTES` is now 2,048 and `contactLink` is limited on its href. B4 is what remains.
- **Cause:** the §7 header budget, "contact ≤ 800 B + about 200 B fixed", left out `siteName` (up to 240 B of UTF-8) and `contactLink` (500 characters). The measured fixed overhead is about 259 B. Even the all-ASCII maximum is 1,019 B, only 5 B under 1,024.
- **Repro:** `<scratch>/repro-header.mjs`, a realistic Chinese contact line. At `95b4ba3`:
  ```
  config ok: true errors: 0 contact chars: 195 contactLink chars: 292
  DataSizeError: status.json header is over 1024 bytes
  ```
  On the working tree, the same script prints `serialize ok`.

### B4 (minor): lone-surrogate escapes still go over the 2,048 B header budget
- **Owner:** backend-engineer.
- **Cause:** limits are counted in code points, and `\uD800` is one code point, but `JSON.stringify` writes a lone surrogate back out as the 6-byte escape `\ud800`. The config doesn't reject surrogates: `CONTROL_CHARS` covers `Cc`, `Cf`, U+2028 and U+2029, but not `Cs`. The header can therefore reach 60×6 + 200×6 + 500 + 259 = 2,319 B.
- **Impact:** a config that passes validate fails every run. Only the repo owner, who writes the config, can trigger this, and the text it takes is garbage, so it's minor. The target record has the same headroom problem: 50 lone surrogates in a name give a 999 B record against 1,024 B (scenario I). That still fits, but only by 25 B.
- **Repro:** `<scratch>/repro-surrogate.mjs` on the working tree. It feeds a config whose JSON text contains `"siteName":"\ud800…×60"` and `"contact":"\ud800…×200"`:
  ```
  config ok: true []
  header bytes 2248
  DataSizeError: status.json header is over 2048 bytes
  ```
  Phase 1 scenario I shows the same failure.
- **Suggested fix:** reject unpaired surrogates in every text field. For example, add `\p{Cs}` to `CONTROL_CHARS` in `config.js` and to `CTL` in `datastore.js`, or check `!str.isWellFormed()` (available from Node 20). Then 4 B per code point is the true worst case, and the budgets hold.

### Doc drift (minor): architecture §7 still states the old numbers
- **Owner:** software-architect.
- §7 still says the header budget is 1,024 B, the worst case is 79,104 B, and names can be 60 characters. The code now allows a 2,048 B header and 50-character names. The new worst case is `20 × (90 × 32 + 1,024) + 2,048 = 80,128 B`. That is still 13 times under 1 MB, so nothing changes for AC-D3.

### Ask for the backend engineer
Add regression tests for scenarios C, E, F, H and I to `test/config.test.js` and `test/datastore.test.js`. The working-tree fixes don't have tests yet as far as I could see. The property worth testing directly: if `parseConfig` returns `ok`, then `serializeData(applyRun(...))` neither throws nor produces a file that `isValidStoredData` rejects. The new self-check inside `serializeData` turns a silent reset into a loud failure, which is good, but it doesn't stop a validator-approved config from failing every run.

## Feedback to R3 (git history growth)

| Measure (20 targets, worst-case names, URLs and header, 15-minute cron) | Value |
|---|---|
| Commits per year | 35,040 |
| `.git` after `git gc --aggressive`, 1 year | **25.4 MB (24.2 MiB)** |
| `.git` after plain `git gc` (closer to GitHub's server packing), 1 year | 28.5 MB (27.2 MiB) |
| Growth per commit | about 720 B, linear (693 B at 90 days, 724 B at 365 days) |
| Architecture estimate | "a few tens of MB a year". **Confirmed.** |

**Conclusion for R3:** history grows by about 25 to 30 MB a year at the 20-target maximum. A 3-target repo would grow much less, but I didn't measure that. At this rate the data branch would take about 35 years to reach GitHub's recommended 1 GB repository size, so the owner-approved history reset can stay under Later.

**Where the cost lands:** anyone who clones the repo. A default `git clone` fetches every branch, including `monitor-data`, so a full clone gets about 25 MB bigger each year. Pages and the raw fetch are not affected. The README (T17) could mention `git clone --single-branch`.

**Not measured:** GitHub's actual server-side pack. That needs a live repo; T18 or T19 could check it with `git count-objects -vH` on a mirror clone after a month of dogfooding.

## Assumptions
- **Name length:** "maximum-length names" means 50 characters (`MAX_NAME_CHARS`, SC-1), not the 60 in architecture §5. The emoji name (194 B) is the year-run worst case among well-formed text. Lone surrogates (300 B) are tested separately as B4.
- **URLs:** the year run uses ASCII URLs that stay at 500 characters after normalization. On the current tree, every stored href is ASCII and 500 characters or fewer, so this is the true URL worst case.
- **Node version:** Node 22 instead of Node 24. Nothing in the tested modules depends on a Node 24 API.
- **Code moving underneath:** `src/` changed under me partway through. I re-ran everything on the final state and checked that `src/*.js` didn't change during the final run (same md5 before and after).
- **Repro scripts:** `repro-readback.mjs`, `repro-header.mjs` and `repro-surrogate.mjs` are in the session scratchpad and are not committed. The repro steps above give what each one does, and B2 has a one-liner.
