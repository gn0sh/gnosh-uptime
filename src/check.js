// One check per target: validate, resolve once per hop, pin the address,
// follow redirects by hand (at most 5), one deadline for the whole check.
// Architecture §6.3, ADR-0006, threat model F13.

import dns from 'node:dns';
import net from 'node:net';
import { checkUrlSyntax, isBlockedAddress } from './ssrf.js';
import { REASON, httpReason } from './reasons.js';
import { makeTransport } from './transport.js';
import { isoSeconds } from './state.js';

export async function defaultResolver(hostname) {
  return dns.promises.lookup(hostname, { all: true, order: 'ipv4first' });
}

const defaultTransport = makeTransport();

/**
 * @returns {Promise<{up:boolean, reason:string|null, checkedAt:string}>}
 */
export async function checkTarget(url, opts) {
  const { resolver = defaultResolver, transport = defaultTransport, timeoutMs, maxHops = 5, now = () => new Date() } = opts;
  const checkedAt = isoSeconds(now());
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(REASON.timeout);
    }, timeoutMs);
  });
  try {
    // Promise.race: a lookup that can't be aborted still ends on time (F13).
    const reason = await Promise.race([hops(url, { resolver, transport, maxHops, signal: controller.signal }), deadline]);
    return { up: reason === null, reason, checkedAt };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

/** Returns null when up, otherwise a reason from the fixed vocabulary. */
async function hops(startUrl, { resolver, transport, maxHops, signal }) {
  let current = startUrl;
  for (let hop = 0; ; hop++) {
    const syntax = checkUrlSyntax(current);
    if (!syntax.ok) return hop === 0 ? REASON.blockedAddress : REASON.blockedRedirect;
    const { url, host } = syntax;

    let addresses;
    const literal = net.isIP(host);
    if (literal !== 0) {
      addresses = [{ address: host, family: literal }];
    } else {
      try {
        addresses = await resolver(host);
      } catch {
        if (signal.aborted) return REASON.timeout;
        return REASON.dns;
      }
      if (signal.aborted) return REASON.timeout;
    }
    if (!Array.isArray(addresses) || addresses.length === 0) return REASON.dns;
    // Any blocked answer makes the whole answer hostile.
    if (addresses.some((a) => !a || isBlockedAddress(a.address))) return hop === 0 ? REASON.blockedAddress : REASON.blockedRedirect;

    const pinned = addresses[0];
    const family = pinned.family === 6 || net.isIPv6(pinned.address) ? 6 : 4;
    let res;
    try {
      res = await transport({ url, address: pinned.address, family, signal });
    } catch (e) {
      if (signal.aborted) return REASON.timeout;
      return typeof e?.reason === 'string' ? e.reason : REASON.connection;
    }
    const status = Number(res?.status);
    if (!Number.isInteger(status) || status < 100 || status > 599) return REASON.connection;
    if (status >= 200 && status < 300) return null;
    if (status >= 300 && status < 400 && typeof res.location === 'string' && res.location !== '') {
      let next;
      try {
        next = new URL(res.location, url).href;
      } catch {
        return httpReason(status); // an unparseable Location is down (F13)
      }
      if (hop + 1 > maxHops) return REASON.tooManyRedirects;
      current = next;
      continue;
    }
    return httpReason(status);
  }
}

/** Runs fn over items with at most `limit` in flight; returns allSettled results. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const k = next++;
      try {
        results[k] = { status: 'fulfilled', value: await fn(items[k], k) };
      } catch (reason) {
        results[k] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
