import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkTarget, mapLimit } from '../src/check.js';
import { makeTransport, pinnedLookup, requestOptions, mapError } from '../src/transport.js';

const PUBLIC = '93.184.216.34';

/** A recording fake transport driven by a route table: href -> response. */
function recorder(routes) {
  const calls = [];
  const transport = async (req) => {
    calls.push({ href: req.url.href, address: req.address, family: req.family });
    const r = routes[req.url.href];
    if (typeof r === 'function') return r(req);
    if (!r) throw Object.assign(new Error('no route'), { reason: 'connection error' });
    return r;
  };
  return { calls, transport };
}

function resolverFrom(map) {
  const calls = [];
  const resolver = async (host) => {
    calls.push(host);
    const v = map[host];
    if (typeof v === 'function') return v(calls.filter((h) => h === host).length);
    if (v === undefined) throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
    return v.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  return { calls, resolver };
}

const opts = (extra) => ({ timeoutMs: 1000, now: () => new Date('2026-10-28T14:05:03Z'), ...extra });

test('200 is up with checkedAt', async () => {
  const { transport } = recorder({ 'https://a.example.com/': { status: 200, location: null } });
  const { resolver } = resolverFrom({ 'a.example.com': [PUBLIC] });
  assert.deepEqual(await checkTarget('https://a.example.com/', opts({ resolver, transport })), { up: true, reason: null, checkedAt: '2026-10-28T14:05:03Z' });
});

test('301 then 200 is up', async () => {
  const { transport, calls } = recorder({
    'http://a.example.com/': { status: 301, location: 'https://a.example.com/home' },
    'https://a.example.com/home': { status: 200, location: null },
  });
  const { resolver } = resolverFrom({ 'a.example.com': [PUBLIC] });
  const r = await checkTarget('http://a.example.com/', opts({ resolver, transport }));
  assert.equal(r.up, true);
  assert.equal(calls.length, 2);
});

test('404 is down with HTTP 404', async () => {
  const { transport } = recorder({ 'https://a.example.com/': { status: 404, location: null } });
  const { resolver } = resolverFrom({ 'a.example.com': [PUBLIC] });
  assert.deepEqual(await checkTarget('https://a.example.com/', opts({ resolver, transport })), { up: false, reason: 'HTTP 404', checkedAt: '2026-10-28T14:05:03Z' });
});

test('blocked hop on redirect 3: blocked redirect and zero requests to it', async () => {
  const { transport, calls } = recorder({
    'https://a.example.com/1': { status: 302, location: '/2' },
    'https://a.example.com/2': { status: 302, location: 'https://b.example.com/3' },
    'https://b.example.com/3': { status: 302, location: 'http://169.254.169.254/latest/meta-data/' },
    'http://169.254.169.254/latest/meta-data/': { status: 200, location: null },
  });
  const { resolver } = resolverFrom({ 'a.example.com': [PUBLIC], 'b.example.com': [PUBLIC] });
  const r = await checkTarget('https://a.example.com/1', opts({ resolver, transport }));
  assert.equal(r.reason, 'blocked redirect');
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => !c.href.includes('169.254')));
});

test('redirect to a name that resolves to a private address is a blocked redirect', async () => {
  const { transport, calls } = recorder({ 'https://a.example.com/': { status: 302, location: 'https://evil.example.com/' } });
  const { resolver } = resolverFrom({ 'a.example.com': [PUBLIC], 'evil.example.com': ['10.0.0.5'] });
  const r = await checkTarget('https://a.example.com/', opts({ resolver, transport }));
  assert.equal(r.reason, 'blocked redirect');
  assert.equal(calls.length, 1);
});

test('redirects to bad schemes, localhost and bad ports are blocked redirects', async () => {
  for (const loc of ['file:///etc/passwd', 'http://localhost/', 'http://a.example.com:22/', 'https://u:p@a.example.com/']) {
    const { transport, calls } = recorder({ 'https://a.example.com/': { status: 301, location: loc } });
    const { resolver } = resolverFrom({ 'a.example.com': [PUBLIC] });
    const r = await checkTarget('https://a.example.com/', opts({ resolver, transport }));
    assert.equal(r.reason, 'blocked redirect', loc);
    assert.equal(calls.length, 1);
  }
});

