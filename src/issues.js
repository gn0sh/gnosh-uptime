// GitHub Issues: labels, outage / config-error / stale issue sync, and text
// neutralization. Architecture §8.1 to §8.3, design §10, threat model F1, F4,
// F5, F9, F14. Every body is built only from monitor-generated strings and
// neutralized config values (AC-A8).

import { createHash } from 'node:crypto';
import { targetId } from './state.js';
import { ownerReasonText } from './reasons.js';
import { CONFIG_PATH } from './config.js';

export const BOT_LOGIN = 'github-actions[bot]';
export const LABELS = [
  { name: 'outage', color: 'd73a4a', description: 'A monitored site is not working' },
  { name: 'monitor-stale', color: 'fbca04', description: 'Checks stopped for a while' },
  { name: 'config-error', color: 'e99695', description: "The monitor's config file has a problem" },
];
export const FOOTER = "<sub>Opened automatically by gnosh-uptime. Checks run on GitHub's free schedule, which can be late or skipped.</sub>";
const ZWSP = '​';
const CTL_G = /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu;

const clean = (s) => String(s ?? '').replace(CTL_G, ' ').replace(/\s+/g, ' ').trim();

/**
 * Markdown-inert text by backslash escapes (architecture §8.3, extended with
 * `&` and `/` per threat model F4). Used for monitor text that may quote
 * config fragments, such as problem descriptions in a table cell.
 */
