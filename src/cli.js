#!/usr/bin/env node
// Entry point: node src/cli.js run | validate | keepalive
// Architecture §5 (validate), §8 (run), §9 (keepalive).
// Exit codes: validate exits 1 on config errors. run exits 0 even with config
// errors and non-zero only on an infrastructure failure. keepalive always 0.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseConfig, formatError, CONFIG_PATH, WORKFLOW_PATH } from './config.js';
import { makeGitHub } from './github.js';
import { readData, writeData } from './datastore.js';
import { applyRun, detectGap } from './state.js';
import { checkTarget, mapLimit } from './check.js';
import { makeTransport } from './transport.js';
import { REASON } from './reasons.js';
import { ensureLabels, listBotIssues, syncOutages, syncConfigErrorIssue, reportStaleGap } from './issues.js';
import { keepalive, keepaliveReport } from './keepalive.js';
import { runSummary, validateSummary, writeSummary } from './summary.js';

export const CHECK_CONCURRENCY = 5;

function readText(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

function loadConfig(root) {
  const configText = readText(join(root, CONFIG_PATH));
  const workflowText = readText(join(root, WORKFLOW_PATH));
  return { cfg: parseConfig(configText, workflowText), workflowFound: workflowText !== null };
}

/**
 * @param {string[]} argv
 * @param {object} deps injectable: env, root, gh, fetchImpl, resolver, transport, now, log, error
 * @returns {Promise<number>} exit code
 */
export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const root = deps.root ?? process.cwd();
  const log = deps.log ?? ((s) => process.stdout.write(`${s}\n`));
  const error = deps.error ?? ((s) => process.stderr.write(`${s}\n`));
  const now = deps.now ?? (() => new Date());
  const cmd = argv[0];

  if (cmd === 'validate') {
    const { cfg, workflowFound } = loadConfig(root);
    if (!workflowFound) log(`Note: ${WORKFLOW_PATH} was not found, so the check interval is assumed to be about 15 minutes.`);
    if (cfg.errors.length === 0) {
      log(`${CONFIG_PATH} has no problems. ${cfg.targets.length} site(s) will be checked.`);
    } else {
      log(`${CONFIG_PATH} has ${cfg.errors.length} problem(s):`);
      for (const e of cfg.errors) log(`- ${formatError(e)}`);
    }
    writeSummary(validateSummary(cfg.errors, CONFIG_PATH), env);
    return cfg.errors.length === 0 ? 0 : 1;
  }

  if (cmd === 'keepalive') {
    let result;
    try {
      const gh = deps.gh ?? makeGitHub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, fetchImpl: deps.fetchImpl });
      result = await keepalive({ gh, workflowFile: 'monitor.yml', now });
    } catch {
      result = { ok: false, status: null, at: now().toISOString() };
    }
    const rep = keepaliveReport(result, env.GITHUB_REPOSITORY);
    if (rep.warning) log(rep.warning);
    else log(rep.summary);
    writeSummary(`### Keepalive\n\n${rep.summary}`, env);
    return 0;
  }

  if (cmd === 'run') return run({ env, root, log, error, now, deps });

  error('Usage: node src/cli.js run | validate | keepalive');
  return 2;
}