test('a 6th hop is too many redirects', async () => {
  const routes = {};
  for (let k = 0; k < 7; k++) routes[`https://a.example.com/${k}`] = { status: 302, location: `/${k + 1}` };
  const { transport, calls } = recorder(routes);
  const { resolver } = resolverFrom({ 'a.example.com': [PUBLIC] });
  const r = await checkTarget('https://a.example.com/0', opts({ resolver, transport }));
  assert.equal(r.reason, 'too many redirects');
  assert.equal(calls.length, 6); // original + 5 redirects
  const five = {};
  for (let k = 0; k < 5; k++) five[`https://a.example.com/${k}`] = { status: 302, location: `/${k + 1}` };
  five['https://a.example.com/5'] = { status: 200, location: null };
  const ok = await checkTarget('https://a.example.com/0', opts({ resolver, transport: recorder(five).transport }));
  assert.equal(ok.up, true);
});

test('3xx without Location and with an unparseable Location are down', async () => {
  const { resolver } = resolverFrom({ 'a.example.com': [PUBLIC] });
  const r1 = await checkTarget('https://a.example.com/', opts({ resolver, transport: recorder({ 'https://a.example.com/': { status: 302, location: null } }).transport }));
  assert.equal(r1.reason, 'HTTP 302');
  const r2 = await checkTarget('https://a.example.com/', opts({ resolver, transport: recorder({ 'https://a.example.com/': { status: 301, location: 'http://[::1' } }).transport }));
  assert.equal(r2.reason, 'HTTP 301');
});

test('C10 rebinding: resolver gives public then loopback; transport sees only the public IP; one resolve per hop', async () => {
  const { resolver, calls: rcalls } = resolverFrom({ 'a.example.com': (n) => [{ address: n === 1 ? PUBLIC : '127.0.0.1', family: 4 }] });
  const { transport, calls } = recorder({ 'https://a.example.com/': { status: 200, location: null } });
  const r = await checkTarget('https://a.example.com/', opts({ resolver, transport }));
  assert.equal(r.up, true);
  assert.deepEqual(rcalls, ['a.example.com']);
  assert.deepEqual(calls.map((c) => c.address), [PUBLIC]);
});

test('one resolve per hop across redirects', async () => {
  const { resolver, calls: rcalls } = resolverFrom({ 'a.example.com': [PUBLIC], 'b.example.com': [PUBLIC] });
  const { transport } = recorder({ 'https://a.example.com/': { status: 301, location: 'https://b.example.com/' }, 'https://b.example.com/': { status: 200, location: null } });
  await checkTarget('https://a.example.com/', opts({ resolver, transport }));
  assert.deepEqual(rcalls, ['a.example.com', 'b.example.com']);
});

test('mixed A records (public + private) are blocked with no request', async () => {
  const { resolver } = resolverFrom({ 'a.example.com': [PUBLIC, '192.168.0.10'] });
  const { transport, calls } = recorder({ 'https://a.example.com/': { status: 200, location: null } });
  const r = await checkTarget('https://a.example.com/', opts({ resolver, transport }));
  assert.equal(r.reason, 'blocked address');
  assert.equal(calls.length, 0);
});

test('AAAA mapped loopback answer is blocked', async () => {
  const { resolver } = resolverFrom({ 'a.example.com': ['::ffff:127.0.0.1'] });
  const { transport, calls } = recorder({});
  assert.equal((await checkTarget('https://a.example.com/', opts({ resolver, transport }))).reason, 'blocked address');
  assert.equal(calls.length, 0);
});