export function inert(s) {
  return clean(s)
    .replace(/[\\`*_{}[\]()<>#+\-.!|~&/]/g, (c) => `\\${c}`)
    .replace(/@/g, `@${ZWSP}`)
    .replace(/#/g, `#${ZWSP}`)
    .replace(/www/gi, (w) => `${w}${ZWSP}`);
}

/**
 * A config value as an inline code span (threat model F4): no entities,
 * autolinks, mentions or references are processed inside code spans.
 * The fence is one backtick longer than the longest run in the value.
 */
export function code(s) {
  const v = clean(s);
  if (v === '') return '(empty)';
  const longest = Math.max(0, ...(v.match(/`+/g) ?? []).map((r) => r.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence} ${v} ${fence}`;
}

/** Issue titles render little Markdown: a light transform, no backslashes (F9). */
export function inertTitle(s) {
  return clean(s).replace(/@/g, `@${ZWSP}`).replace(/#/g, `#${ZWSP}`).replace(/:\/\//g, `:${ZWSP}//`);
}

/** "2026-10-28 14:05 UTC" */
export function fmtTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'an unknown time';
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

/** Durations as in design §3.6: "5 minutes", "1 hour 15 minutes", "2 days 3 hours". */
export function fmtDuration(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (totalMin < 60) return plural(Math.max(totalMin, 1), 'minute');
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (totalMin > 2 * 1440) return hours ? `${plural(days, 'day')} ${plural(hours, 'hour')}` : plural(days, 'day');
  const h = Math.floor(totalMin / 60);
  return mins ? `${plural(h, 'hour')} ${plural(mins, 'minute')}` : plural(h, 'hour');
}

const outageMarker = (name) => `<!-- gnosh-uptime:outage:${targetId(name)} -->`;
const OUTAGE_MARKER_RE = /<!-- gnosh-uptime:outage:([0-9a-f]{12}) -->/;

export function isBotIssue(issue, botLogin = BOT_LOGIN) {
  return Boolean(issue && issue.user && issue.user.login === botLogin && issue.user.type === 'Bot' && !('pull_request' in issue));
}

function hasLabel(issue, name) {
  return Array.isArray(issue?.labels) && issue.labels.some((l) => (typeof l === 'string' ? l : l?.name) === name);
}

const readme = (repo, anchor) => `https://github.com/${repo}#${anchor}`;

/** A6: create the three labels only when missing. */
export async function ensureLabels(gh) {
  const res = await gh('GET', `/repos/${gh.repo}/labels?per_page=100`);
  const have = new Set((Array.isArray(res.json) ? res.json : []).map((l) => l.name));
  const created = [];
  for (const label of LABELS) {
    if (!have.has(label.name)) {
      await gh('POST', `/repos/${gh.repo}/labels`, label, { allow: [422] });
      created.push(label.name);
    }
  }
  return created;
}

/** Open issues with a label, authored by the bot (F14), pull requests excluded. */
export async function listBotIssues(gh, label, { state = 'open', since = null, botLogin = BOT_LOGIN } = {}) {
  const qs = new URLSearchParams({ labels: label, state, per_page: '100' });
  if (since) qs.set('since', since);
  const res = await gh('GET', `/repos/${gh.repo}/issues?${qs}`);
  return (Array.isArray(res.json) ? res.json : []).filter((i) => isBotIssue(i, botLogin) && hasLabel(i, label) && Number.isSafeInteger(i.number) && i.number > 0);
}

/** F1: lock a bot issue so only collaborators can comment. Failure is a warning. */
async function lock(gh, n, warn) {
  try {
    await gh('PUT', `/repos/${gh.repo}/issues/${n}/lock`, { lock_reason: 'resolved' });
  } catch (e) {
    warn(`Could not lock issue #${n} (HTTP ${e?.status ?? 'error'}). People without access to the repo may be able to comment on it.`);
  }
}

async function create(gh, title, body, label, warn) {
  const res = await gh('POST', `/repos/${gh.repo}/issues`, { title, body, labels: [label] });
  const n = res.json?.number;
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('GitHub returned an issue without a number');
  await lock(gh, n, warn);
  return n;
}

async function comment(gh, n, body) {
  await gh('POST', `/repos/${gh.repo}/issues/${n}/comments`, { body });
}

async function close(gh, n, reason = 'completed') {
  await gh('PATCH', `/repos/${gh.repo}/issues/${n}`, { state: 'closed', state_reason: reason });
}

// ---------- Outage issues (§8.1, design §10.1, §10.2)

export function outageTitle(name) {
  return `${inertTitle(name)} is down`;
}

export function outageBody({ name, url, reason, outageStartedAt, failedCount }, settings) {
  const every = fmtDuration(settings.intervalMinutes * 60000);
  const timeoutSeconds = Math.round(settings.timeoutMs / 1000);
  const n = code(name);
  return [
    `**${n}** is not working. It failed ${failedCount} checks in a row.`,
    '',
    '| | |',
    '|---|---|',
    `| Address | ${code(url)} |`,
    `| First failed check | ${fmtTime(outageStartedAt)} |`,
    `| What the monitor saw | ${ownerReasonText(reason, timeoutSeconds)} |`,
    '',
    '**What happens next**',
    `- The monitor keeps checking about every ${every}.`,
    `- When **${n}** works again, the monitor adds a comment with how long the outage lasted and closes this issue.`,
    `- The status page shows **${n}** as not working and links to this issue.`,
    '- If you close this issue yourself while the site is still down, the monitor will not reopen it or open a new one until the site has recovered and gone down again.',
    '- Only people with access to this repository can comment here. Updates come from the site owner.',
    '',
    `The real outage may have started up to ${every} before the first failed check, because the monitor only sees the site when it checks.`,
    '',
    FOOTER,
    outageMarker(name),
  ].join('\n');
}

export function recoveryComment({ name, outageStartedAt, recoveredAt, failedCount }, settings, { closing = true } = {}) {
  const every = fmtDuration(settings.intervalMinutes * 60000);
  const lines = [
    `**${code(name)}** is working again.`,
    '',
    '| | |',
    '|---|---|',
    `| First failed check | ${fmtTime(outageStartedAt)} |`,
    `| First successful check after that | ${fmtTime(recoveredAt)} |`,
    `| Outage length | about ${fmtDuration(Date.parse(recoveredAt) - Date.parse(outageStartedAt))} |`,
    `| Failed checks | ${failedCount} |`,
    '',
    `The outage length runs from the first failed check to the first successful one. The real outage could be up to ${every} longer or shorter, because the monitor only sees the site when it checks.`,
    '',
  ];
  if (closing) lines.push('Closing this issue.', '');
  lines.push(FOOTER);
  return lines.join('\n');
}

/**
 * Performs the outage actions from applyRun and reconciles the bot's open
 * outage issues with the data. Mutates data.targets[].issue.
 * @param openIssues the bot's open `outage` issues, listed once this run
 */
export async function syncOutages(gh, { actions, data, openIssues, settings, warn = () => {}, botLogin = BOT_LOGIN }) {
  const openByNumber = new Map(openIssues.map((i) => [i.number, i]));
  const openById = new Map();
  for (const i of openIssues) {
    const m = OUTAGE_MARKER_RE.exec(String(i.body ?? ''));
    if (m && !openById.has(m[1])) openById.set(m[1], i);
  }
  const handled = new Set();
  const done = { opened: [], adopted: [], recovered: [], closed: [] };

  for (const a of actions) {
    if (a.type === 'open') {
      const existing = openById.get(targetId(a.name));
      let n;
      if (existing) {
        n = existing.number;
        if (!existing.locked) await lock(gh, n, warn);
        done.adopted.push(n);
      } else {
        n = await create(gh, outageTitle(a.name), outageBody(a, settings), 'outage', warn);
        done.opened.push(n);
      }
      data.targets[a.index].issue = n;
      handled.add(n);
    } else if (a.type === 'recover') {
      handled.add(a.issue);
      if (!a.closedByPerson) {
        if (!openByNumber.has(a.issue)) {
          warn(`Issue #${a.issue} is not an open outage issue opened by the monitor, so it was left alone.`);
          continue;
        }
        await comment(gh, a.issue, recoveryComment(a, settings));
        await close(gh, a.issue);
        done.recovered.push(a.issue);
      } else {
        // SC-8: comment on the issue a person closed, without reopening it.
        // F5: only when it really is our outage issue for this target.
        const res = await gh('GET', `/repos/${gh.repo}/issues/${a.issue}`, undefined, { allow: [404, 410] });
        const i = res.json;
        // Author and marker identify it; the label may have been removed (review F5).
        if (res.status === 200 && isBotIssue(i, botLogin) && String(i.body ?? '').includes(outageMarker(a.name))) {
          await comment(gh, a.issue, recoveryComment(a, settings, { closing: i.state === 'open' }));
          if (i.state === 'open') await close(gh, a.issue);
          done.recovered.push(a.issue);
        } else {
          warn(`Issue #${a.issue} could not be confirmed as this site's outage issue, so no recovery comment was added.`);
        }
      }
    } else if (a.type === 'close-removed') {
      handled.add(a.issue);
      if (openByNumber.has(a.issue)) {
        await comment(gh, a.issue, `No longer monitored: this site was removed from \`${CONFIG_PATH}\` or has a problem there. Closing this issue.\n\n${FOOTER}`);
        await close(gh, a.issue, 'not_planned');
        done.closed.push(a.issue);
      }
    }
  }

  // Reconcile open bot issues the data doesn't know about (for example after
  // the data was lost or a run died after opening an issue). One open issue
  // per target: extra ones are closed as duplicates (review F4).
  const targetsById = new Map(data.targets.map((t, k) => [targetId(t.name), k]));
  const groups = new Map();
  for (const i of [...openIssues].sort((a, b) => a.number - b.number)) {
    const m = OUTAGE_MARKER_RE.exec(String(i.body ?? ''));
    const key = m ? m[1] : `none:${i.number}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  for (const [key, list] of groups) {
    const k = targetsById.get(key);
    const unhandled = list.filter((i) => !handled.has(i.number));
    if (k === undefined) {
      for (const i of unhandled) {
        if (data.targets.some((t) => t.issue === i.number)) continue;
        await comment(gh, i.number, `No longer monitored: this site is not in \`${CONFIG_PATH}\` any more. Closing this issue.\n\n${FOOTER}`);
        await close(gh, i.number, 'not_planned');
        done.closed.push(i.number);
      }
      continue;
    }
    const t = data.targets[k];
    let keep = t.issue;
    if (keep === null && t.state === 'down' && unhandled.length > 0) {
      keep = unhandled[0].number;
      t.issue = keep;
      t.suppressed = false;
      if (!unhandled[0].locked) await lock(gh, keep, warn);
      done.adopted.push(keep);
    }
    for (const i of unhandled) {
      if (i.number === keep) continue;
      if (keep !== null) {
        await comment(gh, i.number, `This is a duplicate of #${keep}, which tracks the same outage. Closing this one.\n\n${FOOTER}`);
        await close(gh, i.number, 'not_planned');
        done.closed.push(i.number);
      } else {
        await comment(gh, i.number, `**${code(t.name)}** is working again. Closing this issue.\n\n${FOOTER}`);
        await close(gh, i.number);
        done.recovered.push(i.number);
      }
    }
  }
  return done;
}

// ---------- Config-error issue (§8.2, design §10.4)

export const CONFIG_ERROR_TITLE = 'Config file has problems: some sites are not being checked';

function errorRow(e) {
  let entry;
  if (Number.isInteger(e.index)) entry = `Site ${e.index} ${e.name ? `**${code(e.name)}**` : '(no name)'}`;
  else entry = code(e.entry);
  if (Number.isInteger(e.line)) entry += ` (line ${e.line})`;
  return `| ${entry} | ${inert(e.reason)} |`;
}

export function configErrorBody(errors, validCount, repo) {
  const rows = errors.map(errorRow);
  const content = [
    `The monitor found **${errors.length}** problem(s) in \`${CONFIG_PATH}\`. It is skipping the entries below. Your other **${validCount}** site(s) are still being checked.`,
    '',
    '| Entry | Problem |',
    '|---|---|',
    ...rows,
    '',
    '**How to fix it**',
    `1. Open [\`${CONFIG_PATH}\`](https://github.com/${repo}/blob/HEAD/${CONFIG_PATH}) and click the pencil icon (Edit this file).`,
    `2. Fix each entry listed above. See [Config file help](${readme(repo, 'config-file-help')}) for examples.`,
    '3. Click **Commit changes**. The check on your commit (in the Actions tab) shows a green tick if the file is now valid, or a red cross and the problem if not.',
    '',
    'This issue closes itself on the next run after the config file has no problems.',
    '',
    FOOTER,
  ].join('\n');
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return { body: `${content}\n<!-- gnosh-uptime:config-error:${hash} -->`, hash };
}

/** C6: exactly one open config-error issue while there are errors. */
export async function syncConfigErrorIssue(gh, { errors, validCount, warn = () => {}, botLogin = BOT_LOGIN }) {
  const open = (await listBotIssues(gh, 'config-error', { botLogin })).sort((a, b) => a.number - b.number);
  const current = open[0] ?? null;
  if (errors.length === 0) {
    if (!current) return { action: 'none' };
    await comment(gh, current.number, `The config file has no problems now. All **${validCount}** site(s) are being checked. Closing this issue.\n\n${FOOTER}`);
    await close(gh, current.number);
    return { action: 'closed', issue: current.number };
  }
  const { body, hash } = configErrorBody(errors, validCount, gh.repo);
  if (!current) {
    const n = await create(gh, CONFIG_ERROR_TITLE, body, 'config-error', warn);
    return { action: 'opened', issue: n };
  }
  if (!current.locked) await lock(gh, current.number, warn);
  if (String(current.body ?? '').includes(`<!-- gnosh-uptime:config-error:${hash} -->`)) return { action: 'unchanged', issue: current.number };
  await gh('PATCH', `/repos/${gh.repo}/issues/${current.number}`, { body });
  await comment(gh, current.number, `The list of problems changed. There are now ${errors.length} problem(s). See the updated list above.\n\n${FOOTER}`);
  return { action: 'updated', issue: current.number };
}

// ---------- Stale issue (§8, design §10.3)

export function staleTitle(gap) {
  return `Monitor was stale from ${fmtTime(gap.from)} to ${fmtTime(gap.to)}`;
}

export function staleBody(gap, settings, repo) {
  const marker = `<!-- gnosh-uptime:stale:${new Date(gap.from).toISOString()} -->`;
  return [
    `The monitor did not run for **${fmtDuration(Date.parse(gap.to) - Date.parse(gap.from))}**, from ${fmtTime(gap.from)} to ${fmtTime(gap.to)}. Checks are expected about every ${fmtDuration(settings.intervalMinutes * 60000)}.`,
    '',
    '**What this means**',
    '- Nothing was checked during that time, so problems in that period may have been missed.',
    `- During the gap, after ${fmtDuration(settings.staleAfterMinutes * 60000)} with no checks, the status page told visitors "We haven't been able to check recently, so we don't know if it's working."`,
    '- Checks have started again. This issue was opened by the first run after the gap.',
    '',
    '**Why this can happen**',
    '- GitHub runs scheduled workflows when it can. At busy times runs are late or skipped.',
    '- GitHub turns off scheduled workflows in public repos after 60 days without activity. The monitor tries to prevent this automatically, but if it fails you must turn the workflow back on.',
    "- Someone turned off Actions or the workflow in this repo's settings.",
    '- The config file had a problem that stopped every site from being checked (see any `config-error` issue).',
    '',
    '**What to do**',
    '- If this happens once in a while, nothing. You can close this issue.',
    `- If it happens often, or for many hours, read [If checks stop](${readme(repo, 'if-checks-stop')}).`,
    '',
    "This issue does not close by itself, so you know you have seen it. Close it when you're done.",
    '',
    FOOTER,
    marker,
  ].join('\n');
}

/**
 * S7: one issue per gap. De-duplicates over open and closed bot issues from
 * the last 30 days by a marker built from the run's own re-serialized time.
 */
export async function reportStaleGap(gh, { gap, settings, now, warn = () => {}, botLogin = BOT_LOGIN }) {
  const marker = `<!-- gnosh-uptime:stale:${new Date(gap.from).toISOString()} -->`;
  const since = new Date(new Date(now).getTime() - 30 * 86400000).toISOString();
  const recent = await listBotIssues(gh, 'monitor-stale', { state: 'all', since, botLogin });
  const found = recent.find((i) => String(i.body ?? '').includes(marker));
  if (found) return { action: 'exists', issue: found.number };
  const n = await create(gh, staleTitle(gap), staleBody(gap, settings, gh.repo), 'monitor-stale', warn);
  return { action: 'opened', issue: n };
}
