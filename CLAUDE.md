# gnosh-uptime

**Before any work here, read the gnoshcodes team playbook:**
[`gn0sh/gnoshcodes` CLAUDE.md](https://github.com/gn0sh/gnoshcodes/blob/main/CLAUDE.md). If that repo is cloned
next to this one, read `../gnoshcodes/CLAUDE.md`. The agents and skills it names live in `gnoshcodes/.claude/`.
It is the one current copy. Don't copy it here, because copies drift.

## Hard stops (always ask Brian first, even if you can't reach the playbook)
1. Deploying to production or any environment real users touch, including enabling a locked deploy job.
2. Deleting or irreversibly changing data, databases, infrastructure, or git history on shared branches.
3. Spending money.
4. Acting outside the repo on Brian's behalf (emails, public posts, messages, accounts, publishing).
5. Handling real secrets or credentials the team doesn't already have.

Reviews and panels follow the playbook's anti-groupthink protocol: each member answers independently, and each must name the most serious problem they found.

## This repo
An internal uptime monitor for the team's deployed sites. Add each new site to `monitor.config.json`. Outage issues
opened here are the team's on-call signal. Team-wide metrics, tool radar and improvement backlog live in
`gnoshcodes/docs/improvements/`.