test('literal IP is not resolved; DNS failure; empty answer; transport error reasons', async () => {
  const { resolver, calls: rcalls } = resolverFrom({});
  const { transport, calls } = recorder({ [`https://${PUBLIC}/`]: { status: 200, location: null } });
  assert.equal((await checkTarget(`https://${PUBLIC}/`, opts({ resolver, transport }))).up, true);
  assert.equal(rcalls.length, 0);
  assert.equal(calls[0].address, PUBLIC);
  assert.equal((await checkTarget('https://nx.example.com/', opts({ resolver, transport }))).reason, 'DNS failure');
  const empty = resolverFrom({ 'e.example.com': [] }).resolver;
  assert.equal((await checkTarget('https://e.example.com/', opts({ resolver: empty, transport }))).reason, 'DNS failure');
  const tls = async () => { throw Object.assign(new Error('x'), { reason: 'TLS error' }); };
  assert.equal((await checkTarget(`https://${PUBLIC}/`, opts({ resolver, transport: tls }))).reason, 'TLS error');
  const raw = async () => { throw new Error('ECONNRESET with secret text'); };
  assert.equal((await checkTarget(`https://${PUBLIC}/`, opts({ resolver, transport: raw }))).reason, 'connection error');
});

test('K4: a hanging target times out while a healthy one in the same run is up', async () => {
  const { resolver } = resolverFrom({ 'hang.example.com': [PUBLIC], 'ok.example.com': ['1.1.1.1'] });
  const transport = (req) => (req.url.hostname === 'hang.example.com'
    ? new Promise(() => {}) // never settles, ignores the signal
    : Promise.resolve({ status: 200, location: null }));
  const started = Date.now();
  const res = await mapLimit(['https://hang.example.com/', 'https://ok.example.com/'], 5, (u) => checkTarget(u, { resolver, transport, timeoutMs: 80 }));
  assert.equal(res[0].value.reason, 'timeout');
  assert.equal(res[1].value.up, true);
  assert.ok(Date.now() - started < 1000);
});

test('F13: a DNS lookup that never returns still times out on time', async () => {
  const resolver = () => new Promise(() => {});
  const started = Date.now();
  const r = await checkTarget('https://slow.example.com/', { resolver, transport: async () => ({ status: 200 }), timeoutMs: 60 });
  assert.equal(r.reason, 'timeout');
  assert.ok(Date.now() - started < 500);
});

test('the deadline covers all hops together', async () => {
  const { resolver } = resolverFrom({ 'a.example.com': [PUBLIC] });
  const slow = (req) => new Promise((resolve) => setTimeout(() => resolve(req.url.pathname === '/3' ? { status: 200 } : { status: 302, location: `/${Number(req.url.pathname.slice(1) || 0) + 1}` }), 30));
  const r = await checkTarget('https://a.example.com/0', { resolver, transport: slow, timeoutMs: 70 });
  assert.equal(r.reason, 'timeout');
});

test('mapLimit runs at most N at once and reports rejections', async () => {
  let inFlight = 0;
  let max = 0;
  const res = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 5, async (x) => {
    inFlight++;
    max = Math.max(max, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    if (x === 3) throw new Error('boom');
    return x * 2;
  });
  assert.equal(max, 5);
  assert.equal(res[2].status, 'rejected');
  assert.equal(res[7].value, 16);
});

test('pinnedLookup supports both callback shapes', () => {
  const seen = [];
  const lk = pinnedLookup(PUBLIC, 4, (h, o) => seen.push([h, o]));
  lk('evil.example', { all: true }, (err, list) => assert.deepEqual(list, [{ address: PUBLIC, family: 4 }]));
  lk('evil.example', { hints: 32 }, (err, addr, fam) => { assert.equal(addr, PUBLIC); assert.equal(fam, 4); });
  lk('evil.example', (err, addr) => assert.equal(addr, PUBLIC));
  assert.equal(seen.length, 3);
});

