// Read and write status.json on the orphan data branch through the
// authenticated Contents API. Architecture §7, ADR-0003.

import { checkUrlSyntax } from './ssrf.js';
import { isKnownReason } from './reasons.js';
import { isValidRepo } from './github.js';

export const DATA_BRANCH = 'monitor-data';
export const DATA_FILE = 'status.json';
export const MAX_RECORD_BYTES = 1024;
export const MAX_HEADER_BYTES = 1024;
export const MAX_TOTAL_BYTES = 256 * 1024;

export class DataSizeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DataSizeError';
  }
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CTL = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const HEADER_KEYS = ['v', 'repo', 'siteName', 'lastRunAt', 'intervalMinutes', 'staleAfterMinutes', 'failuresBeforeAlert', 'contact', 'contactLink', 'configErrorCount', 'targets'];
const TARGET_KEYS = ['name', 'url', 'state', 'lastCheckedAt', 'lastFailureReason', 'failStreak', 'outageStartedAt', 'issue', 'suppressed', 'days'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isIso = (v) => typeof v === 'string' && ISO.test(v) && Number.isFinite(Date.parse(v));
const isIsoOrNull = (v) => v === null || isIso(v);
const isNat = (v) => Number.isSafeInteger(v) && v >= 0;
const isText = (v, max) => typeof v === 'string' && [...v].length <= max && !CTL.test(v);
const exactKeys = (o, keys) => {
  const k = Object.keys(o);
  return k.length === keys.length && keys.every((x) => Object.prototype.hasOwnProperty.call(o, x));
};

/**
 * Strict schema check of a stored status.json (threat model F5). The data
 * branch is writable by anyone with push access, so nothing is trusted.
 */
export function isValidStoredData(d) {
  if (!isObj(d) || d.v !== 1 || !exactKeys(d, HEADER_KEYS)) return false;
  if (!isValidRepo(d.repo) || !isIso(d.lastRunAt)) return false;
  if (!(Number.isInteger(d.intervalMinutes) && d.intervalMinutes >= 1 && d.intervalMinutes <= 1440)) return false;
  if (!(Number.isInteger(d.staleAfterMinutes) && d.staleAfterMinutes >= 1 && d.staleAfterMinutes <= 1440)) return false;
  if (!(Number.isInteger(d.failuresBeforeAlert) && d.failuresBeforeAlert >= 1 && d.failuresBeforeAlert <= 10)) return false;
  if (!(d.siteName === null || isText(d.siteName, 60))) return false;
  if (!(d.contact === null || isText(d.contact, 200))) return false;
  if (!(d.contactLink === null || (isText(d.contactLink, 500) && /^(https:|mailto:)/i.test(d.contactLink)))) return false;
  if (!isNat(d.configErrorCount)) return false;
  if (!Array.isArray(d.targets) || d.targets.length > 20) return false;
  const names = new Set();
  for (const t of d.targets) {
    if (!isObj(t) || !exactKeys(t, TARGET_KEYS)) return false;
    if (typeof t.name !== 'string' || t.name.trim() !== t.name || t.name === '' || !isText(t.name, 50)) return false;
    if (names.has(t.name.toLowerCase())) return false;
    names.add(t.name.toLowerCase());
    if (!isText(t.url, 500) || !checkUrlSyntax(t.url).ok) return false;
    if (!['up', 'down', 'unknown'].includes(t.state)) return false;
    if (!isIsoOrNull(t.lastCheckedAt) || !isIsoOrNull(t.outageStartedAt)) return false;
    if (!(t.lastFailureReason === null || isKnownReason(t.lastFailureReason))) return false;
    if (!isNat(t.failStreak)) return false;
    if (!(t.issue === null || (Number.isSafeInteger(t.issue) && t.issue > 0))) return false;
    if (typeof t.suppressed !== 'boolean') return false;
    if (!Array.isArray(t.days) || t.days.length > 90) return false;
    let prevDay = '';
    for (const day of t.days) {
      if (!Array.isArray(day) || day.length !== 3) return false;
      const [date, checks, ok] = day;
      if (typeof date !== 'string' || !DAY.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) return false;
      if (date <= prevDay) return false;
      prevDay = date;
      if (!isNat(checks) || !isNat(ok) || ok > checks || checks > 100000) return false;
    }
  }
  return true;
}

const bytes = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');

/**
 * Serializes the data after asserting the D3 size bounds.
 * @returns {string} minified JSON
 */
export function serializeData(data) {
  const { targets = [], ...header } = data;
  if (bytes(header) > MAX_HEADER_BYTES) throw new DataSizeError(`status.json header is over ${MAX_HEADER_BYTES} bytes`);
  targets.forEach((t, k) => {
    const { days, ...record } = t;
    if (bytes(record) > MAX_RECORD_BYTES) throw new DataSizeError(`status.json target record ${k + 1} is over ${MAX_RECORD_BYTES} bytes`);
  });
  const text = JSON.stringify(data);
  if (Buffer.byteLength(text, 'utf8') > MAX_TOTAL_BYTES) throw new DataSizeError(`status.json is over ${MAX_TOTAL_BYTES} bytes`);
  return text;
}

/**
 * @returns {Promise<{data: object|null, sha: string|null, warning: string|null}>}
 */
export async function readData(gh) {
  const res = await gh('GET', `/repos/${gh.repo}/contents/${DATA_FILE}?ref=${DATA_BRANCH}`, undefined, { allow: [404] });
  if (res.status === 404) return { data: null, sha: null, warning: null };
  const sha = typeof res.json?.sha === 'string' ? res.json.sha : null;
  try {
    if (res.json?.encoding !== 'base64' || typeof res.json.content !== 'string') throw new Error('no inline content');
    const data = JSON.parse(Buffer.from(res.json.content, 'base64').toString('utf8'));
    if (!isValidStoredData(data)) throw new Error('wrong shape');
    return { data, sha, warning: null };
  } catch {
    return { data: null, sha, warning: `The stored ${DATA_FILE} could not be read, so the monitor starts fresh.` };
  }
}

/**
 * Writes status.json. With a sha: PUT with that sha (optimistic concurrency;
 * a stale sha makes GitHub return 409 or 422 and this throws). Without one:
 * PUT to the existing branch, or bootstrap the orphan branch.
 * @returns {Promise<{bytes:number, bootstrapped:boolean}>}
 */
export async function writeData(gh, data, sha) {
  const text = serializeData(data);
  const content = Buffer.from(text, 'utf8').toString('base64');
  const message = `data: run ${data.lastRunAt}`;
  const size = Buffer.byteLength(text, 'utf8');

  if (sha === null) {
    const ref = await gh('GET', `/repos/${gh.repo}/git/ref/heads/${DATA_BRANCH}`, undefined, { allow: [404] });
    if (ref.status === 404) {
      const blob = await gh('POST', `/repos/${gh.repo}/git/blobs`, { content, encoding: 'base64' });
      const tree = await gh('POST', `/repos/${gh.repo}/git/trees`, {
        tree: [{ path: DATA_FILE, mode: '100644', type: 'blob', sha: blob.json.sha }],
      });
      const commit = await gh('POST', `/repos/${gh.repo}/git/commits`, { message, tree: tree.json.sha, parents: [] });
      await gh('POST', `/repos/${gh.repo}/git/refs`, { ref: `refs/heads/${DATA_BRANCH}`, sha: commit.json.sha });
      return { bytes: size, bootstrapped: true };
    }
  }
  const body = { message, content, branch: DATA_BRANCH };
  if (sha !== null) body.sha = sha;
  await gh('PUT', `/repos/${gh.repo}/contents/${DATA_FILE}`, body);
  return { bytes: size, bootstrapped: false };
}
