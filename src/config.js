// Parse and validate monitor.config.json, and derive the interval from the
// workflow cron. Architecture §5, ADR-0007, manager decisions (JSON config,
// plain-language errors with line numbers), UX SC-1 and SC-2.

import { parseJson, JsonSyntaxError } from './jsonloc.js';
import { checkUrlSyntax } from './ssrf.js';

export const CONFIG_PATH = 'monitor.config.json';
export const WORKFLOW_PATH = '.github/workflows/monitor.yml';
export const MAX_TARGETS = 20;
export const MAX_NAME_CHARS = 50; // SC-1 (architecture §5 said 60)
export const MAX_SITE_NAME_CHARS = 60;
export const MAX_URL_CHARS = 500;
export const MAX_CONTACT_CHARS = 200;
export const MAX_CONFIG_BYTES = 64 * 1024;
export const DEFAULT_INTERVAL = 15;

export const DEFAULTS = Object.freeze({
  failuresBeforeAlert: 2,
  timeoutSeconds: 10,
  staleAfterMinutes: 60,
});

const TOP_KEYS = new Set(['siteName', 'contact', 'contactLink', 'failuresBeforeAlert', 'timeoutSeconds', 'staleAfterMinutes', 'targets']);
const TARGET_KEYS = new Set(['name', 'url']);
// Unicode control (Cc) and format (Cf, e.g. bidi overrides) characters, plus
// line and paragraph separators. Threat model F9.
const CONTROL_CHARS = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const CONTROL_CHARS_G = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;
// Query parameter names that usually carry secrets. Threat model F11.
const SECRET_PARAM = /^(token|key|api[_-]?key|secret|sig|signature|password|pass|auth|access[_-]?token)$/i;
// Schemes rejected anywhere in the contact line, even before a digit. Threat model F3.
const DANGEROUS_SCHEME = /\b(javascript|data|vbscript|file):/i;

const charLength = (s) => [...s].length;

/** Keys that start with "//" are notes for the owner (JSON has no comments). */
const isNoteKey = (k) => k.startsWith('//');

/**
 * Parses a cron minute field into a sorted set of minutes, or null.
 */
function parseMinuteField(field) {
  const minutes = new Set();
  for (const part of field.split(',')) {
    const m = /^(\*|(\d{1,2})(?:-(\d{1,2}))?)(?:\/(\d{1,2}))?$/.exec(part);
    if (!m) return null;
    let lo;
    let hi;
    if (m[1] === '*') {
      lo = 0;
      hi = 59;
    } else {
      lo = Number(m[2]);
      hi = m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? 59 : lo;
    }
    const step = m[4] !== undefined ? Number(m[4]) : 1;
    if (lo > 59 || hi > 59 || lo > hi || step < 1) return null;
    for (let x = lo; x <= hi; x += step) minutes.add(x);
  }
  return [...minutes].sort((a, b) => a - b);
}

/**
 * The largest cyclic gap, in minutes, between scheduled runs in the
 * workflow's cron lines. Hour, day, month and weekday fields must be '*'.
 * @returns {number|null}
 */
