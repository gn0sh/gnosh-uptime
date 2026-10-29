// Page controller: fetch status.json at view time, build the model with
// render.js, and draw it with createElement + textContent only (AC-SEC1).
import {
  buildModel, loadingModel, loadErrorModel, validateData,
  LOAD_TIMEOUT_MS, RECOMPUTE_MS, REFETCH_MS,
} from './render.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RAW_PREFIX = 'https://raw.githubusercontent.com/';

function meta(name) {
  const el = document.querySelector(`meta[name="${name}"]`);
  const v = el ? el.getAttribute('content') : null;
  return v && !v.startsWith('%') ? v : null; // "%...%" is an unreplaced build placeholder
}

const dataUrl = (() => {
  const u = meta('gu-data-url');
  return u && u.startsWith(RAW_PREFIX) ? u : null;
})();
// Threat model F10: the repo for links is fixed at deploy time (gu-repo meta,
// else the data URL's owner/repo), never taken from status.json.
const repoFromUrl = dataUrl ? dataUrl.slice(RAW_PREFIX.length).split('/').slice(0, 2).join('/') : null;
// Threat model F2: the contact line is read only from attribute-escaped metas.
const metaOpts = {
  siteName: meta('gu-site-name'),
  contact: meta('gu-contact'),
  contactLink: meta('gu-contact-link'),
  repo: meta('gu-repo') || repoFromUrl,
};

const state = {
  data: null,
  lastGoodFetchMs: null,
  refreshFailedAtMs: null,
  failed: false,
  retrying: false,
  firstRenderDone: false,
  lastStateSentence: null,
  lastFetchStartMs: 0,
  hiddenAtMs: null,
};

// ---------- DOM helpers ----------

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'className') e.className = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c) e.appendChild(c);
  return e;
}

/** Render a segment list from render.js into `parent`. */
function segs(parent, list, focusKey) {
  list.forEach((s, i) => {
    if (s.href) {
      parent.appendChild(el('a', { href: s.href, text: s.text, 'data-focus': focusKey ? `${focusKey}-${i}` : null }));
    } else if (s.datetime) {
      parent.appendChild(el('time', { datetime: s.datetime, text: s.text }));
    } else {
      parent.appendChild(document.createTextNode(s.text));
    }
  });
  return parent;
}

const ICONS = {
  ok: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'M7 12.5l3.2 3.2L17 9' }]],
  bad: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'M8.5 8.5l7 7M15.5 8.5l-7 7' }]],
  unknown: [['circle', { cx: 12, cy: 12, r: 10, 'stroke-dasharray': '3 2.5' }],
    ['path', { d: 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7' }], ['path', { d: 'M12 17.2v.3' }]],
  none: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'M12 7v5l3 2' }]],
};

function icon(kind) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false',
    class: `icon icon-${kind}`, fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) svg.setAttribute(k, v);
  for (const [tag, attrs] of ICONS[kind]) {
    const p = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, String(v));
    svg.appendChild(p);
  }
  return svg;
}

// ---------- persisted <details> state (optional) ----------

const openDetails = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('gu-open-details') || '[]');
  if (Array.isArray(saved)) saved.forEach((n) => typeof n === 'string' && openDetails.add(n));
} catch { /* storage unavailable: fine */ }
function saveDetails() {
  try { localStorage.setItem('gu-open-details', JSON.stringify([...openDetails])); } catch { /* ignore */ }
}

// ---------- rendering ----------

