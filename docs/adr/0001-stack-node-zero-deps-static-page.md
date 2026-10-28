# ADR-0001: Node 24 LTS, zero runtime dependencies, JSON config, plain static page

- Status: Accepted (2026-10-28). Feature: uptime-monitor

## Context
The repo has no code yet. The monitor job holds a `GITHUB_TOKEN` with `contents: write` and `issues: write`, so anything it loads can act on the repo. The MVP should be a few hundred lines and must cost $0 with no external services.

## Decision
- Node.js 24 LTS, ES modules, **no runtime npm dependencies**. Use built-ins: `fetch`, `node:https`, `node:dns`, `net.BlockList`, `node:test`, `node:crypto`.
- Config is **JSON** (`monitor.config.json`), so no YAML parser is needed.
- The page is plain HTML, CSS and an ES-module JS file. There is no framework and no bundler. One tiny build script copies `site/` and injects the data URL.
- Dev-only: `@axe-core/cli` runs via `npx` at a pinned version in the validate job (read-only token) for AC-P10.

## Alternatives considered
- **Python 3 (stdlib):** equally zero-dep. Its `urllib` has no clean hook for pinning the connect address per hop, while `http.client` subclassing works but is clunkier. The page is JS anyway, so one language is simpler.
- **TypeScript plus a bundler or a framework (React, Svelte):** adds a build, dependencies and lockfile churn, with no benefit for one page.
- **YAML config:** friendlier for P1, but it needs `js-yaml` (a dependency in the write-token job) or a hand-rolled parser (a correctness and security risk). Can be revisited later.
- **Upptime's stack:** heavier, built on many dependencies (the spec explicitly builds our own).

## Consequences
- Supply-chain surface in the privileged job is only Node itself plus GitHub's first-party actions, pinned by SHA.
- JSON editing errors are likely for P1. Mitigation: line and column in the error message, plus an example in the README.
- Node 26 becomes LTS around now. Moving to it later is a one-line change in the workflows.
