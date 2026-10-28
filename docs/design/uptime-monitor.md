# Design: uptime-monitor (MVP)

- **Owner:** UX Designer
- **Spec:** `docs/specs/uptime-monitor.md` (Draft v2)
- **Inputs:** `docs/research/focus-group-uptime-monitor.md` (simulated personas, so findings are hypotheses)
- **Status:** Draft v1, ready for a Focus Group on copy (see §13)
- **Scope:** the public status page (every state), all visitor-facing copy, accessibility, the 90-day history and its text alternative, the wording and structure of the four kinds of GitHub Issue, and the README setup steps. I own the wording and accessibility of AC-P2 to AC-P11. Data shape, fetch, caching, escaping mechanics and the keepalive belong to the architect.

There is no existing design system, component library or token file in the repo, so every component below is new. Tokens are defined in §8 so later pages can reuse them.

---

## 1. Who we are designing for

**Rosa (P2, the visitor) is the design target for the page.** She is a retired teacher who uses large text (200% zoom) and a screen reader. Someone sent her the link because a site was not working. She wants three answers, in this order:

1. Is it broken? (the headline)
2. Is anyone dealing with it? (outage report link, contact line)
3. When should I come back? (last-checked time, "about these checks")

She does not care about uptime percentages. Those are for the owner and sit lower on the page.

**Jamal and Priya (P1, the owners) are the target for the issues and the README.** They know GitHub a bit. Jamal has never written YAML.

### Plain-language rules (apply to every string in this doc)
- Short sentences. Aim for a reading age of about 9 to 11.
- Say "working" and "not working", never "up", "down", "operational", "degraded", "outage" (on the page), "stale", "monitor", "endpoint", "HTTP", "latency", "uptime" as a noun on its own.
  - Exception: the issue titles must contain "down" (AC-A2) and "stale" (AC-S7). Issues are for owners, so that is fine.
- "We" means the site owner's checks. The page speaks for the owner.
- Never claim speed or certainty. The words "guaranteed", "real-time", "live", "instantly", "always", "every N minutes exactly" and "before your users" never appear (AC-S6, AC-A9).
- Numbers as digits. Times in 24-hour clock with "UTC". Dates as words ("Tuesday 27 October"), never `27/10`.
- No jargon in visible text, including link text. Link text makes sense on its own (WCAG 2.4.4).

---

## 2. User flows

### Flow V1: visitor checks if a site is working
1. Visitor opens the link someone sent them.
2. The page shell loads. The headline area says "Getting the latest status…" (loading state, §4.6).
3. The page fetches the status data from the data branch.
4. The page works out the overall state in the browser (§3), using the visitor's clock (AC-S2).
5. The headline sentence replaces the loading text. A screen reader that starts at the top reads the headline first (AC-P2).
6. If the visitor's site is not working, they see a link to the outage report (AC-P7) and the contact line (AC-P11).
7. If the visitor keeps the page open, the "N minutes ago" text updates every 60 seconds and the data is fetched again every 5 minutes (§6.5). If the headline's meaning changes, a screen reader hears one short update.

### Flow V2: the data can't be loaded
1. Steps 1 to 3 as above. The fetch fails, times out after 15 seconds, or returns data the page can't read.
2. The page shows the load-error state (§4.5). No site is shown as working (AC-P9).
3. The visitor presses "Try again". The page fetches again. The result is announced (§6.5).

### Flow O1: owner sets up (README, §11)
Use this template → create repo → turn on Pages → edit the config in the browser → check the Actions tab → run the first check → open the page → watch the repo for issues.

### Flow O2: owner gets an outage alert (§10)
Site fails N checks in a row → workflow opens an "is down" issue → GitHub notifies the owner (if watching) → site works again → workflow comments with outage length and closes the issue.

### Flow O3: owner learns the checks stopped (§10.3)
Schedule stops → page shows the "haven't been able to check" state to visitors → schedule restarts → first run sees the gap → opens one "Monitor was stale from X to Y" issue → owner reads it and closes it.

---

## 3. How the page decides what to say

Everything here runs in the browser at view time and again every 60 seconds (AC-S2).

### 3.1 Inputs (from the fetched data, AC-D2)
- `lastRunAt`: time of the last completed run.
- For each target: `name`, last state (`up` / `down` / none yet), `lastCheckedAt`, last failure reason, open outage issue number, 90 daily `{checks, successes}` records.
- Config values: `siteName`, `interval`, `staleThreshold`, optional contact line.
- `now`: the visitor's clock.

### 3.2 Per-target state (shown on each card)
Work these out in order. The first match wins.

| # | Condition | Target state |
|---|---|---|
| 1 | The page-wide state is **stale** (3.3, row 4) | **Not checked recently** |
| 2 | `now − target.lastCheckedAt` > `staleThreshold` (this target alone has not been checked, e.g. it was skipped) | **Not checked recently** |
| 3 | The target has never been checked | **Not checked yet** |
| 4 | Last check failed | **Not working** |
| 5 | Last check succeeded | **Working** |

Row 2 is a design addition (see proposed spec change SC-3). Without it, one target could keep saying "Working" from an old check while the rest of the page is fresh.

### 3.3 Page-wide state (drives the headline)
The first match wins. This order is the core honesty rule: **any doubt beats good news.**

| # | Condition | Page state | Headline section |
|---|---|---|---|
| 1 | Data not yet fetched | Loading | §4.6 |
| 2 | Fetch failed, timed out, or data is missing or malformed | Load error | §4.5 |
| 3 | Config has zero valid targets | No sites | §4.7 |
| 4 | `lastRunAt` exists and `now − lastRunAt` > `staleThreshold` | Stale | §4.4 |
| 5 | `lastRunAt` is missing, or every target is "Not checked yet" | Never checked | §4.3 |
| 6 | At least one target is "Not working" | Some not working | §4.2 |
| 7 | At least one target is "Not checked recently" or "Not checked yet", and none is "Not working" | Partly checked | §4.2 |
| 8 | Every target is "Working" | All working | §4.1 |

