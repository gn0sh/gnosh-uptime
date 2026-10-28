# Focus Group: uptime-monitor concept

Date: 2026-10-28. **These are simulated personas, not real users. Treat every finding as a hypothesis.** Each persona answered alone, on a neutral concept statement.

## Panel
| Persona | Profile | Would use? |
|---|---|---|
| Priya | Frontend dev, 3 hobby sites, uses UptimeRobot free | Probably (not for her important site) |
| Dale (devil's advocate) | Bakery owner, no GitHub account | **No** |
| Marco | OSS/SaaS founder, already uses Upptime | Probably not |
| Rosa | Retired teacher, status-page visitor, large text and screen reader | Probably (only if someone sends her the link) |
| Jamal | CS student, first Pages site, no monitoring | Probably (mainly to learn) |

## Top themes
1. **"The monitor needs monitoring" (4/5).** "A 'Monitor stale' banner on a page I never visit doesn't help" (Priya). Jamal and Marco said the same. Everyone with a site asked who tells them when checks stop.
2. **Alerts through GitHub Issues get lost (3/5).** "Issue alerts get lost in Dependabot noise" (Priya). Dale asked "What's an Issue?" Priya and Marco want Discord/Slack webhooks.
3. **Detection is slow (3/5).** Two failures at a 15-minute interval means 15–30+ minutes before anyone hears, and the README needs to give real numbers.
4. **Why this instead of Upptime? (2/5).** "The README has to answer that in the first paragraph" (Marco).
5. **The visitor page speaks robot (Rosa).** "'Monitor stale' means nothing to me. Stale like bread?" She wants one big plain sentence that a screen reader reads out, status that isn't shown by color alone, and a way to contact the owner.

## Confusion points and missing features, ranked
1. Silent death after 60 days, and no proactive warning (4)
2. Where alerts actually arrive (3)
3. Real latency numbers (3)
4. Whether it uses Actions minutes, and whether YAML or secrets are needed (2)
5. Content/keyword checks, response times, incident write-ups (2)
6. Accessibility and plain language on the public page (1, but she is the only visitor persona)

## Surprises and disagreements
- Dale shows the product is useless to anyone who doesn't use GitHub. That is a deliberate non-goal, and the README should say so.
- Rosa doesn't care about the uptime percentages the spec spends effort on. What she needs is "is it broken, is anyone on it, when do I come back?"

## Recommended changes
| Change | Owner |
|---|---|
| Staleness and the upcoming 60-day disable notify the owner (issue), with a keepalive | PM → architect |
| Plain-language, screen-reader-first headline; no color-only status; works at 200% zoom; optional contact line | PM → UX |
| README: real latency numbers, "free on public repos, no YAML editing, no secrets", how it differs from Upptime | Writer |
| Webhooks, keyword checks, incident notes | Later |

## Hypotheses to check with real users
- GitHub issue notifications reach owners fast enough. Measure outage-to-email time during the dogfood.
- Visitors understand the plain-language states. Run a 5-person hallway test when there are real users. That needs Brian, because it means contacting people.
