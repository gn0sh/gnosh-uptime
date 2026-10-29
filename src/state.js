// Pure state machine: streaks, outages, day aggregates, retention, removed
// targets and stale-gap detection. Architecture §7 and §8.1.
// No I/O. New records are built from known fields only (threat model F5).

import { createHash } from 'node:crypto';

export const HISTORY_DAYS = 90;
const DAY_MS = 86400000;

/** ISO-8601 UTC without milliseconds: 2026-10-28T14:05:12Z */
export function isoSeconds(date) {
  return new Date(date).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function utcDay(date) {
  return new Date(date).toISOString().slice(0, 10);
}

/** Stable id for a target name, safe inside an HTML comment marker. */
export function targetId(name) {
  return createHash('sha256').update(String(name), 'utf8').digest('hex').slice(0, 12);
}

function freshRecord(name, url) {
  return {
    name,
    url,
    state: 'unknown',
    lastCheckedAt: null,
    lastFailureReason: null,
    failStreak: 0,
    outageStartedAt: null,
    issue: null,
    suppressed: false,
    days: [],
  };
}

/** Copies only the known fields of a stored record. */
function copyRecord(prev, name, url) {
  return {
    name,
    url,
    state: prev.state,
    lastCheckedAt: prev.lastCheckedAt,
    lastFailureReason: prev.lastFailureReason,
    failStreak: prev.failStreak,
    outageStartedAt: prev.outageStartedAt,
    issue: prev.issue,
    suppressed: prev.suppressed,
    days: prev.days.map(([d, c, o]) => [d, c, o]),
  };
}

/**
 * @param {object|null} prev  validated stored data, or null
 * @param {Array<{name:string, url:string, up:boolean, reason:string|null, checkedAt:string}>} results
 *   one per valid target, in config order
 * @param {{settings:object, configErrorCount:number, repo:string,
 *   openIssueNumbers?: Set<number>|null}} ctx  openIssueNumbers: the bot's open
 *   outage issues; null when unknown (then no human close is inferred)
 * @param {Date} now
 * @returns {{data:object, actions:Array<object>}}
 */
export function applyRun(prev, results, ctx, now) {
  const { settings, configErrorCount = 0, repo, openIssueNumbers = null } = ctx;
  const n = settings.failuresBeforeAlert;
  const prevByName = new Map((prev?.targets ?? []).map((t) => [t.name, t]));
  const today = utcDay(now);
  const oldest = utcDay(new Date(now).getTime() - (HISTORY_DAYS - 1) * DAY_MS);
  const actions = [];
  const targets = [];

  for (const r of results) {
    const p = prevByName.get(r.name);
    const rec = p ? copyRecord(p, r.name, r.url) : freshRecord(r.name, r.url);
    const index = targets.length;

    // History: keep the 90-day window and add this check to today.
    rec.days = rec.days.filter(([d]) => d >= oldest && d <= today);
    const last = rec.days[rec.days.length - 1];
    if (last && last[0] === today) {
      last[1] += 1;
      if (r.up) last[2] += 1;
    } else {
      rec.days.push([today, 1, r.up ? 1 : 0]);
    }
    rec.lastCheckedAt = r.checkedAt;

    // A7: our open issue is gone from the open list, so a person closed it.
    // Keep the number (SC-8: the recovery comment still goes on it).
    if (rec.issue !== null && !rec.suppressed && openIssueNumbers !== null && !openIssueNumbers.has(rec.issue)) {
      rec.suppressed = true;
    }

    if (r.up) {
      if (rec.issue !== null) {
        actions.push({
          type: 'recover',
          index,
          name: rec.name,
          issue: rec.issue,
          closedByPerson: rec.suppressed,
          outageStartedAt: rec.outageStartedAt,
          recoveredAt: r.checkedAt,
          failedCount: rec.failStreak,
        });
      }
      rec.state = 'up';
      rec.failStreak = 0;
      rec.outageStartedAt = null;
      rec.lastFailureReason = null;
      rec.issue = null;
      rec.suppressed = false;
    } else {
      rec.state = 'down';
      rec.failStreak += 1;
      rec.outageStartedAt ??= r.checkedAt;
      rec.lastFailureReason = r.reason;
      if (rec.failStreak >= n && rec.issue === null && !rec.suppressed) {
        actions.push({
          type: 'open',
          index,
          name: rec.name,
          url: rec.url,
          reason: r.reason,
          outageStartedAt: rec.outageStartedAt,
          failedCount: rec.failStreak,
        });
      }
    }
    targets.push(rec);
  }

  // D4: targets no longer in the valid config are dropped now.
  const kept = new Set(results.map((r) => r.name));
  for (const p of prev?.targets ?? []) {
    if (!kept.has(p.name) && p.issue !== null) {
      actions.push({ type: 'close-removed', name: p.name, issue: p.issue });
    }
  }

  const data = {
    v: 1,
    repo,
    siteName: settings.siteName ?? null,
    lastRunAt: isoSeconds(now),
    intervalMinutes: settings.intervalMinutes,
    staleAfterMinutes: settings.staleAfterMinutes,
    failuresBeforeAlert: settings.failuresBeforeAlert,
    contact: settings.contact ?? null,
    contactLink: settings.contactLink ?? null,
    configErrorCount,
    targets,
  };
  return { data, actions };
}

/**
 * S7: a gap longer than the staleness threshold since the last completed run.
 * Both times are re-serialized by the run (never a stored string, F5).
 * @returns {{from:string, to:string, minutes:number}|null}
 */
export function detectGap(prevLastRunAt, now, staleAfterMinutes) {
  if (prevLastRunAt === null || prevLastRunAt === undefined) return null;
  const from = Date.parse(prevLastRunAt);
  const to = new Date(now).getTime();
  if (!Number.isFinite(from)) return null;
  if (to - from <= staleAfterMinutes * 60000) return null;
  return { from: isoSeconds(from), to: isoSeconds(to), minutes: Math.round((to - from) / 60000) };
}