test('requestOptions: servername is the hostname for names and unset for IP literals; agent false; no autoSelectFamily', () => {
  const signal = new AbortController().signal;
  const a = requestOptions({ url: new URL('https://Shop.Example.com./x?y=1'), address: PUBLIC, family: 4, signal, userAgent: 'ua' });
  assert.equal(a.servername, 'shop.example.com');
  assert.equal(a.agent, false);
  assert.equal(a.autoSelectFamily, false);
  assert.equal(a.rejectUnauthorized, true);
  assert.equal(a.path, '/x?y=1');
  assert.equal(a.headers.host, 'shop.example.com.');
  const b = requestOptions({ url: new URL('https://[2606:4700::1]:8443/'), address: '2606:4700::1', family: 6, signal, userAgent: 'ua' });
  assert.equal(b.servername, undefined);
  assert.equal(b.host, '2606:4700::1');
  assert.equal(b.port, 8443);
  const c = requestOptions({ url: new URL(`https://${PUBLIC}/`), address: PUBLIC, family: 4, signal, userAgent: 'ua' });
  assert.equal(c.servername, undefined);
});

test('mapError maps codes to the fixed vocabulary', () => {
  assert.equal(mapError({ code: 'ENOTFOUND' }), 'DNS failure');
  assert.equal(mapError({ code: 'EAI_AGAIN' }), 'DNS failure');
  assert.equal(mapError({ code: 'CERT_HAS_EXPIRED' }), 'TLS error');
  assert.equal(mapError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }), 'TLS error');
  assert.equal(mapError({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }), 'TLS error');
  assert.equal(mapError({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }), 'TLS error');
  assert.equal(mapError({ name: 'AbortError' }), 'timeout');
  assert.equal(mapError({ code: 'ECONNREFUSED' }), 'connection error');
});

test('real transport: connects to the pinned address, sends the original Host header, lookup called once, body never read', async (t) => {
  let seen = null;
  const server = http.createServer((req, res) => {
    seen = { host: req.headers.host, url: req.url, ua: req.headers['user-agent'] };
    res.writeHead(301, { location: 'https://next.example.com/', 'x-secret': 'nope' });
    res.write('x'.repeat(100000));
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const { port } = server.address();
  const lookups = [];
  const transport = makeTransport({ userAgent: 'gnosh-uptime-test', onLookup: (h, o) => lookups.push([h, o]) });
  const res = await transport({ url: new URL(`http://evil.example:${port}/p?q=1`), address: '127.0.0.1', family: 4, signal: new AbortController().signal });
  assert.deepEqual(res, { status: 301, location: 'https://next.example.com/' });
  assert.equal(seen.host, `evil.example:${port}`);
  assert.equal(seen.url, '/p?q=1');
  assert.equal(seen.ua, 'gnosh-uptime-test');
  assert.equal(lookups.length, 1);
  assert.equal(lookups[0][0], 'evil.example');
});

test('real transport: connection refused maps to connection error, abort to timeout', async () => {
  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  const transport = makeTransport();
  await assert.rejects(transport({ url: new URL(`http://x.example:${port}/`), address: '127.0.0.1', family: 4, signal: new AbortController().signal }), (e) => e.reason === 'connection error');
  const hang = http.createServer(() => {});
  await new Promise((r) => hang.listen(0, '127.0.0.1', r));
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 50);
  await assert.rejects(transport({ url: new URL(`http://x.example:${hang.address().port}/`), address: '127.0.0.1', family: 4, signal: ac.signal }), (e) => e.reason === 'timeout');
  hang.closeAllConnections();
  hang.close();
});

test('pinnedLookup works under Node http with autoSelectFamily on and off (lookup called once each)', async (t) => {
  const server = http.createServer((req, res) => { res.writeHead(204); res.end(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  for (const autoSelectFamily of [true, false]) {
    const seen = [];
    const status = await new Promise((resolve, reject) => {
      const req = http.request({ host: 'evil.example', port: server.address().port, path: '/', agent: false, autoSelectFamily, lookup: pinnedLookup('127.0.0.1', 4, (h, o) => seen.push(o)) }, (res) => { res.destroy(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 204);
    assert.equal(seen.length, 1, `autoSelectFamily ${autoSelectFamily}`);
  }
});
