// Build-time helper for scripts/build-site.mjs (T13). Threat model F2:
// config values never become HTML by string concatenation. Each value only
// ever replaces a "%GU_...%" placeholder inside a content="" attribute, with
// full attribute escaping. The page reads it back with getAttribute and
// renders it with textContent. Not loaded by the page itself.

const KEYS = {
  dataUrl: 'GU_DATA_URL',
  repo: 'GU_REPO',
  siteName: 'GU_SITE_NAME',
  contact: 'GU_CONTACT',
  contactLink: 'GU_CONTACT_LINK',
};

export function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * @param {string} html  site/index.html
 * @param {{dataUrl?, repo?, siteName?, contact?, contactLink?}} values  strings; null/undefined leaves "not set"
 * @returns {string}
 */
export function injectMeta(html, values) {
  let out = html;
  for (const [k, token] of Object.entries(KEYS)) {
    const placeholder = `content="%${token}%"`;
    if (out.split(placeholder).length !== 2) throw new Error(`index.html must contain exactly one ${placeholder}`);
    const v = values[k];
    if (v === null || v === undefined) continue;
    if (typeof v !== 'string') throw new Error(`${k} must be a string`);
    // A value starting with "%" would read as "not set" on the page; refuse it.
    if (v.startsWith('%')) throw new Error(`${k} must not start with %`);
    out = out.replace(placeholder, () => `content="${escapeAttr(v)}"`);
  }
  return out;
}