function renderCard(c) {
  const h3id = `${c.id}-name`;
  const art = el('article', { className: `card state-${c.stateKey}`, 'aria-labelledby': h3id });
  art.appendChild(el('h3', { id: h3id, text: c.name }));
  const label = el('p', { className: `state-label state-${c.stateKey}` });
  label.appendChild(icon(c.stateKey));
  label.appendChild(el('span', { text: c.stateLabel }));
  art.appendChild(label);
  for (const line of c.lines) art.appendChild(segs(el('p', { className: 'muted' }), line));
  if (c.reason) art.appendChild(el('p', { text: c.reason }));
  if (c.issue) {
    art.appendChild(el('p', { className: 'issue' },
      el('a', { href: c.issue.href, text: c.issue.text, 'data-focus': `${c.id}-issue` })));
    art.appendChild(el('p', { className: 'small muted', text: c.issueNote }));
    if (c.issueTrust) art.appendChild(el('p', { className: 'small muted', text: c.issueTrust }));
  }
  if (c.nextCheck) art.appendChild(el('p', { className: 'muted', text: c.nextCheck }));

  const fig = el('div', { className: 'uptime' });
  c.uptime.forEach((u) => fig.appendChild(el('p', { text: u })));
  art.appendChild(fig);

  const h = c.history;
  const hist = el('div', { className: 'history' });
  const strip = el('div', { className: 'strip', 'aria-hidden': 'true' });
  for (const mk of h.marks) strip.appendChild(el('span', { className: `day day-${mk.cls}` }));
  hist.appendChild(strip);
  hist.appendChild(el('div', { className: 'strip-labels', 'aria-hidden': 'true' },
    el('span', { text: h.startLabel || '' }), el('span', { text: h.endLabel })));
  hist.appendChild(el('p', { className: 'summary-line', text: h.summary }));

  const det = el('details', { open: openDetails.has(c.name) });
  det.appendChild(el('summary', { text: h.detailsSummary, 'data-focus': `${c.id}-details` }));
  det.addEventListener('toggle', () => {
    if (det.open) openDetails.add(c.name); else openDetails.delete(c.name);
    saveDetails();
  });
  const table = el('table');
  table.appendChild(el('caption', { text: h.caption }));
  table.appendChild(el('thead', {}, el('tr', {},
    el('th', { scope: 'col', text: 'Day' }), el('th', { scope: 'col', text: 'Result' }),
    el('th', { scope: 'col', text: 'Checks' }))));
  const tbody = el('tbody');
  for (const r of h.rows) {
    tbody.appendChild(el('tr', {},
      el('th', { scope: 'row' }, el('time', { datetime: r.date, text: r.day })),
      el('td', { text: r.result }), el('td', { text: r.checks })));
  }
  table.appendChild(tbody);
  det.appendChild(el('div', { className: 'table-wrap' }, table));
  hist.appendChild(det);
  art.appendChild(hist);
  return el('li', {}, art);
}

