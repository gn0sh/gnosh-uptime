// Pure view model for the status page. No DOM, no I/O, no clock reads:
// everything comes in through arguments so it runs the same in Node tests
// and in the browser. Copy comes from docs/design/uptime-monitor.md §3 and §4.
//
// A "segment list" is an array of {text} | {text, datetime} | {text, href}.
// app.js turns it into text nodes, <time> and <a> elements using textContent.

export const TEMPLATE_URL = 'https://github.com/gn0sh/gnosh-uptime';
export const LOAD_TIMEOUT_MS = 15000;
export const RECOMPUTE_MS = 60 * 1000;
export const REFETCH_MS = 5 * 60 * 1000;

const DAY_MS = 86400000;
const WINDOW_DAYS = 90;
const MAX_NAMES_CHARS = 80;
const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?Z$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

// Threat model F1: anyone with a GitHub account may be able to comment on a report.
export const ISSUE_TRUST = 'Only trust updates there from the people who run this site.';
export const STALE_LABEL = "We haven't been able to check recently, so we don't know if it's working";

const REASONS = {
  'timeout': 'the site took too long to answer.',
  'DNS failure': "we couldn't find the site's address.",
  'TLS error': "there was a problem with the site's secure connection.",
  'connection error': "we couldn't connect to the site.",
  'too many redirects': 'the site kept sending us to other pages.',
  'blocked redirect': "the site sent us to an address we don't check.",
  'blocked address': "the site's address is one we don't check.",
};

// ---------- validation (AC-P9) ----------