export function deriveIntervalMinutes(workflowText) {
  if (typeof workflowText !== 'string') return null;
  const crons = [...workflowText.matchAll(/^\s*-?\s*cron:\s*(['"]?)([^'"\n#]+)\1\s*(?:#.*)?$/gm)].map((m) => m[2].trim());
  if (crons.length === 0) return null;
  const all = new Set();
  for (const cron of crons) {
    const fields = cron.split(/\s+/);
    if (fields.length !== 5 || fields.slice(1).some((f) => f !== '*')) return null;
    const mins = parseMinuteField(fields[0]);
    if (!mins) return null;
    for (const x of mins) all.add(x);
  }
  const mins = [...all].sort((a, b) => a - b);
  let gap = 60 - mins[mins.length - 1] + mins[0];
  for (let k = 1; k < mins.length; k++) gap = Math.max(gap, mins[k] - mins[k - 1]);
  return gap;
}

/** True when every link-like `scheme:` token in the text is https: or mailto:. */
export function contactLinksOk(text) {
  if (DANGEROUS_SCHEME.test(text)) return false;
  for (const m of text.matchAll(/\b([a-z][a-z0-9+.-]*):(?=[^\s\d])/gi)) {
    const scheme = m[1].toLowerCase();
    if (scheme !== 'https' && scheme !== 'mailto') return false;
  }
  return true;
}

function displayName(name) {
  if (typeof name !== 'string' || name.trim() === '') return null;
  const clean = name.replace(CONTROL_CHARS_G, ' ').trim();
  const chars = [...clean];
  return chars.length > 60 ? `${chars.slice(0, 57).join('')}...` : clean;
}

function targetEntry(index, name) {
  const shown = displayName(name);
  return shown === null ? `Site #${index} (no name)` : `Site #${index} "${shown}"`;
}

function isInt(v, lo, hi) {
  return Number.isInteger(v) && v >= lo && v <= hi;
}

/**
 * @param {string} configText
 * @param {string|null} workflowText null when the workflow file isn't present
 *   (then the default interval is used without an error).
 * @returns {{ok:boolean, parsed:boolean, settings:object, targets:Array<{name,url}>,
 *   errors:Array<{entry:string, reason:string, line:number|null, index?:number, name?:string|null}>}}
 */
export function parseConfig(configText, workflowText = null) {
  const errors = [];
  const add = (entry, reason, line = null, extra = {}) => errors.push({ entry, reason, line, ...extra });

  // Interval first: it is needed to validate staleAfterMinutes.
  let intervalMinutes = DEFAULT_INTERVAL;
  if (workflowText !== null) {
    const derived = deriveIntervalMinutes(workflowText);
    if (derived === null) {
      add('Check schedule', `The schedule (cron) in ${WORKFLOW_PATH} could not be read. The monitor assumes about every ${DEFAULT_INTERVAL} minutes. Use a schedule like "7,22,37,52 * * * *".`);
    } else if (derived < 5) {
      add('Check schedule', `The schedule in ${WORKFLOW_PATH} runs more often than every 5 minutes. GitHub won't run schedules that often. Use 5 minutes or more. Until then the monitor assumes about every ${DEFAULT_INTERVAL} minutes.`);
    } else {
      intervalMinutes = derived;
    }
  }

  const settings = {
    siteName: null,
    contact: null,
    contactLink: null,
    failuresBeforeAlert: DEFAULTS.failuresBeforeAlert,
    timeoutMs: DEFAULTS.timeoutSeconds * 1000,
    staleAfterMinutes: Math.max(DEFAULTS.staleAfterMinutes, 2 * intervalMinutes),
    intervalMinutes,
  };
  const result = (parsed, targets = []) => ({ ok: errors.length === 0, parsed, settings, targets, errors });

  if (typeof configText !== 'string') {
    add('The config file', `The file ${CONFIG_PATH} could not be found, so no sites can be checked.`);
    return result(false);
  }
  if (Buffer.byteLength(configText, 'utf8') > MAX_CONFIG_BYTES) {
    add('The config file', `The file ${CONFIG_PATH} is too big (over 64 KB). It should only list up to ${MAX_TARGETS} sites.`);
    return result(false);
  }

  let doc;
  try {
    doc = parseJson(configText);
  } catch (e) {
    if (!(e instanceof JsonSyntaxError)) throw e;
    add('The config file', `The file is not valid JSON, so no sites can be read. At column ${e.column}: ${e.message}`, e.line, { column: e.column });
    return result(false);
  }
  const { value: cfg, lines, duplicates } = doc;
  const lineOf = (path) => lines.get(path) ?? null;

  if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
    add('The config file', 'The settings must be inside one pair of curly brackets { }.', lineOf(''));
    return result(false);
  }

  for (const d of duplicates) {
    const parts = d.path.split('.');
    add(parts.length >= 2 && parts[0] === 'targets' ? targetEntry(Number(parts[1]) + 1, null) : `Setting "${d.path}"`,
      `"${parts[parts.length - 1]}" appears more than once. Keep only one.`, d.line);
  }

  for (const key of Object.keys(cfg)) {
    if (!TOP_KEYS.has(key) && !isNoteKey(key)) {
      add(`Setting "${displayName(key) ?? key}"`, `This setting is not known. Check the spelling. Known settings: ${[...TOP_KEYS].join(', ')}.`, lineOf(key));
    }
  }

  // Settings: invalid values fall back to the default and become a config error.
  const has = (k) => Object.prototype.hasOwnProperty.call(cfg, k);
  if (has('failuresBeforeAlert')) {
    if (isInt(cfg.failuresBeforeAlert, 1, 10)) settings.failuresBeforeAlert = cfg.failuresBeforeAlert;
    else add('Setting "failuresBeforeAlert"', `Must be a whole number from 1 to 10. Using ${DEFAULTS.failuresBeforeAlert} until fixed.`, lineOf('failuresBeforeAlert'));
  }
  if (has('timeoutSeconds')) {
    if (isInt(cfg.timeoutSeconds, 1, 30)) settings.timeoutMs = cfg.timeoutSeconds * 1000;
    else add('Setting "timeoutSeconds"', `Must be a whole number from 1 to 30. Using ${DEFAULTS.timeoutSeconds} until fixed.`, lineOf('timeoutSeconds'));
  }
  if (has('staleAfterMinutes')) {
    const v = cfg.staleAfterMinutes;
    const min = 2 * intervalMinutes;
    if (isInt(v, min, 1440)) settings.staleAfterMinutes = v;
    else add('Setting "staleAfterMinutes"', `Must be a whole number from ${min} (twice the check interval of about ${intervalMinutes} minutes) to 1440. Using ${settings.staleAfterMinutes} until fixed.`, lineOf('staleAfterMinutes'));
  }
  if (has('siteName')) {
    const v = cfg.siteName;
    if (typeof v !== 'string' || v.trim() === '' || charLength(v.trim()) > MAX_SITE_NAME_CHARS || CONTROL_CHARS.test(v)) {
      add('Setting "siteName"', `The page name must be text of 1 to ${MAX_SITE_NAME_CHARS} characters on one line.`, lineOf('siteName'));
    } else {
      settings.siteName = v.trim();
    }
  }
  if (has('contact') && cfg.contact !== null) {
    const v = cfg.contact;
    if (typeof v !== 'string' || CONTROL_CHARS.test(v)) {
      add('Setting "contact"', 'The contact line must be text on one line.', lineOf('contact'));
    } else if (charLength(v.trim()) > MAX_CONTACT_CHARS) {
      add('Setting "contact"', `The contact line must be ${MAX_CONTACT_CHARS} characters or fewer.`, lineOf('contact'));
    } else if (!contactLinksOk(v)) {
      add('Setting "contact"', 'Links in the contact line must start with https:// or mailto:.', lineOf('contact'));
    } else if (v.trim() !== '') {
      settings.contact = v.trim();
    }
  }
  if (has('contactLink') && cfg.contactLink !== null) {
    const v = cfg.contactLink;
    let ok = false;
    if (typeof v === 'string' && charLength(v) <= MAX_URL_CHARS && !CONTROL_CHARS.test(v)) {
      try {
        const u = new URL(v.trim());
        // The stored value is the normalized href, so that is what is limited.
        ok = (u.protocol === 'https:' || u.protocol === 'mailto:') && u.username === '' && u.password === ''
          && !DANGEROUS_SCHEME.test(v) && charLength(u.href) <= MAX_URL_CHARS && !CONTROL_CHARS.test(u.href);
        if (ok) settings.contactLink = u.href;
      } catch {
        ok = false;
      }
    }
    if (!ok) add('Setting "contactLink"', 'The contact link must start with https:// or mailto:.', lineOf('contactLink'));
  }

  // Targets
  if (!has('targets')) {
    add('Setting "targets"', 'The file needs a "targets" list with at least one site.', lineOf(''));
    return result(true);
  }
  if (!Array.isArray(cfg.targets)) {
    add('Setting "targets"', 'The "targets" setting must be a list in square brackets [ ].', lineOf('targets'));
    return result(true);
  }
  if (cfg.targets.length === 0) {
    add('Setting "targets"', 'The "targets" list is empty. Add at least one site.', lineOf('targets'));
    return result(true);
  }

  const targets = [];
  const seenNames = new Set();
  cfg.targets.forEach((t, k) => {
    const index = k + 1;
    const path = `targets.${k}`;
    const rawName = t && typeof t === 'object' && !Array.isArray(t) ? t.name : undefined;
    const entry = targetEntry(index, rawName);
    const name = typeof rawName === 'string' ? rawName.trim() : null;
    const bad = (reason, linePath = path) => add(entry, reason, lineOf(linePath) ?? lineOf(path), { index, name: displayName(rawName), storedName: name === '' ? null : name });

    if (k >= MAX_TARGETS) return bad(`Only ${MAX_TARGETS} sites are allowed. This entry is number ${index}, so it is skipped.`);
    if (t === null || typeof t !== 'object' || Array.isArray(t)) return bad('Each site must be written as { "name": "...", "url": "..." }.');
    const unknown = Object.keys(t).filter((key) => !TARGET_KEYS.has(key) && !isNoteKey(key));
    if (unknown.length > 0) return bad(`"${displayName(unknown[0]) ?? unknown[0]}" is not a known setting for a site. Each site has only "name" and "url".`, `${path}.${unknown[0]}`);

    if (typeof rawName !== 'string' || name === '') return bad('Every site needs a "name".', `${path}.name`);
    if (CONTROL_CHARS.test(rawName)) return bad('The name must be on one line, with no tabs or invisible characters.', `${path}.name`);
    if (charLength(name) > MAX_NAME_CHARS) return bad(`Names must be ${MAX_NAME_CHARS} characters or fewer.`, `${path}.name`);
    const key = name.toLowerCase();
    if (seenNames.has(key)) return bad('Another site already uses this name. Each name must be different.', `${path}.name`);
    seenNames.add(key);

    if (typeof t.url !== 'string' || t.url.trim() === '') return bad('Every site needs a "url".', `${path}.url`);
    if (charLength(t.url) > MAX_URL_CHARS) return bad(`The address must be ${MAX_URL_CHARS} characters or fewer.`, `${path}.url`);
    const u = checkUrlSyntax(t.url);
    if (!u.ok) return bad(u.reason, `${path}.url`);
    for (const param of u.url.searchParams.keys()) {
      if (SECRET_PARAM.test(param)) {
        return bad(`The address has a "${displayName(param)}" setting that looks like a password or key. Everything in this file is public, so remove it.`, `${path}.url`);
      }
    }
    // Percent-encoding and punycode can make the href longer than the input.
    // Limit the value that is stored, so a valid config always gives valid data.
    if (charLength(u.url.href) > MAX_URL_CHARS) return bad(`The address must be ${MAX_URL_CHARS} characters or fewer once special characters are encoded. Shorten it.`, `${path}.url`);
    targets.push({ name, url: u.url.href });
    return undefined;
  });

  return result(true, targets);
}

/** Formats one error for plain-text output: "Line 12, Site #4 "Shop": reason". */
export function formatError(e) {
  return e.line ? `Line ${e.line}, ${e.entry}: ${e.reason}` : `${e.entry}: ${e.reason}`;
}
