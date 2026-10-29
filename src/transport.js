// Default HTTP transport: node:http/https with the connect address pinned
// through a lookup override. Architecture §6.4, ADR-0006, threat model ask 3.
// The response body is never read (K3); only the status and Location are kept.

import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { normalizeHost } from './ssrf.js';
import { REASON } from './reasons.js';

/**
 * A dns.lookup replacement that ignores the hostname and returns only the
 * pinned address. Supports both callback shapes (options.all true or not).
 */
export function pinnedLookup(address, family, onCall = () => {}) {
  return function lookup(hostname, options, cb) {
    if (typeof options === 'function') {
      cb = options;
      options = {};
    }
    onCall(hostname, options);
    if (options && options.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
}

/** Builds the request options. Pure, so the TLS name rules can be tested. */
export function requestOptions({ url, address, family, signal, userAgent, onLookup }) {
  const host = normalizeHost(url.hostname);
  const isIp = net.isIP(host) !== 0;
  const opts = {
    host,
    port: url.port === '' ? undefined : Number(url.port),
    path: `${url.pathname}${url.search}`,
    method: 'GET',
    headers: { host: url.host, 'user-agent': userAgent, accept: '*/*' },
    lookup: pinnedLookup(address, family, onLookup),
    autoSelectFamily: false,
    signal,
    agent: false,
  };
  if (url.protocol === 'https:') {
    opts.rejectUnauthorized = true;
    if (!isIp) opts.servername = host;
  }
  return opts;
}

/** Maps a Node network error to the fixed reason vocabulary. */
export function mapError(e) {
  const code = String(e?.code ?? '');
  if (e?.name === 'AbortError' || code === 'ABORT_ERR') return REASON.timeout;
  if (code === 'ENOTFOUND' || code.startsWith('EAI_')) return REASON.dns;
  if (code.startsWith('CERT_') || code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_') || code.includes('SELF_SIGNED')
    || code.startsWith('UNABLE_TO_') || code === 'HOSTNAME_MISMATCH' || code === 'EPROTO') return REASON.tls;
  return REASON.connection;
}

/**
 * @returns {(req:{url:URL, address:string, family:4|6, signal:AbortSignal}) => Promise<{status:number, location:string|null}>}
 */
export function makeTransport({ userAgent = 'gnosh-uptime', onLookup } = {}) {
  return function transport({ url, address, family, signal }) {
    const mod = url.protocol === 'https:' ? https : http;
    const opts = requestOptions({ url, address, family, signal, userAgent, onLookup });
    return new Promise((resolve, reject) => {
      let settled = false;
      const req = mod.request(opts, (res) => {
        settled = true;
        const status = res.statusCode;
        const loc = res.headers.location;
        res.destroy();
        resolve({ status, location: typeof loc === 'string' ? loc : null });
      });
      req.on('error', (e) => {
        if (!settled) {
          settled = true;
          const err = new Error('request failed');
          err.reason = mapError(e);
          reject(err);
        }
      });
      req.end();
    });
  };
}