function isIso(s) {
  return typeof s === 'string' && ISO_RE.test(s) && !Number.isNaN(Date.parse(s));
}
function isDateKey(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const isNonNegInt = (n) => Number.isInteger(n) && n >= 0;
const isPosInt = (n) => Number.isInteger(n) && n > 0;
const optString = (s) => s === undefined || s === null || typeof s === 'string';

/** @returns {{ok:true} | {ok:false, reason:string}} */
export function validateData(data) {
  const bad = (reason) => ({ ok: false, reason });
  if (!data || typeof data !== 'object' || Array.isArray(data)) return bad('not an object');
  if (data.v !== 1) return bad('wrong version');
  if (typeof data.repo !== 'string') return bad('repo');
  if (data.lastRunAt !== null && data.lastRunAt !== undefined && !isIso(data.lastRunAt)) return bad('lastRunAt');
  if (!isPosInt(data.intervalMinutes)) return bad('intervalMinutes');
  if (!isPosInt(data.staleAfterMinutes)) return bad('staleAfterMinutes');
  if (data.failuresBeforeAlert !== undefined && !isPosInt(data.failuresBeforeAlert)) return bad('failuresBeforeAlert');
  if (data.configErrorCount !== undefined && !isNonNegInt(data.configErrorCount)) return bad('configErrorCount');
  for (const k of ['contact', 'contactLink', 'siteName']) if (!optString(data[k])) return bad(k);
  if (!Array.isArray(data.targets) || data.targets.length > 100) return bad('targets');
  for (let i = 0; i < data.targets.length; i++) {
    const t = data.targets[i];
    const tb = (f) => bad(`targets[${i}].${f}`);
    if (!t || typeof t !== 'object' || Array.isArray(t)) return tb('');
    if (typeof t.name !== 'string' || t.name.trim() === '') return tb('name');
    if (t.url !== undefined && typeof t.url !== 'string') return tb('url');
    if (!['up', 'down', 'unknown'].includes(t.state)) return tb('state');
    if (t.lastCheckedAt !== null && t.lastCheckedAt !== undefined && !isIso(t.lastCheckedAt)) return tb('lastCheckedAt');
    if (t.state !== 'unknown' && !isIso(t.lastCheckedAt)) return tb('lastCheckedAt');
    if (!optString(t.lastFailureReason)) return tb('lastFailureReason');
    if (t.outageStartedAt !== null && t.outageStartedAt !== undefined && !isIso(t.outageStartedAt)) return tb('outageStartedAt');
    if (t.issue !== null && t.issue !== undefined && typeof t.issue !== 'number') return tb('issue');
    if (t.suppressed !== undefined && typeof t.suppressed !== 'boolean') return tb('suppressed');
    if (t.failStreak !== undefined && !isNonNegInt(t.failStreak)) return tb('failStreak');
    if (!Array.isArray(t.days) || t.days.length > 400) return tb('days');
    for (const d of t.days) {
      if (!Array.isArray(d) || d.length !== 3 || !isDateKey(d[0]) || !isNonNegInt(d[1])
        || !isNonNegInt(d[2]) || d[2] > d[1]) return tb('days');
    }
  }
  return { ok: true };
}

// ---------- time formatting (design §3.6) ----------

const pad2 = (n) => String(n).padStart(2, '0');
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const dateKeyOf = (ms) => new Date(ms).toISOString().slice(0, 10);

export function relTime(ms, nowMs) {
  const mins = Math.floor((nowMs - ms) / 60000);
  if (mins < 1) return 'less than a minute ago';
  if (mins < 60) return `${plural(mins, 'minute')} ago`;
  if (mins < 120) return '1 hour ago';
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

export function dayWords(dateKey, nowMs) {
  const d = new Date(dateKey + 'T00:00:00Z');
  let s = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  if (d.getUTCFullYear() !== new Date(nowMs).getUTCFullYear()) s += ` ${d.getUTCFullYear()}`;
  return s;
}

export function absTime(ms, nowMs) {
  const d = new Date(ms);
  let s = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
  if (dateKeyOf(ms) !== dateKeyOf(nowMs)) s += ` on ${dayWords(dateKeyOf(ms), nowMs)}`;
  return s;
}

export function intervalWords(minutes) {
  if (minutes % 60 === 0) return plural(minutes / 60, 'hour');
  return plural(minutes, 'minute');
}

/** Duration words, e.g. "1 hour 15 minutes", "2 days 3 hours". */
export function durationWords(ms) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return plural(Math.max(mins, 1), 'minute');
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (days >= 2) return hours ? `${plural(days, 'day')} ${plural(hours, 'hour')}` : plural(days, 'day');
  const totalHours = Math.floor(mins / 60);
  return m ? `${plural(totalHours, 'hour')} ${plural(m, 'minute')}` : plural(totalHours, 'hour');
}

function timeSegs(iso, nowMs) {
  const ms = Date.parse(iso);
  const datetime = new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { rel: { text: relTime(ms, nowMs), datetime }, abs: { text: absTime(ms, nowMs), datetime } };
}

export const segmentsText = (segs) => segs.map((s) => s.text).join('');

// ---------- small helpers ----------

export function isValidRepo(repo) {
  return typeof repo === 'string' && REPO_RE.test(repo) && !repo.split('/')[1].startsWith('.');
}

/** AC-P7: link only for a positive integer and a well-formed repo. */
export function issueHref(repo, n) {
  if (!Number.isInteger(n) || n <= 0 || !isValidRepo(repo)) return null;
  return `https://github.com/${repo}/issues/${n}`;
}

export function readmeHref(repo, anchor) {
  return (isValidRepo(repo) ? `https://github.com/${repo}` : TEMPLATE_URL) + '#' + anchor;
}

/**
 * Threat model F3: the page decides links itself and never trusts data.
 * Only https: (no userinfo) and mailto:<one address> pass; re-checked with new URL().
 */
export function safeContactHref(link) {
  if (typeof link !== 'string') return null;
  const s = link.trim();
  if (!/^(https:\/\/|mailto:)/i.test(s)) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol === 'https:') return u.username || u.password ? null : u.href;
  if (u.protocol === 'mailto:') return EMAIL_RE.test(decodeURIComponent(u.pathname)) && !u.search ? u.href : null;
  return null;
}

const CONTACT_LINK_RE = /\bhttps:\/\/[^\s<>"]+|\bmailto:[^\s<>"]+/gi;

/** Split contact text into text and link segments (F3 allowlist). */
function linkifyContact(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(CONTACT_LINK_RE)) {
    let raw = m[0];
    const trail = /[.,;:!?)\]']+$/.exec(raw);
    if (trail) raw = raw.slice(0, -trail[0].length);
    const href = safeContactHref(raw);
    if (!href) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: /^mailto:/i.test(raw) ? raw.slice(7) : raw, href });
    last = m.index + raw.length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Percent of ok checks, rounded DOWN to one decimal (SC-6). null if no checks. */
