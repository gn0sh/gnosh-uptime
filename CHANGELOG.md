# Changelog

All notable changes to this project are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Planned as version 0.1.0, the first version.

### Changed
- Gaps in checking of up to 8 hours, which GitHub's free schedule causes often, no longer open a new `monitor-stale` issue each time. They go in one rolling **Late scheduled runs (rolling log)** issue that is edited in place and sends no notifications. Only gaps over 8 hours open a **Monitor was stale** issue. Outage issues are unchanged.

### Added
- Scheduled checks of up to 20 public websites, about every 15 minutes, on GitHub Actions. The interval is set by the cron line in `.github/workflows/monitor.yml` (5 minutes or more).
- Settings in `monitor.config.json` (JSON): `siteName`, `contact`, `contactLink`, `failuresBeforeAlert`, `timeoutSeconds`, `staleAfterMinutes` and `targets`. Note keys that start with `//` are ignored.
- Plain-language config errors with line numbers, on every push and pull request (the `validate` workflow) and as one `config-error` issue on scheduled runs. Bad entries are skipped; the rest are still checked.
- GitHub Issues for outages (`outage`, closed with a recovery comment), for gaps in checking (`monitor-stale`), and for config problems (`config-error`). Issues are locked, and names can't add links or mentions.
- A plain-language, accessible status page on GitHub Pages, with a 90-day history. It shows a separate state when checks have stopped, and never shows old results as current.
- Only daily totals and current state are stored, on a separate `monitor-data` branch.
- A keepalive step against GitHub's 60-day schedule disable. It isn't yet confirmed that this resets the 60-day count.
- Safety checks on every address: private, local and blocked addresses, usernames and passwords, and key-like query parameters are refused. Redirects are checked hop by hop.
- Only `GITHUB_TOKEN` is used, with per-job permissions. Page changes deploy only when the repository variable `GU_DEPLOY_APPROVAL_CONFIGURED` is `true`, and through the `github-pages` environment with the owner as required reviewer.

### Removed

- The public status page deploy (`pages.yml`) and the accessibility CI job. This is an internal tool for the agent team; results arrive as GitHub Issues. The page code in `site/` stays unpublished.