function render(m) {
  document.title = m.title;
  document.getElementById('site-name').textContent = m.siteName;

  const focusKey = document.activeElement && document.activeElement.getAttribute('data-focus');
  const main = document.getElementById('main');
  main.setAttribute('aria-busy', m.pageState === 'loading' ? 'true' : 'false');
  main.className = `wrap page-${m.pageState}`;

  const h1 = document.getElementById('headline');
  h1.replaceChildren();
  if (m.headlineIcon) h1.appendChild(icon(m.headlineIcon));
  h1.appendChild(segs(el('span'), m.headline));

  const dyn = el('div', { id: 'dynamic' });
  for (const n of m.notices) {
    const box = el('div', { className: `notice notice-${n.kind}` });
    box.appendChild(segs(el('p'), n.text));
    if (n.small) box.appendChild(segs(el('p', { className: 'small' }), n.small, `notice-${n.kind}`));
    dyn.appendChild(box);
  }
  if (m.errorBody) {
    if (m.errorBody.text) dyn.appendChild(el('p', { text: m.errorBody.text }));
  }
  if (m.button) {
    // aria-disabled (not disabled) keeps focus on the button while it works.
    const b = el('button', { type: 'button', className: 'retry', text: m.button.text,
      'aria-disabled': m.button.disabled ? 'true' : null, 'data-focus': 'retry' });
    b.addEventListener('click', onRetry);
    dyn.appendChild(el('p', { className: 'retry-row' }, b));
  }
  if (m.errorBody && m.errorBody.small) dyn.appendChild(segs(el('p', { className: 'small muted' }), m.errorBody.small, 'setup'));
  if (m.contact) dyn.appendChild(segs(el('p', { className: 'contact' }), m.contact, 'contact'));

  if (m.problems.length) {
    const sec = el('section', { 'aria-labelledby': 'problems-h', className: 'problems' });
    sec.appendChild(el('h2', { id: 'problems-h', text: 'Not working right now' }));
    const ul = el('ul');
    m.problems.forEach((p, i) => ul.appendChild(segs(el('li'), p.segs, `problem-${i}`)));
    sec.appendChild(ul);
    if (m.problemsNote) sec.appendChild(el('p', { className: 'small muted', text: m.problemsNote }));
    dyn.appendChild(sec);
  }
  if (m.showTargets) {
    const sec = el('section', { 'aria-labelledby': 'sites-h' });
    sec.appendChild(el('h2', { id: 'sites-h', text: 'Our sites' }));
    if (m.countLine) sec.appendChild(el('p', { className: 'muted', text: m.countLine }));
    const ul = el('ul', { className: 'cards' });
    m.targets.forEach((c) => ul.appendChild(renderCard(c)));
    sec.appendChild(ul);
    dyn.appendChild(sec);
  }
  document.getElementById('dynamic').replaceWith(dyn);

  const about = document.getElementById('about-text');
  about.replaceChildren(...m.about.map((t) => el('p', { text: t })));

  if (focusKey) {
    const target = document.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`);
    if (target) target.focus({ preventScroll: true });
  }
}

function announce(text) {
  const a = document.getElementById('announcer');
  a.textContent = '';
  // A fresh text node after clearing makes screen readers read repeats too.
  setTimeout(() => { a.textContent = text; }, 50);
}

function currentModel() {
  if (state.failed && !state.data) return loadErrorModel({ ...metaOpts, retrying: state.retrying });
  if (!state.data) return loadingModel(metaOpts);
  return buildModel(state.data, Date.now(), {
    ...metaOpts,
    retrying: state.retrying,
    lastGoodFetchMs: state.lastGoodFetchMs,
    refreshFailedAtMs: state.refreshFailedAtMs,
  });
}

/** Re-render; announce only when the page-wide state sentence changes (design §6.5). */
function update({ announceText = null } = {}) {
  const m = currentModel();
  render(m);
  if (announceText !== null) {
    announce(announceText === '' ? `Status loaded. ${m.stateSentence}` : announceText);
  } else if (state.firstRenderDone && m.stateSentence && m.stateSentence !== state.lastStateSentence) {
    announce(`Update: ${m.stateSentence}`);
  }
  if (m.pageState !== 'loading') state.firstRenderDone = true;
  if (m.stateSentence) state.lastStateSentence = m.stateSentence;
}

async function fetchData() {
  if (!dataUrl) throw new Error('no data url');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), LOAD_TIMEOUT_MS);
  try {
    const res = await fetch(dataUrl, { cache: 'no-store', signal: ctl.signal, credentials: 'omit' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!validateData(data).ok) throw new Error('invalid data');
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** @returns {Promise<boolean>} whether the fetch succeeded */
async function load() {
  state.lastFetchStartMs = Date.now();
  try {
    state.data = await fetchData();
    state.lastGoodFetchMs = Date.now();
    state.refreshFailedAtMs = null;
    state.failed = false;
    return true;
  } catch {
    state.failed = true;
    if (state.data) state.refreshFailedAtMs = Date.now();
    return false;
  }
}

async function onRetry() {
  if (state.retrying) return;
  state.retrying = true;
  update({ announceText: null });
  const ok = await load();
  state.retrying = false;
  if (ok) update({ announceText: '' });
  else update({ announceText: state.data ? "We couldn't get newer information." : "We still can't load the status." });
}

async function refresh() {
  await load();
  update();
}

update();
refresh();
setInterval(() => update(), RECOMPUTE_MS);
setInterval(() => { if (!document.hidden && !state.retrying) refresh(); }, REFETCH_MS);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { state.hiddenAtMs = Date.now(); return; }
  if (state.hiddenAtMs && Date.now() - state.hiddenAtMs > REFETCH_MS) refresh();
  else update();
  state.hiddenAtMs = null;
});
