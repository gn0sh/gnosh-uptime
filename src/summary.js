// The per-run step summary ($GITHUB_STEP_SUMMARY). Architecture §8 step 10,
// §12. Config values are shown as inert code spans.

import { appendFileSync } from 'node:fs';
import { code, inert } from './issues.js';
import { formatError, skippedTargetCount } from './config.js';

export function writeSummary(markdown, env = process.env) {
  const file = env.GITHUB_STEP_SUMMARY;
  if (!file) return false;
  appendFileSync(file, `${markdown}\n`);
  return true;
}

function errorList(errors) {
  return errors.map((e) => `- ${inert(formatError(e))}`).join('\n');
}

export function validateSummary(errors, configPath) {
  if (errors.length === 0) return `### Config check\n\n\`${configPath}\` has no problems.`;
  return `### Config check\n\n\`${configPath}\` has ${errors.length} problem(s):\n\n${errorList(errors)}`;
}

/**
 * @param {object} r run report: {results, errors, parsed, gap, staleIssue, configIssue,
 *   outages, bytes, warnings, failure}
 */
export function runSummary(r) {
  const out = ['### Monitor run', ''];
  if (r.failure) out.push(`**The run failed:** ${inert(r.failure)}. The previously saved status data was not changed.`, '');
  if (r.results && r.results.length > 0) {
    out.push('| Site | State | What the monitor saw |', '|---|---|---|');
    for (const x of r.results) out.push(`| ${code(x.name)} | ${x.up ? 'up' : 'down'} | ${x.reason ? inert(x.reason) : ''} |`);
    out.push('');
  } else if (r.parsed !== false) {
    out.push('No sites were checked.', '');
  }
  if (r.parsed === false) out.push('The config file could not be read, so nothing was checked and the saved status was kept as it was.', '');
  if (r.errors && r.errors.length > 0) {
    // QA T18 B1: say what the problems actually did to this run.
    const skipped = skippedTargetCount(r.errors);
    let effect;
    if (r.parsed === false || r.held) effect = 'no site was checked this run';
    else if (skipped > 0) effect = `${skipped} site(s) were skipped`;
    else effect = 'no site was skipped; the settings listed use their defaults';
    out.push(`**Config problems (${r.errors.length})** — ${effect}:`, '', errorList(r.errors), '');
  }
  if (r.configIssue && r.configIssue.action !== 'none') out.push(`Config-error issue: ${r.configIssue.action}${r.configIssue.issue ? ` (#${r.configIssue.issue})` : ''}.`);
  if (r.gap) out.push(`Stale gap of ${r.gap.minutes} minutes since the last run (${r.gap.from}): issue ${r.staleIssue?.action ?? 'not opened'}${r.staleIssue?.issue ? ` (#${r.staleIssue.issue})` : ''}.`);
  if (r.outages) {
    const o = r.outages;
    const parts = [['opened', o.opened], ['adopted', o.adopted], ['recovered', o.recovered], ['closed', o.closed]]
      .filter(([, list]) => list.length > 0).map(([k, list]) => `${k} ${list.map((n) => `#${n}`).join(', ')}`);
    if (parts.length > 0) out.push(`Outage issues: ${parts.join('; ')}.`);
  }
  if (Number.isInteger(r.bytes)) out.push(`Status data written: ${r.bytes} bytes.`);
  for (const w of r.warnings ?? []) out.push(`Warning: ${inert(w)}`);
  return out.join('\n').trimEnd();
}