export function percentText(ok, checks) {
  if (!checks) return null;
  const tenths = Math.floor((ok * 1000) / checks);
  return `${Math.floor(tenths / 10)}.${tenths % 10}%`;
}

export function reasonLine(reason) {
  if (typeof reason !== 'string' || reason === '') return null;
  const m = /^HTTP (\d{3})$/.exec(reason);
  if (m) return `What we saw: the site answered with an error (code ${m[1]}).`;
  if (reason === 'HTTP') return 'What we saw: the site answered with an error.';
  return 'What we saw: ' + (REASONS[reason] || 'something went wrong when we checked.');
}

function joinNames(names) {
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

function repoName(repo) {
  return typeof repo === 'string' && repo.includes('/') ? repo.split('/')[1] : null;
}

function siteNameOf(data, opts) {
  for (const s of [opts.siteName, data && data.siteName, repoName(opts.repo), repoName(data && data.repo)]) {
    if (typeof s === 'string' && s.trim()) return s.trim();
  }
  return 'Our sites';
}

// Threat model F2: the contact line comes only from the build-time <meta> tags
// (opts.contact / opts.contactLink), never from status.json.
function contactSegs(text, link) {
  const t = typeof text === 'string' && text.trim() ? text.trim() : null;
  const href = safeContactHref(link);
  if (!t && !href) return null;
  if (href) return [{ text: 'Questions? ' }, { text: t || 'Contact us', href }];
  // Contact text that already starts with "Questions?" is shown as is.
  return linkifyContact(/^questions\?/i.test(t) ? t : 'Questions? ' + t);
}

function aboutParagraphs(intervalMinutes) {
  const every = intervalMinutes ? `about every ${intervalWords(intervalMinutes)}` : 'regularly';
  return [
    `We check each site ${every}. Checks can be late, sometimes by an hour or more, because they run on a free service that doesn't promise exact times.`,
    'We only know how a site was doing at the moment we checked it. A short problem between two checks may not show up here.',
    'When a site stops working, the people who run it usually find out about 30 to 60 minutes later, sometimes later than that.',
    'The percentages count only the checks we actually made. Days with no checks are left out.',
    'This page updates by itself every few minutes. You can also reload it.',
  ];
}

function base(pageState, siteName, contact) {
  return {
    pageState,
    siteName,
    title: `${siteName} status`,
    headline: [],
    headlineIcon: null,
    stateSentence: '',
    notices: [],
    errorBody: null,
    button: null,
    contact,
    problems: [],
    problemsNote: null,
    countLine: null,
    targets: [],
    showTargets: false,
    about: aboutParagraphs(null),
  };
}

// ---------- loading and load error ----------

/** opts: {siteName, repo, contact, contactLink} from the page's build-time <meta> tags. */
export function loadingModel(opts = {}) {
  const m = base('loading', siteNameOf(null, opts), contactSegs(opts.contact, opts.contactLink));
  m.headline = [{ text: 'Getting the latest status…' }];
  return m;
}

export function loadErrorModel(opts = {}) {
  const m = base('error', siteNameOf(null, opts), contactSegs(opts.contact, opts.contactLink));
  m.title = `Status unavailable – ${m.siteName} status`;
  m.stateSentence = "We can't load the status right now.";
  m.headline = [{ text: m.stateSentence }];
  m.headlineIcon = 'unknown';
  m.errorBody = {
    text: "This doesn't mean the sites are working or not working. We just can't tell at the moment. Please try again in a few minutes.",
    small: [
      { text: 'If you run this page: the first check may not have run yet, or the status data may be missing. ' },
      { text: 'See the setup guide.', href: readmeHref(opts.repo, 'setup') },
    ],
  };
  m.button = opts.retrying ? { text: 'Trying again…', disabled: true } : { text: 'Try again', disabled: false };
  return m;
}

// ---------- history (design §6.3) ----------

function dayClass(checks, ok) {
  if (!checks) return 'none';
  if (ok === checks) return 'ok';
  return (checks - ok) / checks >= 0.5 ? 'most' : 'some';
}

function buildHistory(t, nowMs) {
  const todayMs = Date.parse(dateKeyOf(nowMs) + 'T00:00:00Z');
  const windowStartKey = dateKeyOf(todayMs - (WINDOW_DAYS - 1) * DAY_MS);
  const byDate = new Map();
  for (const [k, checks, ok] of t.days) if (k >= windowStartKey) byDate.set(k, [checks, ok]);
  const firstChecked = [...byDate.keys()].sort()[0] || null;
  const startKey = firstChecked && firstChecked > windowStartKey ? firstChecked : windowStartKey;
  const sinceStart = startKey !== windowStartKey;

  const marks = [];
  const rows = [];
  const counts = { ok: 0, problems: 0, none: 0 };
  let lastProblem = null;
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const key = dateKeyOf(todayMs - i * DAY_MS);
    if (key < startKey) { marks.push({ cls: 'pre', date: key }); continue; }
    const [checks, ok] = byDate.get(key) || [0, 0];
    const cls = dayClass(checks, ok);
    marks.push({ cls, date: key });
    if (cls === 'ok') counts.ok++;
    else if (cls === 'none') counts.none++;
    else { counts.problems++; lastProblem = key; }
    const pct = percentText(ok, checks);
    const result = { ok: 'Working all day', none: 'Not checked this day',
      some: `Some problems (${pct} working)`, most: `Mostly not working (${pct} working)` }[cls];
    rows.unshift({ day: dayWords(key, nowMs), date: key, result, checks: plural(checks, 'check') });
  }

  const total = rows.length;
  let summary;
  const prefix = sinceStart ? `Since we started checking on ${dayWords(startKey, nowMs)}: ` : 'Last 90 days: ';
  if (counts.ok === total) {
    summary = sinceStart ? prefix + 'working all day on every day.' : 'Working all day on every day in the last 90 days.';
  } else {
    const parts = [];
    if (counts.ok) parts.push(`working all day on ${plural(counts.ok, 'day')}`);
    if (counts.problems) parts.push(`problems on ${plural(counts.problems, 'day')}`);
    if (counts.none) parts.push(`not checked on ${plural(counts.none, 'day')}`);
    summary = prefix + parts.join(', ') + '.';
    if (lastProblem) summary += ` Most recent problem: ${dayWords(lastProblem, nowMs)}.`;
  }
  const startDaysAgo = Math.round((todayMs - Date.parse(startKey + 'T00:00:00Z')) / DAY_MS);
  return {
    marks,
    startLabel: sinceStart ? (startDaysAgo === 0 ? null : `${plural(startDaysAgo, 'day')} ago`) : '90 days ago',
    endLabel: 'Today',
    summary,
    detailsSummary: `Show day-by-day history for ${t.name}`,
    caption: `Day-by-day history for ${t.name}, newest first`,
    rows,
  };
}

