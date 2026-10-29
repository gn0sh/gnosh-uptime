// SSRF defense: URL syntax rules, host normalization and the address blocklist.
// Architecture §6.1 and §6.2, ADR-0006.

import net from 'node:net';

const IPV4_BLOCKED = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255
  ['168.63.129.16', 32], // Azure host agent
];

const IPV6_BLOCKED = [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
  ['2001:db8::', 32],
  ['100::', 64],
  // Beyond the architecture table (threat model F8): local-use NAT64 and
  // Teredo, whose embedded IPv4 is obfuscated. Neither hosts public sites.
  ['64:ff9b:1::', 48],
  ['2001::', 32],
];

const blockList = new net.BlockList();
for (const [addr, prefix] of IPV4_BLOCKED) blockList.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of IPV6_BLOCKED) blockList.addSubnet(addr, prefix, 'ipv6');

const globalUnicast = new net.BlockList();
globalUnicast.addSubnet('2000::', 3, 'ipv6');

const BLOCKED_NAME_SUFFIXES = ['.localhost', '.local', '.internal'];

// Plain-language reasons (design §10.4). Codes are stable for tests and callers.
export const URL_REASONS = {
  invalid: 'This is not a web address the monitor can read. It should look like https://www.example.com/.',
  scheme: 'The address must start with https:// or http://.',
  userinfo: 'The address contains a username or password. Remove it; everything in this file is public.',
  'local-name': 'The address is a local name (like localhost). The monitor only checks public websites.',
  'blocked-address': 'The address points to a private or local network address. The monitor only checks public websites.',
  'single-label': 'The address needs a full domain name with a dot in it, like example.com.',
  'bad-port': 'The address uses a port the monitor does not check. Remove the :port part, or use a normal web port such as 443, 80 or 8080.',
};

// Port 0 plus the Fetch standard's "bad port" list (threat model F7).
export const BAD_PORTS = new Set([
  0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102, 103, 104,
  109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515,
  526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049,
  3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

function fail(code) {
  return { ok: false, code, reason: URL_REASONS[code] };
}

/** Normalizes a URL hostname: lowercase, brackets stripped, trailing dots stripped. */
export function normalizeHost(hostname) {
  let host = String(hostname).toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  host = host.replace(/\.+$/, '');
  return host;
}

/** True when the (already normalized) name is local by its suffix. */
export function isBlockedName(host) {
  if (host === 'localhost') return true;
  return BLOCKED_NAME_SUFFIXES.some((s) => host.endsWith(s));
}

/**
 * Checks URL syntax and host rules. Literal IPs are checked against the
 * blocklist here, before any DNS lookup.
 * @returns {{ok:true, url:URL, host:string} | {ok:false, code:string, reason:string}}
 */
export function checkUrlSyntax(str) {
  if (typeof str !== 'string' || str.trim() === '') return fail('invalid');
  let url;
  try {
    url = new URL(str.trim());
  } catch {
    return fail('invalid');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail('scheme');
  if (url.username !== '' || url.password !== '') return fail('userinfo');
  if (url.port !== '' && BAD_PORTS.has(Number(url.port))) return fail('bad-port');
  const host = normalizeHost(url.hostname);
  if (host === '') return fail('invalid');
  if (net.isIP(host) !== 0) {
    if (isBlockedAddress(host)) return fail('blocked-address');
    return { ok: true, url, host };
  }
  if (isBlockedName(host)) return fail('local-name');
  const labels = host.split('.');
  if (labels.some((l) => l === '')) return fail('invalid');
  if (labels.length < 2) return fail('single-label');
  return { ok: true, url, host };
}

/** Expands an IPv6 string into 8 numeric hextets, or null if it isn't one. */
export function expandIPv6(ip) {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  if (net.isIPv6(s) === false) return null;
  // Convert a trailing dotted IPv4 into two hextets.
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const o = tail.split('.').map(Number);
    s = `${s.slice(0, lastColon + 1)}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const [head, rest] = s.includes('::') ? s.split('::') : [s, null];
  const headParts = head === '' ? [] : head.split(':');
  const restParts = rest === null || rest === '' ? [] : rest.split(':');
  const fill = rest === null ? 0 : 8 - headParts.length - restParts.length;
  const parts = [...headParts, ...Array(fill).fill('0'), ...restParts].map((h) => parseInt(h, 16));
  if (parts.length !== 8 || parts.some((n) => Number.isNaN(n))) return null;
  return parts;
}

function v4FromHextets(hi, lo) {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * Returns the IPv4 address embedded in an IPv6 address (mapped, compatible,
 * NAT64 well-known prefix, 6to4), or null.
 */
export function embeddedIPv4(ip) {
  const h = expandIPv6(ip);
  if (!h) return null;
  const zeros = (from, to) => h.slice(from, to).every((x) => x === 0);
  // ::ffff:a.b.c.d (mapped)
  if (zeros(0, 5) && h[5] === 0xffff) return v4FromHextets(h[6], h[7]);
  // ::a.b.c.d (compatible), excluding :: and ::1
  if (zeros(0, 6) && !(h[6] === 0 && (h[7] === 0 || h[7] === 1))) return v4FromHextets(h[6], h[7]);
  // 64:ff9b::/96 (NAT64)
  if (h[0] === 0x64 && h[1] === 0xff9b && zeros(2, 6)) return v4FromHextets(h[6], h[7]);
  // 2002::/16 (6to4), IPv4 in bits 16 to 47
  if (h[0] === 0x2002) return v4FromHextets(h[1], h[2]);
  return null;
}

/** True if the address must never be connected to. Non-IP input is blocked. */
export function isBlockedAddress(ip) {
  if (typeof ip !== 'string') return true;
  let addr = ip.trim().toLowerCase();
  if (addr.startsWith('[') && addr.endsWith(']')) addr = addr.slice(1, -1);
  const zone = addr.indexOf('%');
  if (zone !== -1) addr = addr.slice(0, zone);
  const family = net.isIP(addr);
  if (family === 4) return blockList.check(addr, 'ipv4');
  if (family === 6) {
    if (blockList.check(addr, 'ipv6')) return true;
    const v4 = embeddedIPv4(addr);
    if (v4 !== null) return blockList.check(v4, 'ipv4');
    // Threat model F8: outside the embedded-IPv4 forms, allow only global
    // unicast 2000::/3 (the deny list above still applies within it).
    return !globalUnicast.check(addr, 'ipv6');
  }
  return true;
}
