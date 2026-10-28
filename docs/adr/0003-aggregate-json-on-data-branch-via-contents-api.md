# ADR-0003: One aggregate status.json on an orphan data branch, written through the Contents API

- Status: Accepted (2026-10-28). Feature: uptime-monitor. ACs: D1 to D5, US9
- Expensive to reverse? Moderately. The format is versioned (`"v": 1`), so a migration is a code change and doesn't rewrite history.

## Decision
- Branch `monitor-data` is an orphan branch, created by the first run through the Git Data API with a parentless commit.
- One minified file, `status.json`: header, plus per-target state, plus `days: [[date, checks, ok], ...]` for at most 90 UTC days. The schema is in the architecture doc, §7.
- The run reads the file and its blob `sha` with the **authenticated** Contents API (always fresh, unlike the CDN). It writes with `PUT /contents` plus that `sha`, so every run is exactly one commit. A stale `sha` fails the write, and the previous data stays valid.
- Bound: at most 79,104 bytes in the worst case (20 targets × (90 × 32 B + 1,024 B) + 1,024 B). The writer refuses anything over 256 KB.

## Alternatives considered
- **`git` checkout of the data branch and `git push`:** needs persisted credentials in `.git/config` during the run, has more moving parts, and bootstrapping orphan branches is fiddly. Its only advantage is batching several files, which we don't need.
- **One file per target:** more blobs per commit (more history growth), and the page would make up to 20 requests (more rate-limit exposure). Cross-file reads could also be inconsistent.
- **Split `live.json` (every run) from `history.json` (daily):** smaller per-run blobs, but reads of the two files could mix, which would double-count or drop today's figures around midnight. Not worth it at about 80 KB.
- **Raw per-check records:** rejected by the Brain Trust (Budget Hawk) and the spec (AC-D2).
- **Issues, gists or the Actions cache as the store:** not readable as a plain public file, or not durable.

## Consequences
- History grows by one commit per run, about 35,000 a year. Server-side delta packing should keep it to tens of MB a year. This is measured in T14 (R3). Reset is a Later item that needs owner approval.
- A single file makes the page's view atomic for free (D5).
