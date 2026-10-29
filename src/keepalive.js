// Keepalive against the 60-day schedule disable. Architecture §9, ADR-0002.
// One call per run: PUT /repos/{repo}/actions/workflows/{file}/enable.
// Needs only `actions: write`. A failure is a warning, never a failed job.

import { isoSeconds } from './state.js';

/**
 * @returns {Promise<{ok:boolean, status:number|null, at:string}>}
 */
export async function keepalive({ gh, workflowFile = 'monitor.yml', now = () => new Date() }) {
  const at = isoSeconds(now());
  try {
    const res = await gh('PUT', `/repos/${gh.repo}/actions/workflows/${encodeURIComponent(workflowFile)}/enable`, undefined, { allow: [400, 401, 403, 404, 409, 422, 500, 502, 503] });
    return { ok: res.status === 204, status: res.status, at };
  } catch (e) {
    return { ok: false, status: Number.isInteger(e?.status) ? e.status : null, at };
  }
}

/** Lines for the log (a ::warning:: annotation) and the step summary. */
export function keepaliveReport(result, repo) {
  const help = repo ? `https://github.com/${repo}#if-checks-stop` : 'the README section "If checks stop"';
  if (result.ok) {
    return { warning: null, summary: `Keepalive: the scheduled workflow was confirmed as enabled at ${result.at}.` };
  }
  const s = result.status === null ? 'no response' : `HTTP ${result.status}`;
  return {
    warning: `::warning::Keepalive failed (${s}). GitHub may turn off the scheduled checks after 60 days without activity. See ${help}`,
    summary: `Keepalive failed (${s}) at ${result.at}. GitHub may turn off the scheduled checks after 60 days without activity. See [If checks stop](${help}).`,
  };
}
