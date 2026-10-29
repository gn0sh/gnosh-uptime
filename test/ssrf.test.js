import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkUrlSyntax, isBlockedAddress, embeddedIPv4, expandIPv6 } from '../src/ssrf.js';

const blockedAddresses = [
  // one entry per IPv4 range in §6.2
  '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.254',
  '127.0.0.1', '127.255.0.9', '169.254.169.254', '172.16.0.1', '172.31.255.255',
  '192.0.0.8', '192.0.2.1', '192.168.1.1', '198.18.0.1', '198.19.255.255',
  '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.250', '240.0.0.1',
  '255.255.255.255', '168.63.129.16',
  // one entry per IPv6 range
  '::', '::1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1',
  '2001:db8::1', '100::1',
  // embedded IPv4 forms
  '::ffff:127.0.0.1', '::ffff:7f00:1', '::127.0.0.1', '::7f00:1', '64:ff9b::7f00:1',
  '64:ff9b::10.0.0.1', '2002:7f00:1::', '2002:a9fe:a9fe::1', '::ffff:169.254.169.254',
  '::ffff:a9fe:a9fe', '::ffff:0:0',
  // not an IP at all
  'example.com', '',
];

const publicAddresses = [
  '93.184.216.34', '1.1.1.1', '8.8.8.8', '172.32.0.1', '100.128.0.1', '11.0.0.1',
  '2606:2800:220:1:248:1893:25c8:1946', '2a00:1450:4001:82a::200e', '::ffff:93.184.216.34',
  '64:ff9b::5db8:d822', '2002:5db8:d822::1',
];

for (const ip of blockedAddresses) {
  test(`isBlockedAddress blocks ${JSON.stringify(ip)}`, () => assert.equal(isBlockedAddress(ip), true));
}
for (const ip of publicAddresses) {
  test(`isBlockedAddress allows ${ip}`, () => assert.equal(isBlockedAddress(ip), false));
}

const rejectedUrls = [
  // encodings of loopback (WHATWG normalizes them; re-verified on this Node)
  ['http://2130706433/', 'blocked-address'],
  ['http://0177.0.0.1/', 'blocked-address'],
  ['http://0x7f.0.0.1/', 'blocked-address'],
  ['http://0x7f000001/', 'blocked-address'],
  ['http://127.1/', 'blocked-address'],
  ['http://[::ffff:127.0.0.1]/', 'blocked-address'],
  ['http://[::ffff:7f00:1]/', 'blocked-address'],
  ['http://[::127.0.0.1]/', 'blocked-address'],
  ['http://[64:ff9b::7f00:1]/', 'blocked-address'],
  ['http://[2002:7f00:1::]/', 'blocked-address'],
  ['http://169.254.169.254/latest/meta-data/', 'blocked-address'],
  ['http://168.63.129.16/', 'blocked-address'],
  ['http://10.1.2.3:8080/', 'blocked-address'],
  ['https://[::1]/', 'blocked-address'],
  ['https://[fe80::1]/', 'blocked-address'],
  // names
  ['http://localhost/', 'local-name'],
  ['http://localhost./', 'local-name'],
  ['http://LOCALHOST/', 'local-name'],
  ['http://x.localhost/', 'local-name'],
  ['http://a.local/', 'local-name'],
  ['http://b.internal/', 'local-name'],
  ['http://b.internal./', 'local-name'],
  ['http://intranet/', 'single-label'],
  // userinfo
  ['https://user:pass@example.com/', 'userinfo'],
  ['https://user@example.com/', 'userinfo'],
  // schemes
  ['file:///etc/passwd', 'scheme'],
  ['ftp://example.com/', 'scheme'],
  ['gopher://example.com/', 'scheme'],
  ['data:text/html,hi', 'scheme'],
  ['javascript:alert(1)', 'scheme'],
  // garbage
  ['not a url', 'invalid'],
  ['', 'invalid'],
];

for (const [url, code] of rejectedUrls) {
  test(`checkUrlSyntax rejects ${url || '(empty)'} as ${code}`, () => {
    const r = checkUrlSyntax(url);
    assert.equal(r.ok, false);
    assert.equal(r.code, code);
    assert.equal(typeof r.reason, 'string');
  });
}

for (const url of ['https://example.com/', 'http://example.com:8080/x?y=1', 'https://93.184.216.34/', 'https://www.Example.COM./', 'https://[2606:2800:220:1:248:1893:25c8:1946]/', 'https://bücher.example/']) {
  test(`checkUrlSyntax accepts ${url}`, () => {
    const r = checkUrlSyntax(url);
    assert.equal(r.ok, true, r.reason);
    assert.ok(r.url instanceof URL);
  });
}

test('WHATWG URL normalizes non-canonical IPv4 forms on this Node version', () => {
  for (const h of ['2130706433', '0177.0.0.1', '0x7f.0.0.1', '0x7f000001', '127.1']) {
    assert.equal(new URL(`http://${h}/`).hostname, '127.0.0.1');
  }
});

test('expandIPv6 and embeddedIPv4', () => {
  assert.deepEqual(expandIPv6('::1'), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(expandIPv6('::ffff:1.2.3.4'), [0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
  assert.equal(expandIPv6('nope'), null);
  assert.equal(embeddedIPv4('::ffff:7f00:1'), '127.0.0.1');
  assert.equal(embeddedIPv4('2002:c0a8:101::'), '192.168.1.1');
  assert.equal(embeddedIPv4('::1'), null);
  assert.equal(embeddedIPv4('2606:2800::1'), null);
});

// Threat model F7: port 0 and the Fetch bad-port list
for (const url of ['https://example.com:0/', 'http://example.com:22/', 'http://example.com:25/', 'https://example.com:6667/', 'http://example.com:10080/']) {
  test(`checkUrlSyntax rejects bad port in ${url}`, () => {
    const r = checkUrlSyntax(url);
    assert.equal(r.ok, false);
    assert.equal(r.code, 'bad-port');
  });
}
for (const url of ['https://example.com:443/', 'http://example.com:80/', 'http://example.com:8080/', 'https://example.com:8443/']) {
  test(`checkUrlSyntax allows normal port in ${url}`, () => assert.equal(checkUrlSyntax(url).ok, true));
}

// Threat model F8: IPv6 outside 2000::/3, Teredo and local NAT64
for (const ip of ['fec0::1', '4000::1', 'e000::1', '2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '64:ff9b:1::1', '::ffff:10.0.0.1', '2606:4700::1%eth0'.replace('2606:4700::1', 'fe80::2')]) {
  test(`isBlockedAddress blocks IPv6 ${ip}`, () => assert.equal(isBlockedAddress(ip), true));
}
test('isBlockedAddress does not throw on zone ids and allows a global address with one', () => {
  assert.equal(isBlockedAddress('2606:4700::1%eth0'), false);
});
