#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// AI-generated (Claude Opus 5) under the direction of Lajosházi, László Gergely.
//
// results-guard — notice when a result has landed and nothing has recorded it,
// and check what IS written for the two mistakes this project makes most.
//
// ☠️ WHY IT IS A SEPARATE HOOK. Everything here was in `autonomy.cjs` and went
// out with it when the plan moved into docs/TODO.md - including the one gate in
// this project with a measured verdict: `unrecorded-result`, three firings,
// three catches, "earns its place" (see fp3-pmaports/docs/gates.md). Retiring the
// best-performing gate as a side effect of replacing the hook was not noticed
// until somebody asked where testing facts are tracked, and by then the day's
// findings-log entries were missing. It comes back on its own, so that queue.cjs
// keeps doing one job.
//
// Three checks, each earned by a specific failure:
//
//  1. UNRECORDED RESULT. A capture directory gains a file, or docs/ has
//     uncommitted changes, and nothing says what it means. That is exactly the
//     state an auto-compaction turns into lost work.
//  2. MAGNITUDE. A voltage-slope method once produced "1806 mA" for a phone
//     whose whole battery is 2185 mAh. A short table catches that class of error
//     the moment it is written down.
//  3. SCOPE. The most repeated mistake here is a claim whose quantifier is
//     stronger than the experiment: one boot's state stated as the phone's
//     property (the speaker amp), a modem firmware restart read as surviving a
//     reboot. A sentence carrying a universal word has to say what was varied.
//
// Plus witness resolution: a `witness:`/`capture:`/`commit:` reference that does
// not resolve is worse than none, because it reads as checked.
//
// Never blocks more than MAX_NUDGE times for the same unrecorded state, and
// never blocks at all for the lints - those are advice on text already written.

'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = process.env.FP3_DOCS_REPO || '/mnt/1TB/pmos/fp3-pmaports';
const WATCH = (process.env.FP3_WATCH ||
  'docs/power/bringup/captures').split(':').filter(Boolean);
const STATE = path.join(
  process.env.CLAUDE_STATE_DIR ||
    path.join(process.env.HOME || '/home/fp3', '.claude', '.state'),
  'fp3-results-guard.json');
const MAX_NUDGE = 2;
// The dated record. Its mtime is the 'everything up to here is written up' mark.
const LOG = 'docs/power/bringup/findings-log.md';

let gatelog = null;
try { gatelog = require('./gatelog.cjs'); } catch { /* optional */ }
const gl = (fn, ...a) => { try { return gatelog ? gatelog[fn](...a) : ''; } catch { return ''; } };

