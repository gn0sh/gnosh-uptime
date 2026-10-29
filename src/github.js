// Tiny GitHub REST client over fetch. Architecture §8.4.
// The token is only ever placed in the authorization header. It is never
// logged and never part of an error message.

export class GitHubError extends Error {
  constructor(method, path, status) {
    super(`GitHub API ${method} ${path.split('?')[0]} returned HTTP ${status}`);
    this.name = 'GitHubError';
    this.status = status;
  }
}

const REPO_RE = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

export function isValidRepo(repo) {
  return typeof repo === 'string' && REPO_RE.test(repo);
}

/**
 * @returns {(method:string, path:string, body?:object, opts?:{allow?:number[]}) => Promise<{status:number, json:any}>}
 *   with a `.repo` property. Throws GitHubError on status >= 400 unless the
 *   status is listed in opts.allow.
 */
export function makeGitHub({ token, repo, fetchImpl = globalThis.fetch, apiBase = 'https://api.github.com', timeoutMs = 30000 }) {
  if (!isValidRepo(repo)) throw new Error('GITHUB_REPOSITORY is missing or not in owner/name form');
  if (typeof token !== 'string' || token === '') throw new Error('GITHUB_TOKEN is missing');
  async function gh(method, path, body, opts = {}) {
    const headers = {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'gnosh-uptime',
    };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetchImpl(`${apiBase}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = res.status === 204 ? '' : await res.text();
    let json = null;
    if (text !== '') {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (res.status >= 400 && !(opts.allow ?? []).includes(res.status)) throw new GitHubError(method, path, res.status);
    return { status: res.status, json };
  }
  gh.repo = repo;
  return gh;
}