If `lastRunAt` is in the future (visitor's clock is behind), treat the age as 0 and show "less than a minute ago". Never show a negative time.

### 3.4 Headline-sentence rules
1. **Exactly one `<h1>`, and it is the headline.** It is the first thing inside `<main>` (AC-P2).
2. The headline is one or two sentences: the **state sentence**, then the **time sentence**. Both live in the same `<h1>` so a screen reader reads them together.
3. The state sentence names the problem sites, using the rules in 3.5.
4. The time sentence always says when we last checked, relative time first, then the absolute UTC time: "We last checked 7 minutes ago, at 14:05 UTC." (Order refined from the AC-P2 example. "7 minutes ago" is what Rosa can use; UTC is the precise backup.)
5. The headline never contains "Everything is working" unless page state is "All working" (AC-S4).
6. The headline never uses colour, icons or symbols to carry meaning. An icon may sit next to it, with `aria-hidden="true"`.
7. The browser tab title (`<title>`) starts with a short form of the same state, so a visitor with many tabs, or a screen reader user switching tabs, hears the state first:
   - All working: `Everything is working – {siteName} status`
   - Some not working: `Not working: Shop – {siteName} status` (or `Not working: 3 sites – …`)
   - Stale: `Not checked recently – {siteName} status`
   - Load error: `Status unavailable – {siteName} status`
   - Loading: `{siteName} status`

### 3.5 Naming the problem sites in the headline
Let `P` be the list of "Not working" targets, in config order, and `T` the total number of targets.

| Case | State sentence |
|---|---|
| `T = 1`, it is not working | "{Name} is not working right now." |
| `P` has 1 site, `T > 1` | "{Name} is not working right now. Everything else is working." |
| `P` has 2 sites | "{A} and {B} are not working right now. Everything else is working." |
| `P` has 3 sites | "{A}, {B} and {C} are not working right now. Everything else is working." |
| `P` has 4 or more sites, or the names together are longer than 80 characters | "{n} of our {T} sites are not working right now. They are listed below." |
| Every target is not working (`T > 1`) | "None of our sites are working right now." |

- Drop "Everything else is working." if any other target is "Not checked recently" or "Not checked yet". Use "We haven't checked {Name} yet." or "Some sites haven't been checked recently." instead (see §4.2).
- Names are inserted as text, never as markup (AC-SEC1).
- In the "4 or more" form, the problem sites still appear first in a short list right under the headline (§4.2), so nobody has to hunt.

### 3.6 Time-formatting rules
Relative time, from `now − t`:

| Age | Text |
|---|---|
| under 1 minute, or in the future | "less than a minute ago" |
| 1 minute | "1 minute ago" |
| 2 to 59 minutes | "{n} minutes ago" |
| 60 to 119 minutes | "1 hour ago" |
| 2 to 47 hours | "{n} hours ago" (round down) |
| 48 hours or more | "{n} days ago" (round down) |

Absolute time:
- Same UTC day as `now`: "14:05 UTC".
- Different day: "14:05 UTC on Tuesday 27 October".
- Different year: add the year: "14:05 UTC on Tuesday 27 October 2025".
- Wrap every time in `<time datetime="2026-10-28T14:05:00Z">`.

Durations (issues and stale text): "about 5 minutes", "1 hour 15 minutes", "4 hours 55 minutes", "2 days 3 hours". Drop minutes once a duration is over 2 days.

---

## 4. Page states and exact copy

Placeholders: `{siteName}` from config (default: repo name). `{rel}` relative time, `{abs}` absolute time (3.6). `{interval}` as words, e.g. "15 minutes".

Every state keeps the same page skeleton (§5), so content does not jump around.

### 4.1 All working
- **Headline (`h1`):** "Everything is working. We last checked {rel}, at {abs}."
- **Each card:** state "Working", line "Last checked {rel}, at {abs}."

### 4.2 Some not working, or partly checked
- **Headline:** state sentence from 3.5, then "We last checked {rel}, at {abs}."
  - Example: "Shop is not working right now. Everything else is working. We last checked 7 minutes ago, at 14:05 UTC."
  - Partly checked, nothing broken: "Everything we have checked is working. We haven't checked Blog yet. We last checked 7 minutes ago, at 14:05 UTC."
  - Partly checked, 2 or more unchecked: "Everything we have checked is working. Some sites haven't been checked yet. We last checked …"
  - If the unchecked sites are "Not checked recently" rather than "Not checked yet", say "We haven't been able to check {Name} recently." / "Some sites haven't been checked recently."
- **Problem list** (only when at least one site is not working): directly under the contact line, a short list headed "Not working right now" (`h2`), one line per site: "{Name}: read the outage report" (link, if an issue is open) or "{Name}" (no issue yet).
- **Not-working card:**
  - State: "Not working"
  - "Not working since about {abs of first failed check} ({rel})." Only if the outage start time is known.
  - "Last checked {rel}, at {abs}."
  - Reason line (3.7), e.g. "What we saw: the site took too long to answer."
  - If an outage issue is open (AC-P7): link "Read the outage report for {Name}". Below it, small text: "The report is on GitHub. You don't need an account to read it."
  - If no issue is open yet (first failure, N not reached): "We'll check again soon." No link.

### 4.3 Never checked (all targets "Not checked yet")
- **Headline:** "We haven't checked these sites yet, so we don't know if they're working. Please come back in about an hour."
  - One target: "We haven't checked {Name} yet, so we don't know if it's working. Please come back in about an hour."
- **Each card:** state "Not checked yet", line "We started watching this site recently. The first check hasn't happened yet."
- No uptime figures. History shows "Not checked" for every day.

### 4.4 Stale (checks have stopped or are late)
The visually distinct state required by AC-S3. It overrides every other state except Loading and Load error.
- **Headline:** "We haven't been able to check recently, so we don't know if things are working. Our last check was {rel}, at {abs}."
  - One target: "…so we don't know if {Name} is working…"
- **Notice under the headline** (a bordered panel with the "unknown" pattern, §8):
  - "This page shows what we saw at our last check. Things may have changed since then."
  - Small text, last line: link "If you run this page: how to restart the checks" → README `#if-checks-stop` (AC-S5).
- **Each card:**
  - State: "We haven't been able to check recently, so we don't know if it's working" (AC-P3 wording; displayed in full, it wraps).
  - Last-known line: "When we last checked, {rel} at {abs}, it was working." / "…it was not working." / "…we hadn't checked it yet."
  - Never the word "Working" as a state label (AC-S4). The last-known line says "it was working", in past tense, inside a sentence.
  - The outage report link stays if an issue is open.
- The 7- and 90-day figures stay. They describe the past and are still true.

### 4.5 Load error (data failed to load, AC-P9)
- **Headline:** "We can't load the status right now."
- **Body text:** "This doesn't mean the sites are working or not working. We just can't tell at the moment. Please try again in a few minutes."
- **Button:** "Try again". While retrying, the button text changes to "Trying again…" and is disabled. The button stays in the same place.
- **Small text:** "If you run this page: the first check may not have run yet, or the status data may be missing. See the setup guide." (link to README `#setup`)
- **No target cards, no history, no figures.** The "About these checks" section and the footer still show.
- Contact line: shown if the page has it without the data (see SC-7). Otherwise left out.
- **Refresh failure while the page is open** (data loaded earlier, a later 5-minute refresh fails): keep the last data, keep computing staleness from it, and add a notice under the headline: "We couldn't get newer information. This page shows what we knew {rel of last good fetch}." This is not a fallback to "working": the stale rules still apply, so after the threshold the page goes stale.

### 4.6 Loading
- **Headline (static HTML, no JS needed):** "Getting the latest status…"
- `<main aria-busy="true">` until the data is processed.
- No spinner, no skeleton animation, no pulsing (see §7.6). Card area is empty, not grey placeholder boxes.
- If loading takes more than 15 seconds, switch to Load error.
- **`<noscript>`** in the headline area: "This page needs JavaScript to show the status. Please turn on JavaScript, or try a different browser."

### 4.7 No sites configured
- **Headline:** "There are no sites on this status page yet."
- Small text: "If you run this page: add your sites to the config file. See the setup guide." (link)

### 4.8 Many targets (up to 20)
- Cards keep config order (stable and predictable: a visitor looking for "Shop" finds it where it was last time). The headline and the "Not working right now" list bring problems to the top.
- Each card is compact (§5.3). The day-by-day table is collapsed by default, so 20 cards is about 20 short blocks.
- No pagination, no search, no tabs.
- If `T ≥ 6`, add a "Sites on this page" count line before the list: "{T} sites" (helps screen reader users know how long the list is, alongside the list's own item count).

### 4.9 Very long names
- Names wrap; they are never truncated or shown with "…" (truncation hides content at 200% zoom, AC-P10). CSS: `overflow-wrap: anywhere`.
- Headline switches to the count form when names together exceed 80 characters (3.5).
- In link text, the long name stays: "Read the outage report for {Name}".
- A name with no spaces (e.g. a long hostname) must still wrap at 320 px. Test fixture: a 50-character name with no spaces, and a 50-character name with markup characters (`<img src=x onerror=alert(1)>…`).
- Proposed limit: 50 characters (SC-1).

### 4.10 Reason lines (from the stored last failure reason)
The architect defines the reason codes. Visitor copy for each:

| Reason | Visitor text ("What we saw: …") |
|---|---|
| timeout | "the site took too long to answer." |
| dns | "we couldn't find the site's address." |
| tls | "there was a problem with the site's secure connection." |
| connection | "we couldn't connect to the site." |
| http status (non-2xx) | "the site answered with an error (code {status})." If status not stored: "the site answered with an error." |
| too many redirects | "the site kept sending us to other pages." |
| blocked redirect | "the site sent us to an address we don't check." |
| unknown | "something went wrong when we checked." |

### 4.11 Text that appears in every loaded state
- **Header:** "{siteName}" (large text), then "Status page" (smaller). Not a heading (the `h1` is the headline). Rendered as `<p>`.
- **Contact line (AC-P11), right after the headline:** "Questions? {contact text}". If the contact has a link, the link text is the contact text or "Contact us" (SC-2). `mailto:` and `https:` only (AC-C12).
- **About these checks (AC-P6, AC-A9), `h2`:**
  > We check each site about every {interval}. Checks can be late, sometimes by an hour or more, because they run on a free service that doesn't promise exact times.
  >
  > We only know how a site was doing at the moment we checked it. A short problem between two checks may not show up here.
  >
  > When a site stops working, the people who run it usually find out about 30 to 60 minutes later, sometimes later than that.
  >
  > The percentages count only the checks we actually made. Days with no checks are left out.
  >
  > This page updates by itself every few minutes. You can also reload it.
- **Footer:** "Times are shown in UTC (Coordinated Universal Time)." and "Made with gnosh-uptime." (link to the template repo). Nothing else.

---

## 5. Layout

### 5.1 Page structure (landmarks and headings)
```
<header>                     siteName / "Status page"        (banner)
<main aria-busy>             
  <h1>                       headline sentence(s)            AC-P2
  [stale notice | refresh notice | load error body + button]
  <p>                        "Questions? …"                  AC-P11
  <section>  <h2> Not working right now      (only if any)
  <section>  <h2> Our sites                                  AC-P3, P4, P7
     <ul> <li><article> <h3> {Name}  ...   (one per target)
  <section>  <h2> About these checks                         AC-P6
<footer>                     UTC note, credit                (contentinfo)
<div role="status" class="visually-hidden">  announcer       §6.5
```
No navigation, no skip link (the header is two short lines; the `h1` is reachable with one heading jump, and `main` is a landmark). Single column at every width.

### 5.2 Wireframe: phone (360 px, also what 200% zoom on a 720 px window looks like)
```
+--------------------------------------+
| Example Co                           |
| Status page                          |
+--------------------------------------+
|                                      |
| [X] Shop is not working right now.   |  <- h1, ~1.75rem bold
|     Everything else is working.      |
|     We last checked 7 minutes ago,   |
|     at 14:05 UTC.                    |
|                                      |
| Questions? Email help@example.com    |
|                                      |
| NOT WORKING RIGHT NOW          (h2)  |
|  - Shop: read the outage report      |
|                                      |
| OUR SITES                      (h2)  |
| +----------------------------------+ |
| | Shop                       (h3)  | |
| | [X] Not working                  | |
| | Not working since about 13:20    | |
| | UTC (52 minutes ago).            | |
| | Last checked 7 minutes ago,      | |
| | at 14:05 UTC.                    | |
| | What we saw: the site took too   | |
| | long to answer.                  | |
| | > Read the outage report for Shop| |
| |                                  | |
| | Last 7 days: 97.9% working       | |
| | Last 90 days: 99.6% working      | |
| | 90 days ago                      | |
| | |||||||||||||||||||||||||||||||| | |  <- 30 days per row
| | |||||||||:|||||||||||||||||||||| | |
| | ||||||||||||||||[]||||||||||||:x | |
| | Today -------------------------^ | |
| | Working all day on 86 days, some | |
| | problems on 3 days, not checked  | |
| | on 1 day.                        | |
| | [+] Show day-by-day history      | |
| +----------------------------------+ |
| +----------------------------------+ |
| | Blog                       (h3)  | |
| | [✓] Working                      | |
| | Last checked 7 minutes ago, ...  | |
| | ...                              | |
| +----------------------------------+ |
|                                      |
| ABOUT THESE CHECKS             (h2)  |
| We check each site about every 15    |
| minutes. Checks can be late, ...     |
+--------------------------------------+
| Times are shown in UTC ...           |
+--------------------------------------+
Legend for strip: | working all day   : some problems (shorter, notched)
                  [] not checked (outline only)   x mostly not working
```

### 5.3 Wireframe: desktop (≥ 900 px)
```
+------------------------------------------------------------------------+
|  Example Co                                                            |
|  Status page                                                           |
+------------------------------------------------------------------------+
|        max content width 46rem, centred                                |
|  [!] We haven't been able to check recently, so we don't know if       |
|      things are working. Our last check was 5 hours ago, at 09:10 UTC. |
|  +------------------------------------------------------------------+  |
|  | This page shows what we saw at our last check. Things may have   |  |
|  | changed since then.                                              |  |
|  | If you run this page: how to restart the checks                  |  |
|  +------------------------------------------------------------------+  |
|  Questions? Email help@example.com                                     |
|                                                                        |
|  Our sites                                                             |
|  +------------------------------------------------------------------+  |
|  | Shop                                                             |  |
|  | [?] We haven't been able to check recently, so we don't know if  |  |
|  |     it's working.                                                |  |
|  | When we last checked, 5 hours ago at 09:10 UTC, it was working.  |  |
|  |                                                                  |  |
|  | Last 7 days: 99.8% working        Last 90 days: 99.1% working    |  |
|  | ||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||||:[]| |  <- 90 in one row
|  | 90 days ago                                                Today |  |
|  | Working all day on 86 days, some problems on 3 days, not checked |  |
|  | on 1 day.                                                        |  |
|  | [+] Show day-by-day history for Shop                             |  |
|  +------------------------------------------------------------------+  |
|  ...                                                                   |
+------------------------------------------------------------------------+
```

### 5.4 Responsive rules
- One column always. Max content width `46rem`; side padding `1rem` (16 px) on phones, `2rem` at ≥ 600 px.
- History strip: one row of 90 days when the card's inner width is ≥ 540 px (container query, falling back to a media query); otherwise 3 rows of 30. Each day mark is at least 4 px wide with a 2 px gap; it never shrinks below that, it wraps instead.
- The 7- and 90-day figures sit side by side when there is room and stack otherwise (flex-wrap).
- All sizes in `rem`/`em`. No fixed heights anywhere, so text spacing overrides (WCAG 1.4.12) and 200% zoom don't clip.
- Must reflow with no horizontal scroll at **320 CSS px** (WCAG 1.4.10), which is stricter than the spec's 360 px (SC-4).

---

## 6. Components

All new (no existing components to reuse).

| Component | What it is | ACs |
|---|---|---|
| `PageHeader` | siteName + "Status page", `<header>` | P1 |
| `StatusHeadline` | the `h1`, state + time sentences, icon (aria-hidden) | P2, S1, S3, S4 |
| `StatusNotice` | bordered panel for stale / refresh-failed / load-error body | S3, S5, P9 |
| `RetryButton` | "Try again" button, load-error only | P9 |
| `ContactLine` | "Questions? …" | P11 |
| `ProblemList` | "Not working right now" `h2` + list | P2, P7 |
| `TargetList` | `<ul>` of `TargetCard` | P3 |
| `TargetCard` | `<article>` with `h3` name, state, times, reason, link, uptime, history | P3, P4, P7 |
| `StateLabel` | icon + text label for a state | P3, P10 |
| `TimeText` | relative + absolute time in `<time>` | P3, S1 |
| `OutageLink` | link to the open issue | P7 |
| `UptimeFigures` | "Last 7 days: 99.8% working" ×2 | P4, P5 |
| `HistoryStrip` | 90 day marks, decorative, `aria-hidden` | P4, P10 |
| `HistorySummary` | one sentence text alternative | P4, P10 |
| `HistoryTable` | `<details>` + `<table>` day-by-day | P4, P10 |
| `AboutChecks` | the `h2` section of fixed copy | P6, A9 |
| `PageFooter` | UTC note, credit | — |
| `Announcer` | visually hidden `role="status"` | §6.5 |

### 6.1 `StateLabel`
| State | Icon (aria-hidden) | Text | Visual |
|---|---|---|---|
| Working | check mark in a circle | "Working" | green text and icon |
| Not working | X in a circle | "Not working" | red text and icon, bold |
| Not checked recently | question mark in a circle | AC-P3 sentence | dark amber text, icon has dashed ring |
| Not checked yet | clock face | "Not checked yet" | grey text |

Each state differs by **text and icon shape**, not only colour. The icon is 1.25em, sits before the text, and is never the only signal.

### 6.2 `UptimeFigures` (AC-P4, AC-P5)
- "Last 7 days: {p}% working" and "Last 90 days: {p}% working".
- `p = successes ÷ checks` over days in the window that have at least one check; one decimal place.
- **Rounding: round down** to one decimal (99.96 → "99.9%"), so "100.0%" only ever means zero failed checks. 95 of 100 still shows "95.0%" (AC-P5 test passes). See SC-6.
- No checks in the window: "Last 7 days: no checks yet".
- Visually secondary (normal weight, not large).

### 6.3 `HistoryStrip`, `HistorySummary`, `HistoryTable` (the 90-day history, AC-P4, AC-P10)
**Day classes** (per target per UTC day):

| Class | Rule | Mark (non-colour cue first) | Table text |
|---|---|---|---|
| Working all day | checks > 0 and successes = checks | full-height solid bar | "Working all day" |
| Some problems | checks > 0, 0 < failure share < 50% | 60% height bar, solid | "Some problems ({p}% working)" |
| Mostly not working | checks > 0, failure share ≥ 50% | 30% height bar with an X cut-out / thick bottom | "Mostly not working ({p}% working)" |
| Not checked | checks = 0 | full-height **outline only**, no fill, dashed | "Not checked this day" |

The height differences make the classes distinguishable in greyscale and for colour-blind visitors; colour (green / amber / red / none) is extra.

**Strip:** a `<div aria-hidden="true">` of 90 marks, oldest left, today right (rows of 30 on narrow widths, oldest row on top). Labels "90 days ago" and "Today" sit under the ends as visible text (also aria-hidden; the summary carries the meaning). Marks are not focusable and have no hover tooltips: 90 × 20 tab stops would be unusable, and hover-only content fails keyboard users. The table is the detailed view.

**Summary (the text alternative, always visible):**
- "Last 90 days: working all day on {a} days, some problems on {b} days, not checked on {c} days."
  - Drop any part that is 0. Combine "some problems" and "mostly not working" into "problems on {b} days" in the summary.
  - All 90 days fine: "Working all day on every day in the last 90 days."
  - If problems: add "Most recent problem: {weekday} {date}."
- Target added fewer than 90 days ago: count only the days since its first check and say "Since we started checking on {date}: …". Days before that are not shown in the strip as "Not checked"; the strip starts at the first day (marks before it are omitted, the strip is right-aligned).

**Table (`<details>`, closed by default):**
- `<summary>`: "Show day-by-day history for {Name}" (the name makes 20 of these distinguishable in a screen reader's list of controls).
- `<table>` with `<caption>` "Day-by-day history for {Name}, newest first", columns `Day` | `Result` | `Checks`.
  - `Day`: "Wednesday 28 October" (`<th scope="row">`).
  - `Result`: table text above.
  - `Checks`: "96 checks" / "0 checks".
- Newest first, all 90 days (or since first check). 90 short rows is acceptable inside a closed `<details>`; no extra filtering is needed.
- `<details>` open/closed state is remembered per target in `localStorage` (wrapped in try/catch; optional).

### 6.4 `OutageLink`
- Text: "Read the outage report for {Name}". Plain `<a href>` to `https://github.com/{owner}/{repo}/issues/{n}`. Same tab (no `target="_blank"`, so Back works as Rosa expects).
- Only when the data has an open outage issue number for that target (AC-P7).

### 6.5 Updates while the page is open, and live regions
**Behaviour:**
- Every 60 s: recompute relative times and all states from the data already loaded (staleness can kick in without a fetch, AC-S2).
- Every 5 minutes: fetch the data again. Also fetch when the tab becomes visible again after being hidden for over 5 minutes.
- Updates replace text in place. No layout shift: card order is fixed.

**Live regions, justified narrowly:** the `h1` itself is **not** a live region (otherwise the "N minutes ago" tick would be read out every minute). One visually hidden `role="status"` (polite) element exists. It is written to only when:
1. The **page-wide state changes** after a refresh or a 60-second recompute (e.g. Not working → All working, or anything → Stale). It gets: "Update: {new state sentence}" (no time sentence). Justification: a visitor waiting for their site to come back may be in another tab or reading elsewhere on the page; this is the one thing they are waiting for.
2. The result of pressing **"Try again"**: "Status loaded." + the new state sentence, or "We still can't load the status."

It is never written to for relative-time ticks, for per-card changes that don't change the page state, or on the first load (the `h1` is read on arrival). At most one announcement per refresh.

The `<title>` is updated whenever the page state changes.

### 6.6 Keyboard order
Header (no stops) → [Stale notice link "how to restart the checks"] → [Retry button] → contact link → problem-list links → for each card: outage link, then "Show day-by-day history" → About section (no links) → footer link. DOM order equals visual order. No custom keyboard handling; only native links, a `<button>` and `<details>`.

---

## 7. Accessibility (target WCAG 2.2 AA)

The spec says WCAG 2.1 AA; we design to 2.2 AA, which includes it (SC-4).

### 7.1 No colour-only status (1.4.1, AC-P10)
Every state has a text label and a distinct icon shape. History days differ by bar height and fill/outline. The stale panel has a border and an icon, not just a background tint. Links are underlined.

### 7.2 Semantics and reading order (1.3.1, 1.3.2, 2.4.6)
- `lang="en"` on `<html>`.
- Landmarks: `header`, `main`, `footer`. Headings: one `h1` (headline), `h2` per section, `h3` per site name. No skipped levels.
- `TargetList` is a `<ul>`; each `<li>` holds an `<article aria-labelledby="{h3 id}">`.
- State and time are plain text in the card, not `aria-label`s, so they work with screen readers, browser translation and copy-paste.
- Icons are inline SVG with `aria-hidden="true"` and `focusable="false"`.
- `<time datetime>` on every time.

### 7.3 Contrast (1.4.3, 1.4.11)
- Body text and every state label: at least 4.5:1 against its background. Large headline text: still target 4.5:1.
- Icons, day marks, the "not checked" outline, card borders and focus rings: at least 3:1 against adjacent colours.
- Tokens in §8 must be checked with a contrast tool during build; the values given are chosen to pass but the frontend engineer verifies in both light and dark schemes.

### 7.4 Zoom and reflow (1.4.4, 1.4.10, 1.4.12)
- Base font size `1.125rem` (18 px at default settings) for body text; Rosa uses large text and we should not make her zoom further than she already does.
- No horizontal scroll at 320 CSS px or at 400% zoom on a 1280 px window. Only the history strip is a 2D graphic and it wraps into rows.
- Line height 1.5, paragraph spacing 1em, no fixed heights; survives user text-spacing overrides.

### 7.5 Focus and targets (2.4.7, 2.4.11, 2.5.8)
- Visible focus ring: 3 px solid, 2 px offset, focus token colour, on every link, the button and `<summary>`.
- Nothing sticky or fixed, so focus is never hidden (2.4.11).
- Button and `<summary>` at least 44 × 44 px; inline links get padding so the target is at least 24 × 24 px (2.5.8).

### 7.6 Motion (2.3.3 is AAA, but we honour reduced motion anyway)
- **No animation at all** in MVP: no spinner, no pulsing, no smooth scrolling, no transitions on state change. `prefers-reduced-motion` therefore needs no special case. If anyone adds motion later it must be wrapped in `@media (prefers-reduced-motion: no-preference)`.
- No flashing, nothing auto-scrolls.

### 7.7 Timing (2.2.1, 2.2.2)
- Auto-refresh only replaces text in place and does not move focus or scroll. It is described in "About these checks". This is an update of information, not moving or blinking content, so no pause control is needed; if the focus group or an audit disagrees, add a "Stop updating" toggle.

### 7.8 Other
- Respect `prefers-color-scheme: dark` with the dark token set (§8).
- Forced colours / Windows High Contrast: icons use `currentColor`; day marks use borders (not only backgrounds) so they stay visible.
- Print: hide the retry button and `<details>` triangles; everything else prints as text.
- Automated: axe-core with zero serious or critical violations in every state fixture: all working, one down, four down, all down, stale, never checked, partly checked, load error, loading, 20 targets, long names, markup-in-name (AC-P10, AC-SEC1).
- Manual: one pass with NVDA + Firefox and VoiceOver + Safari (iOS) on the "one down" and "stale" fixtures, reading from the top. The first thing read inside `main` must be the headline.

---

## 8. Design tokens

System font stack (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). No web fonts (faster, nothing to load from third parties).

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#ffffff` | `#121417` | page background |
| `--surface` | `#f6f7f9` | `#1c1f24` | cards |
| `--border` | `#8a9099` | `#7a818b` | card borders (≥ 3:1 on bg) |
| `--text` | `#1b1e23` | `#eef0f3` | body |
| `--text-muted` | `#4a515c` | `#c2c7cf` | secondary lines |
| `--ok` | `#116329` | `#57c27a` | Working |
| `--bad` | `#a4161a` | `#ff7b72` | Not working |
| `--unknown` | `#7a4a00` | `#e3b341` | Not checked recently |
| `--unknown-bg` | `#fff6e0` | `#2b2310` | stale panel background |
| `--none` | `#5c636e` | `#9aa1ab` | Not checked yet / not checked day outline |
| `--link` | `#0b57d0` | `#8ab4f8` | links |
| `--focus` | `#0b57d0` | `#8ab4f8` | focus ring |

Type scale: body `1.125rem`; headline `1.75rem` (phone) to `2.25rem` (≥ 600 px), weight 700, line-height 1.3; `h2` `1.375rem`; `h3` `1.25rem`; small `1rem` (nothing smaller than 16 px).

---

## 9. AC mapping

| AC | Where satisfied |
|---|---|
| P1 | §2 V1; static page, no login |
| P2 | §3.4, §4.1 to 4.7, §5.1 (`h1` first in `main`) |
| P3 | §3.2, §4, §6.1, `TimeText` |
| P4 | §6.2, §6.3 |
| P5 | §6.2 (round-down rule, SC-6) |
| P6 | §4.11 "About these checks" |
| P7 | §4.2, §6.4 |
| P8 | §6.5 (fetch at view time; shell has no data). Mechanism: architect |
| P9 | §3.3 row 2, §4.5 |
| P10 | §6.1, §6.3, §7, §8 |
| P11 | §4.11, §5.1 |
| S1 | time sentence in every headline |
| S2 | §3, §6.5 (60 s recompute with visitor's clock) |
| S3, S4 | §3.2 row 1, §3.3 row 4, §4.4 |
| S5 | §4.4 link to README `#if-checks-stop`; §11 |
| S6, A9 | §1 rules, §4.11, §10, §11 |
| A2, A4, A7, A8, S7, C6 | §10 issue templates |
| X3 | §11 |
| SEC1, SEC2 | §4.9 fixtures; §10.0 |

---

## 10. GitHub Issues

### 10.0 Rules for all issues
- Written for the owner. Plain, short, says what happened, what the monitor will do, and what (if anything) the owner should do.
- All config-derived values (`{name}`, `{url}`) go through the architect's neutralizing step (AC-SEC2). In bodies, I recommend showing names in bold and URLs inside inline code (`` `https://…` ``), which stops Markdown from turning them into links or mentions; the architect confirms how to handle backticks inside names.
- Only monitor-generated data (AC-A8): no response bodies, headers or error-page text.
- All times in full UTC: `2026-10-28 14:05 UTC`. Durations as in §3.6.
- Every issue ends with the same footer line:
  `<sub>Opened automatically by gnosh-uptime. Checks run on GitHub's free schedule, which can be late or skipped.</sub>`
- Labels: `outage`, `monitor-stale`, `config-error` (AC-A6). Label descriptions when created:
  - `outage`: "A monitored site is not working"
  - `monitor-stale`: "Checks stopped for a while"
  - `config-error`: "The monitor's config file has a problem"

### 10.1 Outage opened (AC-A2)
**Title:** `{name} is down`

**Body:**
```markdown
**{name}** is not working. It failed {N} checks in a row.

| | |
|---|---|
| Address | `{url}` |
| First failed check | {firstFailureAt} |
| What the monitor saw | {reason} |

**What happens next**
- The monitor keeps checking about every {interval}.
- When **{name}** works again, the monitor adds a comment with how long the outage lasted and closes this issue.
- The status page shows **{name}** as not working and links to this issue: {pageUrl}
- If you close this issue yourself while the site is still down, the monitor will not reopen it or open a new one until the site has recovered and gone down again.

The real outage may have started up to {interval} before the first failed check, because the monitor only sees the site when it checks.

<sub>Opened automatically by gnosh-uptime. Checks run on GitHub's free schedule, which can be late or skipped.</sub>
```

**Owner-facing reason text** (`{reason}`):

| Reason | Text |
|---|---|
| timeout | No answer within {timeout} seconds (timeout) |
| dns | The domain name could not be found (DNS error) |
| tls | The secure connection failed (TLS/certificate error) |
| connection | The connection was refused or dropped |
| http status | The site answered with HTTP {status} |
| too many redirects | More than 5 redirects |
| blocked redirect | A redirect pointed to a private or blocked address, so the monitor did not follow it |

### 10.2 Recovery comment and close (AC-A4)
**Comment:**
```markdown
**{name}** is working again.

| | |
|---|---|
| First failed check | {firstFailureAt} |
| First successful check after that | {recoveredAt} |
| Outage length | about {duration} |
| Failed checks | {failedCount} |

The outage length runs from the first failed check to the first successful one. The real outage could be up to {interval} longer or shorter, because the monitor only sees the site when it checks.

Closing this issue.

<sub>…footer…</sub>
```
Then close with reason "completed".

If a person already closed the issue (AC-A7), still post this comment on the closed issue so the record is complete, and do not reopen it. (Proposed SC-8; the architect confirms.)

### 10.3 Monitor was stale (AC-S7)
**Title:** `Monitor was stale from {gapStart} to {gapEnd}` (both full UTC, e.g. `Monitor was stale from 2026-10-28 09:10 UTC to 2026-10-28 14:05 UTC`)

**Body:**
```markdown
The monitor did not run for **{duration}**, from {gapStart} to {gapEnd}. Checks are expected about every {interval}.

**What this means**
- Nothing was checked during that time, so problems in that period may have been missed.
- During the gap, after {staleThreshold} with no checks, the status page told visitors "We haven't been able to check recently, so we don't know if it's working."
- Checks have started again. This issue was opened by the first run after the gap.

**Why this can happen**
- GitHub runs scheduled workflows when it can. At busy times runs are late or skipped.
- GitHub turns off scheduled workflows in public repos after 60 days without activity. The monitor tries to prevent this automatically, but if it fails you must turn the workflow back on.
- Someone turned off Actions or the workflow in this repo's settings.

**What to do**
- If this happens once in a while, nothing. You can close this issue.
- If it happens often, or for many hours, read [If checks stop]({readmeUrl}#if-checks-stop).

This issue does not close by itself, so you know you have seen it. Close it when you're done.

<sub>…footer…</sub>
```

### 10.4 Config error (AC-C6)
One open issue at a time. **Title:** `Config file has problems: some sites are not being checked`

**Body** (rewritten by the monitor whenever the list of problems changes):
```markdown
The monitor found **{count}** problem(s) in `{configPath}`. It is skipping the entries below. Your other **{validCount}** site(s) are still being checked.

| Entry | Problem |
|---|---|
| #{index} **{name or "(no name)"}** | {problem} |
| … | … |

**How to fix it**
1. Open [`{configPath}`]({configFileUrl}) and click the pencil icon (Edit this file).
2. Fix each entry listed above. See [Config file help]({readmeUrl}#config-file-help) for examples.
3. Click **Commit changes**. The check on your commit (in the Actions tab) shows a green tick if the file is now valid, or a red cross and the problem if not.

This issue closes itself on the next run after the config file has no problems.

<sub>…footer…</sub>
```
- Entries are identified by position (`#3`) and name, because a bad entry might have no name, a duplicate name, or a dangerous one. The bad URL itself is **not** repeated in the issue (it may be a private address or contain credentials, AC-C4).
- When the list changes, the monitor edits the body and adds a short comment: `The list of problems changed. There are now {count} problem(s). See the updated list above.` (Editing alone would not notify the owner.)

**Problem text** (`{problem}`):

| Validation failure | Text |
|---|---|
| missing name | Every site needs a `name`. |
| missing URL | Every site needs a `url`. |
| bad scheme | The address must start with `https://` or `http://`. |
| private/blocked address | The address points to a private or local network address. The monitor only checks public websites. |
| localhost / .local / .internal | The address is a local name (like `localhost`). The monitor only checks public websites. |
| userinfo | The address contains a username or password. Remove it; everything in this file is public. |
| duplicate name | Another site already uses this name. Each name must be different. |
| more than 20 | Only 20 sites are allowed. This entry is number {index}, so it is skipped. |
| interval too low | The check interval must be at least 5 minutes. (Applies to the whole file; the monitor uses 5 minutes until fixed, or as the architect decides.) |
| contact too long | The contact line must be 200 characters or fewer. |
| contact bad link | Links in the contact line must start with `https://` or `mailto:`. |
| name too long (SC-1) | Names must be 50 characters or fewer. |
| file can't be read | The file isn't valid YAML, so no sites can be read. Line {line}: {parser message}. Tip: use spaces, not tabs, and keep the indents lined up. |

**Close comment:**
```markdown
The config file has no problems now. All **{validCount}** site(s) are being checked. Closing this issue.
```
Close with reason "completed".

---

## 11. README setup steps (for the technical writer)

Written for a "use this template" user who has never written YAML. The writer owns the README; this is the required structure and the wording for the setup part. Exact file paths, Pages source and permission details are placeholders the architect fills in (`{configPath}` e.g. `monitor.yml`).

**Top of README (must appear before setup):** one paragraph on what it is, then:
- "Free on public repositories. No accounts beyond GitHub. No secrets or keys to set up. You edit one short settings file in your browser; you don't need to write code."
- "You'll usually hear about a problem about 30 to 60 minutes after it starts, sometimes later. It doesn't check constantly."
- "Your list of sites and their status are public."

### Setup (about 15 minutes) `#setup`

**Before you start:** you need a GitHub account and the web addresses of the sites you want to check. Everything below happens in your web browser.

1. **Make your own copy.**
   At the top of this page, click the green **Use this template** button, then **Create a new repository**.
   - *Owner:* your account.
   - *Repository name:* anything, for example `status`. It becomes part of your status page address.
   - Choose **Public**. (Private repositories don't get free GitHub Pages and use up paid Actions minutes.)
   - Click **Create repository**.
   - Don't use **Fork**: forks have scheduled checks turned off.

2. **Turn on the status page.**
   In your new repository, click **Settings** → **Pages** (left side). Under **Source**, choose **{GitHub Actions | Deploy from a branch: …}**. Click **Save** if shown.

3. **Check that Actions are on.**
   Click the **Actions** tab. If you see a button that says **I understand my workflows, go ahead and enable them**, click it. If you see a list of workflows, they're already on.

4. **Add your sites.**
   Open the file **`{configPath}`** and click the pencil icon (**Edit this file**). You'll see an example like this:

   ```yaml
   # The name shown at the top of your status page
   site_name: Example Co

   # Optional. Shown on the page as "Questions? ..."
   contact: Email help@example.com

   sites:
     - name: Shop
       url: https://shop.example.com

     - name: Blog
       url: https://blog.example.com
   ```

   Change the example to your own sites:
   - Replace `Example Co` with your name or your business's name.
   - For each site, change the text after `name:` (what visitors see) and after `url:` (the full address, starting with `https://`).
   - To add a site, copy a `- name:` line and the `url:` line under it, and paste them below the last site.
   - To remove a site, delete both of its lines.
   - Don't want a contact line? Delete the `contact:` line.

   **Five rules that avoid most mistakes:**
   1. Keep the spaces at the start of each line exactly as in the example. Use the space bar, never the Tab key.
   2. `- name:` lines start with 2 spaces. The `url:` line under them starts with 4 spaces, so `url` lines up with `name`.
   3. Always put one space after the colon: `name: Shop`, not `name:Shop`.
   4. If a name contains a colon `:` or a hash `#`, put it in double quotes: `name: "Shop: UK"`.
   5. Lines starting with `#` are notes for you. The monitor ignores them.

   Then click **Commit changes…**, keep **Commit directly to the main branch**, and click **Commit changes** again.

5. **Check that the file is OK.**
   Click the **Actions** tab. Within a minute you'll see a run for your change.
   - Green tick: the file is fine. Go to step 6.
   - Red cross: click the run. The summary says which site has a problem and why, for example "Shop: the address must start with https:// or http://". Fix it as in step 4.

6. **Run the first check now** (instead of waiting up to 15 minutes).
   In the **Actions** tab, click **{Monitor workflow name}** on the left, then **Run workflow** → **Run workflow**. Wait for the green tick (usually 1 to 2 minutes).

7. **Open your status page.**
   Go to **Settings** → **Pages**. Your address is shown at the top, for example `https://your-name.github.io/status/`. Open it. It should say "Everything is working" or name the site that isn't. If it says "We can't load the status right now", wait 5 minutes and reload, then see [Troubleshooting](#troubleshooting).

8. **Make sure you get alerts.**
   Problems are reported as **Issues** in your repository, and GitHub notifies you about them.
   - At the top of your repository, click **Watch** → **Custom** → tick **Issues** → **Apply**.
   - In your GitHub **Settings** → **Notifications**, check that "Watching" notifications go to your email, or to the GitHub mobile app.

9. **Share the page.** Put the status page link somewhere your visitors will find it when your site is down, for example your social media profile, email signature, or a printed sign. (Not only on the site being checked.)

### Further README sections the design depends on
- `#what-to-expect`: checks about every 15 minutes, can be late; alerts usually 30 to 60 minutes after a problem starts; short problems between checks can be missed; sites that block cloud or bot traffic may show as not working.
- `#if-checks-stop` (linked from the page and from the stale issue, AC-S5): how to tell (a "Monitor was stale" issue, or the page says "We haven't been able to check recently"); how to turn the workflow back on (**Actions** → workflow name → **Enable workflow**); then **Run workflow** once.
- `#config-file-help`: every setting with a one-line meaning and default (interval, failures before alert, timeout, staleness threshold), and the problem texts from §10.4 with the fix for each.
- `#troubleshooting`: page says it can't load; no issues arriving; site shows "not working" but works for you.
- `#permissions`: the token permissions each workflow uses and why (AC-X2).
- How this differs from Upptime (AC-X4), per spec wording.

---

## 12. Assumptions

1. Config format is YAML at the repo root. If the architect chooses something else, §11 step 4 changes but the "rules" approach stays.
2. Contact line, `siteName`, interval and threshold reach the page through the fetched data (the shell deploys rarely, so it can't carry config).
3. The data includes the outage issue number and outage start time per target (AC-D2 b), so the page can link and show "since".
4. A target added within the last 90 days has its first-check day known (from the first day record), so history starts there.
5. Visitors who need local time can use the relative time; UTC stays as the absolute time (AC-P3). Showing local time is a focus-group question, not an MVP change.
6. Cards keep config order rather than sorting problems first; the headline and problem list cover discoverability.
7. No HTML mockup in this round; the ASCII wireframes and tokens are enough to build from. I'll produce `docs/design/uptime-monitor/mockup.html` if the focus group needs something to look at.

## 13. Proposed spec changes

| # | Change | Why |
|---|---|---|
| SC-1 | Add AC-C13: target names are at most 50 characters; longer is a config error under AC-C6. | Keeps the headline, issue titles and cards readable at 200% zoom. Wrapping still handles 50 characters with no spaces. |
| SC-2 | AC-C12: make the contact line two fields, `contact` (text) and optional `contact_link` (`https:` or `mailto:`), instead of "if it contains a link". | Avoids parsing links out of free text (a security and testability problem) and gives the link clear text. |
| SC-3 | AC-S3: also apply the stale wording to a single target whose own last check is older than the threshold, even if the run is recent. | Otherwise a skipped target keeps saying "Working" from an old check. |
| SC-4 | AC-P10: say WCAG 2.2 AA (not 2.1) and reflow at 320 CSS px (not 360). | 2.2 is current and includes 2.1; 320 px is what WCAG 1.4.10 tests. |
| SC-5 | AC-P2: allow the time sentence as "We last checked 7 minutes ago, at 14:05 UTC." (relative first). | Relative time is what a non-technical visitor uses. Same meaning. |
| SC-6 | AC-P5: round down to one decimal so 100.0% means no failed checks. | "100.0%" with failures looks like a lie. The 95/100 test still gives 95.0%. |
| SC-7 | AC-P9 / AC-P11: say whether the contact line must show when data fails to load. Recommended: yes if the architect can serve it separately cheaply; otherwise no. | That is exactly when a visitor most needs a contact. |
| SC-8 | AC-A7: after a person closes an outage issue early, post the recovery comment on the closed issue when the site recovers (don't reopen). | Keeps the incident record complete without fighting the owner. |
| SC-9 | AC-P3: add a fourth target state, "Not checked yet", for a newly added target. | The spec's three states don't cover it; showing "Working" or the stale sentence would both be wrong. |
| SC-10 | AC-P8 / S2: the open page recomputes every 60 s and refetches every 5 minutes. | A visitor who leaves the tab open must see the stale state appear, and see recovery. |
| SC-11 | AC-C6: an unreadable (unparseable) config file is a config-error with zero valid targets; say what the page shows (recommended: keep the last published data, which goes stale honestly). | Otherwise a YAML typo is undefined behaviour. |

## 14. Recommend
- **Focus Group** on the visitor copy (§4) and the stale state: Rosa plus 3 to 4 other non-technical visitor personas, with one devil's advocate. Questions: do they understand "We haven't been able to check recently, so we don't know if it's working"? Is UTC confusing enough to add local time? Do they notice and understand the outage report link? Is the 90-day strip noise?
- **Focus Group** with Jamal and Priya on §11 setup and the §10 issue text: can Jamal get through step 4 without help?
- Real hallway test with 5 people once there are real users (needs Brian, as noted in the research).