const readState = () => {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
};
const writeState = (s) => {
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    const tmp = `${STATE}.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
    fs.renameSync(tmp, STATE);
  } catch { /* bookkeeping must never fail a turn */ }
};

const git = (...args) => {
  try {
    return execFileSync('git', ['-C', REPO, ...args],
      { encoding: 'utf8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch { return ''; }
};

// ---------------------------------------------------------------- 1. unrecorded
function unrecorded() {
  const out = [];
  // ☠️ EXCLUDE NOTHING BY GUESSING, BUT DO EXCLUDE WHAT THIS HOOK ITSELF WRITES.
  // The predecessor had to learn that a gate counting its own output is a gate
  // that can never be cleared, which trains the reader to ignore the channel.
  // ☠️ TWO LANES, TWO RECORDS. Measured 2026-09-03: an edit to
  // docs/upstreaming/STATUS.md was blocked as an "unrecorded result" and told to
  // write a findings-log entry about power captures. Uncommitted STATUS rows are
  // a real loss too (a review round noted and then compacted away), but the
  // instruction is a different one, so the two are reported apart and the
  // remaining docs/ (the dossiers) are not treated as landed measurements.
  const dirtyPower = git('status', '--porcelain', '--', 'docs/power', ...WATCH.map((w) => w)).trim();
  if (dirtyPower) {
    const lines = [...new Set(dirtyPower.split('\n'))].slice(0, 8);
    out.push(`uncommitted under ${REPO}/docs/power:\n     ${lines.join('\n     ')}`);
  }
  const dirtyUp = git('status', '--porcelain', '--', 'docs/upstreaming').trim();
  if (dirtyUp) {
    const lines = dirtyUp.split('\n').slice(0, 8);
    out.push(`UPSTREAMING: uncommitted under ${REPO}/docs/upstreaming — a STATUS.md row ` +
      `(round, test, dependency) is the record; commit it:\n     ${lines.join('\n     ')}`);
  }
  // A capture directory with no README is a measurement nobody has read — but
  // ONLY one newer than the dated record.
  //
  // ☠️ THE FIRST VERSION OF THIS FLAGGED SIX CAPTURES FROM AUGUST, and would have
  // done so every turn for ever. That is precisely the self-triggering gate the
  // comment above warns about, built by the same hand three screens later: a
  // backlog is not a result that just landed, and a gate that can never be
  // cleared trains the reader to skip the channel. The reference point is the
  // last entry in findings-log.md — a capture younger than the record is a
  // measurement the record has not caught up with, and writing it up clears the
  // flag by construction.
  let since = 0;
  try { since = fs.statSync(path.join(REPO, LOG)).mtimeMs; } catch { /* no log */ }
  for (const w of WATCH) {
    const d = path.join(REPO, w);
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) {
      const p = path.join(d, n);
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (!st.isDirectory() || st.mtimeMs <= since) continue;
      if (!fs.existsSync(path.join(p, 'README.md'))) {
        out.push(`${w}/${n} is newer than ${LOG} and has no README.md`);
      }
    }
  }
  return out.slice(0, 6);
}

// ---------------------------------------------------------------- 2. magnitude
const BANDS = [
  { re: /(-?\d+(?:[.,]\d+)?)\s*%(?![\w-])/g, lo: -100, hi: 100, unit: '%' },
  { re: /(-?\d+(?:[.,]\d+)?)\s*mAh/gi, lo: 0, hi: 3060, unit: 'mAh' },
  { re: /(-?\d+(?:[.,]\d+)?)\s*mA\b/g, lo: -2500, hi: 400, unit: 'mA' },
  { re: /(-?\d+(?:[.,]\d+)?)\s*mV\b/g, lo: -5000, hi: 5000, unit: 'mV' },
];
function magnitude(text) {
  const out = [];
  for (const b of BANDS) {
    b.re.lastIndex = 0;
    let m;
    while ((m = b.re.exec(text))) {
      const v = parseFloat(m[1].replace(',', '.'));
      if (!isFinite(v)) continue;
      if (v < b.lo || v > b.hi) {
        out.push(`"${m[0].trim()}" is outside the plausible ${b.lo}..${b.hi} ${b.unit} ` +
          `for this device — a real reading, or an instrument that has failed?`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- 3. scope
// ☠️ The Hungarian words stay in the pattern even though the pages are English:
// the same claim gets typed in either language, and a check that only catches one
// of them is a check with a hole in exactly the place its author is least
// careful.
const UNIVERSAL = /\b(always|never|persistent|permanent|survives?|every boot|invariably|mindig|soha|perzisztens|t[uú]l[eé]li|minden booton)\b/i;
const SCOPED = /\b(scope:|measured on|n\s*=\s*\d|one boot|one leg|only .* was varied)/i;
// ☠️ TUNED ON ITS OWN FIRST FIRING, WHICH WAS 4/4 FALSE. It flagged a heading
// ("An enabled unit would have started on every boot"), an instruction in a
// blockquote ("Never delete a disproven claim"), a queue `why:` key, and a
// sentence about the gate log itself. None of them is a claim about the device,
// and a lint whose first outing is entirely false is on its way to being
// skimmed - which is how the gate that matters beside it gets skimmed too.
//
// Three cuts, each aimed at one of those four: headings and blockquotes are not
// claims, queue keys are scheduling, and a claim about a MEASUREMENT carries a
// quantity. The cost is real and stated: "the modem never subscribes to bit 12"
// has no unit and would now be missed. This is a net, not a proof.
const NOT_A_CLAIM = /^\s*(#|>|\||-\s*\[|(why|when|they-do|after|until|witness|scope):)/;
function scope(lines) {
  const out = [];
  for (const l of lines) {
    const t = l.replace(/^[+\s]*/, '');
    if (t.length < 40) continue;                 // headings and list keys
    if (NOT_A_CLAIM.test(t)) continue;
    if (!/\d/.test(t)) continue;                 // a measured claim carries a quantity
    // ☠️ CODE IS NOT PROSE. `Persistent=false` is a systemd directive and matched
    // the universal-word pattern twice in one paragraph about a timer. Strip
    // inline code spans before judging the sentence.
    const prose = t.replace(/`[^`]*`/g, ' ');
    if (UNIVERSAL.test(prose) && !SCOPED.test(prose)) {
      out.push(`"${t.slice(0, 100)}${t.length > 100 ? '…' : ''}"\n     ` +
        `— a universal word with no stated scope. What was actually varied?`);
    }
  }
  return out.slice(0, 4);
}

