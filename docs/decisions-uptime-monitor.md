# Manager decisions: uptime-monitor

Decisions recorded 2026-10-28 by the Engineering Manager.

- **Config format is JSON, not YAML.** This matches the architect's ADR 0001 and keeps runtime dependencies at zero. The UX README steps change from "YAML rules" to JSON rules, and the validate CLI must give a plain-language error with the line number for common JSON mistakes (trailing comma, missing quote).
- **UX spec changes SC-1 to SC-11 are accepted** as the designer recommended. SC-7: show the contact line even when data fails to load; it is baked into the page at build time. SC-11: if the config can't be parsed, open a config-error issue, keep the last data, and let the page go stale honestly.
- **E1 keepalive:** ship the enable-API keepalive. Pre-approved fallback: if dogfooding shows the workflow got disabled anyway, AC-D1 is relaxed to allow one marked `[keepalive]` bot commit a month on the default branch.
- **The extra Focus Group rounds the UX designer recommended** run on the working staging page, not on the design doc. A real page is a better stimulus.
- **Branches:** the repo's default branch is currently `claude/project-thread-0jnua7`, because it was the first push to an empty repo. Pages deploys from the default branch. Creating `main` and switching the default needs the owner, since a direct push to `main` was blocked.
- **Owner actions (hard stop 1):** set the `github-pages` environment reviewer, and approve the first production deploy.
- **2026-10-29: internal tool only.** Brian won't use the monitor himself; it's the agent team's tool. Consequences: no public Pages deploy (the deploy stays locked because `GU_DEPLOY_APPROVAL_CONFIGURED` is unset), and the owner setup checklist is not required. The team reads status from outage issues and the `monitor-data` branch. Targets are the team's live sites. Every newly shipped site gets added to `monitor.config.json` at release. Rulesets (threat model F6) stay recommended but unapplied: only Brian and the agents have push access.
