// An in-memory fake of the parts of the GitHub REST API the monitor uses.
// It records every call. No network.

export const BOT = { login: 'github-actions[bot]', type: 'Bot' };

export class FakeGitHub {
  constructor({ repo = 'gn0sh/gnosh-uptime', defaultBranch = 'main', now = () => new Date() } = {}) {
    this.repo = repo;
    this.defaultBranch = defaultBranch;
    this.now = now;
    this.calls = [];
    this.branches = new Map(); // name -> { files: Map(path -> {content, sha}), commits: [] }
    this.labels = new Map();
    this.issues = [];
    this.nextIssue = 1;
    this.nextSha = 1;
    this.hooks = []; // (method, path, body) => {status, json} | undefined
    this.enableStatus = 204;
  }

  sha() {
    return (this.nextSha++).toString(16).padStart(40, '0');
  }

  /** Stores a file on a branch (test setup). */
  putFile(branch, path, text) {
    if (!this.branches.has(branch)) this.branches.set(branch, { files: new Map(), commits: [] });
    const sha = this.sha();
    this.branches.get(branch).files.set(path, { content: text, sha });
    return sha;
  }

  fileText(branch, path) {
    return this.branches.get(branch)?.files.get(path)?.content ?? null;
  }

  addIssue({ title, body, labels, user = BOT, state = 'open', pull_request } = {}) {
    const issue = {
      number: this.nextIssue++,
      title,
      body,
      labels: labels.map((name) => ({ name })),
      state,
      state_reason: null,
      user: { ...user },
      locked: false,
      comments: [],
      created_at: this.now().toISOString(),
      updated_at: this.now().toISOString(),
    };
    if (pull_request) issue.pull_request = {};
    this.issues.push(issue);
    return issue;
  }

  /** The gh(method, path, body, opts) interface from src/github.js. */
  client() {
    const gh = async (method, path, body, opts = {}) => {
      const res = this.handle(method, path, body === undefined ? undefined : JSON.parse(JSON.stringify(body)));
      if (res.status >= 400 && !(opts.allow ?? []).includes(res.status)) {
        const e = new Error(`GitHub API ${method} ${path.split('?')[0]} returned HTTP ${res.status}`);
        e.name = 'GitHubError';
        e.status = res.status;
        throw e;
      }
      return res;
    };
    gh.repo = this.repo;
    return gh;
  }

  /** A fetch implementation backed by this fake (for testing src/github.js). */
  fetch() {
    return async (url, init = {}) => {
      const u = new URL(url);
      const res = this.handle(init.method ?? 'GET', u.pathname + u.search, init.body ? JSON.parse(init.body) : undefined, init.headers);
      return new Response(res.status === 204 ? null : JSON.stringify(res.json), { status: res.status });
    };
  }

  handle(method, path, body, headers) {
    this.calls.push({ method, path, body, headers });
    for (const h of this.hooks) {
      const r = h(method, path, body);
      if (r) return r;
    }
    const R = `/repos/${this.repo}`;
    const [p, qs] = path.split('?');
    const q = new URLSearchParams(qs ?? '');
    let m;

    if (method === 'GET' && p === `${R}/contents/status.json`) {
      const f = this.branches.get(q.get('ref'))?.files.get('status.json');
      if (!f) return { status: 404, json: { message: 'Not Found' } };
      return { status: 200, json: { sha: f.sha, encoding: 'base64', content: Buffer.from(f.content).toString('base64').replace(/(.{60})/g, '$1\n') } };
    }
    if (method === 'PUT' && p === `${R}/contents/status.json`) {
      const b = this.branches.get(body.branch);
      if (!b) return { status: 404, json: {} };
      const cur = b.files.get('status.json');
      if (cur && body.sha !== cur.sha) return { status: 409, json: { message: 'sha mismatch' } };
      if (!cur && body.sha) return { status: 422, json: {} };
      const sha = this.sha();
      b.files.set('status.json', { content: Buffer.from(body.content, 'base64').toString('utf8'), sha });
      b.commits.push(body.message);
      return { status: cur ? 200 : 201, json: { content: { sha } } };
    }
    if ((m = new RegExp(`^${esc(R)}/git/ref/heads/(.+)$`).exec(p)) && method === 'GET') {
      return this.branches.has(m[1]) ? { status: 200, json: { object: { sha: 'x' } } } : { status: 404, json: {} };
    }
    if (method === 'POST' && p === `${R}/git/blobs`) {
      this._blob = Buffer.from(body.content, 'base64').toString('utf8');
      return { status: 201, json: { sha: this.sha() } };
    }
    if (method === 'POST' && p === `${R}/git/trees`) return { status: 201, json: { sha: this.sha() } };
    if (method === 'POST' && p === `${R}/git/commits`) {
      this._commit = body;
      return { status: 201, json: { sha: this.sha() } };
    }
    if (method === 'POST' && p === `${R}/git/refs`) {
      const name = body.ref.replace('refs/heads/', '');
      if (this.branches.has(name)) return { status: 422, json: {} };
      this.branches.set(name, { files: new Map([['status.json', { content: this._blob, sha: this.sha() }]]), commits: [this._commit.message] });
      return { status: 201, json: {} };
    }
    if (method === 'GET' && p === `${R}/labels`) return { status: 200, json: [...this.labels.values()] };
    if (method === 'POST' && p === `${R}/labels`) {
      if (this.labels.has(body.name)) return { status: 422, json: {} };
      this.labels.set(body.name, body);
      return { status: 201, json: body };
    }
    if (method === 'GET' && p === `${R}/issues`) {
      const label = q.get('labels');
      const state = q.get('state') ?? 'open';
      const since = q.get('since');
      const list = this.issues.filter((i) => (state === 'all' || i.state === state)
        && (!label || i.labels.some((l) => l.name === label))
        && (!since || i.updated_at >= since));
      return { status: 200, json: list.map(view) };
    }
    if (method === 'POST' && p === `${R}/issues`) {
      const issue = this.addIssue({ title: body.title, body: body.body, labels: body.labels ?? [] });
      return { status: 201, json: view(issue) };
    }
    if ((m = new RegExp(`^${esc(R)}/issues/(\\d+)(/comments|/lock)?$`).exec(p))) {
      const issue = this.issues.find((i) => i.number === Number(m[1]));
      if (!issue) return { status: 404, json: {} };
      if (!m[2] && method === 'GET') return { status: 200, json: view(issue) };
      if (!m[2] && method === 'PATCH') {
        for (const k of ['title', 'body', 'state', 'state_reason']) if (k in body) issue[k] = body[k];
        issue.updated_at = this.now().toISOString();
        return { status: 200, json: view(issue) };
      }
      if (m[2] === '/comments' && method === 'POST') {
        issue.comments.push(body.body);
        issue.updated_at = this.now().toISOString();
        return { status: 201, json: {} };
      }
      if (m[2] === '/lock' && method === 'PUT') {
        issue.locked = true;
        issue.lock_reason = body?.lock_reason;
        return { status: 204, json: null };
      }
    }
    if (method === 'PUT' && p === `${R}/actions/workflows/monitor.yml/enable`) return { status: this.enableStatus, json: null };
    return { status: 404, json: { message: `fake: no route for ${method} ${path}` } };
  }

  callsTo(method, re) {
    return this.calls.filter((c) => c.method === method && re.test(c.path));
  }
}

function view(i) {
  return JSON.parse(JSON.stringify({ ...i, comments: i.comments.length }));
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