// ---------------------------------------------------------------- 4. witnesses
function witnesses(lines) {
  const out = [];
  const seen = new Set();
  for (const l of lines) {
    for (const m of l.matchAll(/\b(capture|commit|witness):\s*([^\s,;)"'`]+)/g)) {
      const [, kind, ref] = m;
      if (seen.has(ref)) continue;
      seen.add(ref);
      if (kind === 'commit' || /^[0-9a-f]{7,40}$/i.test(ref)) {
        if (/^[0-9a-f]{7,40}$/i.test(ref) && !git('cat-file', '-e', `${ref}^{commit}`) &&
            !git('rev-parse', '--verify', `${ref}^{commit}`)) {
          out.push(`commit ${ref} does not resolve in ${REPO}`);
        }
        continue;
      }
      if (ref.startsWith('unverifiable:')) continue;
      const p = ref.replace(/^\.\//, '');
      if (!p.includes('/')) continue;                    // not a path
      if (!fs.existsSync(path.join(REPO, p)) && !fs.existsSync(p)) {
        out.push(`${kind}: ${ref} — no such file or directory`);
      }
    }
  }
  return out.slice(0, 4);
}

// ---------------------------------------------------------------- entry
function main() {
  const cli = process.argv[2];
  let ev = {};
  if (!cli) {
    let raw = '';
    try { raw = fs.readFileSync(0, 'utf8'); } catch { /* none */ }
    try { ev = JSON.parse(raw || '{}'); } catch { ev = {}; }
  }

  // The added lines of everything uncommitted under docs/ — that is what is
  // actually about to enter the repository, which is the right thing to lint.
  const diff = git('diff', '--unified=0', '--', 'docs') +
    git('diff', '--cached', '--unified=0', '--', 'docs');
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  const lints = [
    ...magnitude(added.join('\n')).map((m) => `MAGNITUDE: ${m}`),
    ...scope(added).map((m) => `SCOPE: ${m}`),
    ...witnesses(added).map((m) => `WITNESS: ${m}`),
  ];
  const un = unrecorded();

  if (cli === 'check') {
    if (!un.length && !lints.length) { console.log('nothing to report'); process.exit(0); }
    if (un.length) console.log('UNRECORDED:\n  - ' + un.join('\n  - '));
    if (lints.length) console.log('LINT:\n  - ' + lints.join('\n  - '));
    process.exit(0);
  }
  if (ev.hook_event_name !== 'Stop') process.exit(0);

  // ☠️ PER WINDOW, for the same reason as the queue's: one flat state object meant
  // two sessions shared one anti-spin budget, so neither got the tries it was
  // designed to have and one window's silence suppressed the other's warning.
  const me = String(ev.session_id || process.env.CLAUDE_SESSION_ID || 'unknown').slice(0, 12);
  const all = readState();
  const st = all[me] || (all[me] = {});
  const sig = JSON.stringify([un, lints]);
  if (st.sig !== sig) { st.sig = sig; st.nudges = 0; }
  if (!un.length && !lints.length) { st.nudges = 0; writeState(all); process.exit(0); }

  st.nudges = (st.nudges || 0) + 1;
  if (st.nudges > MAX_NUDGE) { writeState(all); process.exit(0); }
  writeState(all);

  const ask = gl('askLine', 'results-guard');
  gl('log', 'results-guard', `${un.length} unrecorded, ${lints.length} lint`);

  // ☠️ THE LINTS DO NOT BLOCK ON THEIR OWN. They are advice about wording that is
  // already written down; blocking on advice is how a channel gets skimmed. Only
  // an unrecorded result holds the turn, because that is the one with a measured
  // record of catching real losses.
  const onlyUp = un.length && un.every((u) => u.startsWith('UPSTREAMING:'));
  const body =
    (un.length ? `Results have landed that nothing records:\n  - ${un.join('\n  - ')}\n\n` +
      `Write them down before the turn ends — an auto-compaction here loses them.\n` +
      (onlyUp
        ? `  docs/upstreaming/STATUS.md — the Rounds row (lore link), the Test block, or the ` +
          `D- entry; then commit. Method: the msm8953-mainline-pr skill, "Tracking the submissions".\n\n`
        : `  raw data → docs/power/bringup/captures/<date>_<name>/ with its own README.md\n` +
          `  the dated finding → docs/power/bringup/findings-log.md\n` +
          `  what the phone does TODAY → docs/power/README.md\n` +
          `☠️ Never delete a disproven claim; write why it fell.\n\n`) : '') +
    (lints.length ? `And check these, in what is already written (advice, not a block):\n` +
      `  - ${lints.join('\n  - ')}\n` : '');

  if (!un.length) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'Stop', additionalContext: body },
    }));
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    decision: 'block',
    systemMessage: `[eredmény-őr] ${un.length} rögzítetlen eredmény`,
    reason: ask + body,
  }));
  process.exit(0);
}

main();