function uptimeLine(t, nowMs, days) {
  const fromKey = dateKeyOf(Date.parse(dateKeyOf(nowMs) + 'T00:00:00Z') - (days - 1) * DAY_MS);
  let checks = 0, ok = 0;
  for (const [k, c, o] of t.days) if (k >= fromKey) { checks += c; ok += o; }
  const p = percentText(ok, checks);
  return p ? `Last ${days} days: ${p} working` : `Last ${days} days: no checks yet`;
}

// ---------- main model ----------

/**
 * Build the whole page model.
 * opts: {siteName, repo, contact, contactLink} (build-time metas, used as fallbacks),
 *       refreshFailedAtMs (a later refresh failed; data is the last good copy),
 *       lastGoodFetchMs, retrying.
 */
export function buildModel(data, nowMs, opts = {}) {
  if (!validateData(data).ok) return loadErrorModel(opts);

  const siteName = siteNameOf(data, opts);
  const contact = contactSegs(opts.contact, opts.contactLink);
  const staleMs = data.staleAfterMinutes * 60000;
  // Threat model F10: links use the repo fixed at deploy time, never data.repo.
  const repo = opts.repo;
  const T = data.targets.length;
  const m = base('none', siteName, contact);
  m.about = aboutParagraphs(data.intervalMinutes);
  m.button = opts.retrying ? { text: 'Checking again…', disabled: true } : { text: 'Check again', disabled: false };

  if (opts.refreshFailedAtMs && opts.lastGoodFetchMs) {
    m.notices.push({
      kind: 'refresh',
      text: [{ text: `We couldn't get newer information. This page shows what we knew ${relTime(opts.lastGoodFetchMs, nowMs)}.` }],
    });
  }

  if (T === 0) {
    m.stateSentence = 'There are no sites on this status page yet.';
    m.headline = [{ text: m.stateSentence }];
    m.errorBody = { text: null, small: [
      { text: 'If you run this page: add your sites to the config file. ' },
      { text: 'See the setup guide.', href: readmeHref(repo, 'setup') },
    ] };
    return m;
  }

  const lastRunMs = isIso(data.lastRunAt) ? Date.parse(data.lastRunAt) : null;
  const pageStale = lastRunMs !== null && nowMs - lastRunMs > staleMs;

  // Per-target state, design §3.2 (first match wins).
  const targets = data.targets.map((t, i) => {
    const checkedMs = isIso(t.lastCheckedAt) ? Date.parse(t.lastCheckedAt) : null;
    let key;
    if (pageStale) key = 'unknown';
    else if (checkedMs !== null && nowMs - checkedMs > staleMs) key = 'unknown';
    else if (t.state === 'unknown' || checkedMs === null) key = 'none';
    else key = t.state === 'down' ? 'bad' : 'ok';
    const linkable = !t.suppressed;
    return { t, i, key, checkedMs, href: linkable ? issueHref(repo, t.issue) : null };
  });

  const bad = targets.filter((x) => x.key === 'bad');
  const unchecked = targets.filter((x) => x.key === 'unknown' || x.key === 'none');
  const allNone = targets.every((x) => x.key === 'none');

  let timeSentence = null;
  if (lastRunMs !== null) {
    const ts = timeSegs(data.lastRunAt, nowMs);
    timeSentence = [{ text: ' We last checked ' }, ts.rel, { text: ', at ' }, ts.abs, { text: '.' }];
  }

  const uncheckedSentence = () => {
    if (unchecked.length === 0) return '';
    if (unchecked.length === 1) {
      const u = unchecked[0];
      return u.key === 'none' ? ` We haven't checked ${u.t.name} yet.`
        : ` We haven't been able to check ${u.t.name} recently.`;
    }
    return unchecked.every((u) => u.key === 'none') ? " Some sites haven't been checked yet."
      : " Some sites haven't been checked recently.";
  };

  if (pageStale) {
    m.pageState = 'stale';
    m.headlineIcon = 'unknown';
    m.stateSentence = T === 1
      ? `We haven't been able to check recently, so we don't know if ${data.targets[0].name} is working.`
      : "We haven't been able to check recently, so we don't know if things are working.";
    const ts = timeSegs(data.lastRunAt, nowMs);
    m.headline = [{ text: m.stateSentence + ' Our last check was ' }, ts.rel, { text: ', at ' }, ts.abs, { text: '.' }];
    m.title = `Not checked recently – ${siteName} status`;
    m.notices.unshift({
      kind: 'stale',
      text: [{ text: 'This page shows what we saw at our last check. Things may have changed since then.' }],
      small: [{ text: 'If you run this page: how to restart the checks', href: readmeHref(repo, 'if-checks-stop') }],
    });
  } else if (lastRunMs === null || allNone) {
    m.pageState = 'never';
    m.headlineIcon = 'none';
    m.stateSentence = T === 1
      ? `We haven't checked ${data.targets[0].name} yet, so we don't know if it's working. Please come back in about an hour.`
      : "We haven't checked these sites yet, so we don't know if they're working. Please come back in about an hour.";
    m.headline = [{ text: m.stateSentence }];
    m.title = `Not checked yet – ${siteName} status`;
  } else if (bad.length > 0) {
    m.pageState = 'some-down';
    m.headlineIcon = 'bad';
    const names = bad.map((x) => x.t.name);
    let s;
    if (T === 1) s = `${names[0]} is not working right now.`;
    else if (bad.length === T) s = 'None of our sites are working right now.';
    else if (bad.length >= 4 || names.join('').length > MAX_NAMES_CHARS) {
      s = `${bad.length} of our ${T} sites are not working right now. They are listed below.` + uncheckedSentence();
    } else {
      s = `${joinNames(names)} ${bad.length === 1 ? 'is' : 'are'} not working right now.`
        + (unchecked.length ? uncheckedSentence() : ' Everything else is working.');
    }
    m.stateSentence = s;
    m.headline = [{ text: s }, ...timeSentence];
    m.title = `Not working: ${bad.length === 1 ? names[0] : bad.length + ' sites'} – ${siteName} status`;
    m.problemsNote = bad.some((x) => x.href) ? ISSUE_TRUST : null;
    m.problems = bad.map((x) => (x.href
      ? { name: x.t.name, segs: [{ text: `${x.t.name}: ` }, { text: 'read the outage report', href: x.href }] }
      : { name: x.t.name, segs: [{ text: x.t.name }] }));
  } else if (unchecked.length > 0) {
    m.pageState = 'partly';
    m.headlineIcon = 'none';
    m.stateSentence = 'Everything we have checked is working.' + uncheckedSentence();
    m.headline = [{ text: m.stateSentence }, ...timeSentence];
    m.title = `Some sites not checked – ${siteName} status`;
  } else {
    m.pageState = 'all-up';
    m.headlineIcon = 'ok';
    m.stateSentence = 'Everything is working.';
    m.headline = [{ text: m.stateSentence }, ...timeSentence];
    m.title = `Everything is working – ${siteName} status`;
  }

  m.showTargets = true;
  m.countLine = T >= 6 ? `${T} sites` : null;
  m.targets = targets.map((x) => buildCard(x, data, nowMs));
  return m;
}