async function run({ env, root, log, error, now, deps }) {
  const report = { warnings: [], results: [] };
  const warn = (w) => {
    report.warnings.push(w);
    log(`::warning::${w}`);
  };
  let issueFailures = 0;
  // Issue steps never stop the checks or the data write (review F3): a failure
  // is a warning, the data is still written, and the exit code is 1.
  const issueStep = async (label, fn, fallback = undefined) => {
    try {
      return await fn();
    } catch (e) {
      // 410: Issues are turned off in this repo. Warn, but don't fail every run.
      if (e?.status !== 410) issueFailures++;
      warn(`${label} failed (${e?.status ? `HTTP ${e.status}` : 'error'}). Issues will be brought up to date on a later run.`);
      return fallback;
    }
  };
  const { cfg } = loadConfig(root);
  report.errors = cfg.errors;
  report.parsed = cfg.parsed;
  for (const e of cfg.errors) log(`Config problem: ${formatError(e)}`);
  // SC-11 and review F2: with no valid target (unreadable file, "targets"
  // missing or misspelled, or every entry invalid), check nothing and keep the
  // saved data, so nothing is wiped and the page goes stale honestly.
  const hold = !cfg.parsed || cfg.targets.length === 0;
  report.held = hold;

  try {
    const gh = deps.gh ?? makeGitHub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY, fetchImpl: deps.fetchImpl });
    const transport = deps.transport ?? makeTransport({ userAgent: `gnosh-uptime (+https://github.com/${gh.repo})` });

    // 2. previous state and its sha (a failure here is fatal: no safe write)
    const stored = await readData(gh);
    if (stored.warning) warn(stored.warning);
    const prev = stored.data;

    // 4. labels (before any issue is opened, so they get descriptions)
    await issueStep('Creating labels', () => ensureLabels(gh));

    // 3. stale gap since the last completed run (S7)
    if (!hold && prev) {
      const gap = detectGap(prev.lastRunAt, now(), cfg.settings.staleAfterMinutes);
      if (gap) {
        report.gap = gap;
        report.staleIssue = await issueStep('Reporting the stale gap', () => reportStaleGap(gh, { gap, settings: cfg.settings, now: now(), warn }));
      }
    }

    // 5. config-error issue (C6)
    report.configIssue = await issueStep('Updating the config-error issue',
      () => syncConfigErrorIssue(gh, { errors: cfg.errors, validCount: cfg.targets.length, warn }));

    if (hold) {
      writeSummary(runSummary(report), env);
      return issueFailures > 0 ? 1 : 0;
    }

    // 6. checks, concurrency 5, one failure never stops the others (K4)
    const settled = await mapLimit(cfg.targets, CHECK_CONCURRENCY, (t) => checkTarget(t.url, {
      resolver: deps.resolver, transport, timeoutMs: cfg.settings.timeoutMs, now,
    }));
    const checked = cfg.targets.map((t, k) => {
      const s = settled[k];
      const r = s.status === 'fulfilled' ? s.value : { up: false, reason: REASON.connection, checkedAt: now().toISOString().replace(/\.\d{3}Z$/, 'Z') };
      return { name: t.name, url: t.url, up: r.up, reason: r.reason, checkedAt: r.checkedAt };
    });
    report.results = checked;

    // Config order: checked targets, plus invalid entries whose stored record
    // is carried forward unchanged (review F2). Entries past 20 are not.
    const validNames = new Set(cfg.targets.map((t) => t.name.toLowerCase()));
    const bad = new Map(cfg.errors.filter((e) => Number.isInteger(e.index)).map((e) => [e.index, e]));
    const results = [];
    let v = 0;
    for (let index = 1; index <= cfg.targets.length + bad.size; index++) {
      const e = bad.get(index);
      if (!e) results.push(checked[v++]);
      else if (index <= 20 && e.storedName && !validNames.has(e.storedName.toLowerCase())) results.push({ name: e.storedName, carry: true });
    }

    // 7. pure state update, with the bot's open outage issues listed once
    const openIssues = await issueStep('Listing outage issues', () => listBotIssues(gh, 'outage'), null);
    const { data, actions } = applyRun(prev, results, {
      settings: cfg.settings,
      configErrorCount: cfg.errors.length,
      repo: gh.repo,
      openIssueNumbers: openIssues === null ? null : new Set(openIssues.map((i) => i.number)),
    }, now());

    // 8. issue actions (before the write, so a crash never duplicates: K5).
    // Without the list there is no safe de-duplication, so nothing is opened;
    // the next run opens or adopts the issue.
    if (openIssues !== null) {
      report.outages = await issueStep('Updating outage issues', () => syncOutages(gh, { actions, data, openIssues, settings: cfg.settings, warn }));
    }

    // 9. one commit to the data branch (D1, D5)
    const written = await writeData(gh, data, stored.sha);
    report.bytes = written.bytes;

    // 10. summary
    writeSummary(runSummary(report), env);
    log(`Checked ${checked.length} site(s): ${checked.filter((r) => r.up).length} up, ${checked.filter((r) => !r.up).length} down.`);
    return issueFailures > 0 ? 1 : 0;
  } catch (e) {
    report.failure = e?.message ?? 'unknown error';
    error(`::error::Monitor run failed: ${report.failure}`);
    try {
      writeSummary(runSummary(report), env);
    } catch {
      // the summary is best effort
    }
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // getaddrinfo runs on libuv's pool; keep it larger than check concurrency (F13).
  process.env.UV_THREADPOOL_SIZE ??= '8';
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