function buildCard({ t, i, key, href }, data, nowMs) {
  const lines = [];
  const card = {
    id: `site-${i}`,
    name: t.name,
    stateKey: key,
    stateLabel: { ok: 'Working', bad: 'Not working', unknown: STALE_LABEL, none: 'Not checked yet' }[key],
    lines,
    reason: null,
    issue: null,
    issueNote: null,
    issueTrust: null,
    nextCheck: null,
    uptime: [uptimeLine(t, nowMs, 7), uptimeLine(t, nowMs, 90)],
    history: buildHistory(t, nowMs),
  };
  const checked = isIso(t.lastCheckedAt) ? timeSegs(t.lastCheckedAt, nowMs) : null;
  const lastChecked = () => [{ text: 'Last checked ' }, checked.rel, { text: ', at ' }, checked.abs, { text: '.' }];
  const issue = href ? { text: `Read the outage report for ${t.name}`, href } : null;

  if (key === 'ok') {
    lines.push(lastChecked());
  } else if (key === 'bad') {
    if (isIso(t.outageStartedAt)) {
      const o = timeSegs(t.outageStartedAt, nowMs);
      lines.push([{ text: 'Not working since about ' }, o.abs, { text: ' (' }, o.rel, { text: ').' }]);
    }
    lines.push(lastChecked());
    card.reason = reasonLine(t.lastFailureReason) || reasonLine('unknown');
    if (issue) {
      card.issue = issue;
      card.issueNote = "The report is on GitHub. You don't need an account to read it.";
      card.issueTrust = ISSUE_TRUST;
    } else {
      card.nextCheck = "We'll check again soon.";
    }
  } else if (key === 'unknown') {
    if (checked && t.state !== 'unknown') {
      const was = t.state === 'up' ? 'it was working.' : 'it was not working.';
      lines.push([{ text: 'When we last checked, ' }, checked.rel, { text: ' at ' }, checked.abs, { text: ', ' + was }]);
    } else {
      lines.push([{ text: "When we last checked, we hadn't checked it yet." }]);
    }
    if (issue) {
      card.issue = issue;
      card.issueNote = "The report is on GitHub. You don't need an account to read it.";
      card.issueTrust = ISSUE_TRUST;
    }
  } else {
    lines.push([{ text: "We started watching this site recently. The first check hasn't happened yet." }]);
  }
  return card;
}
