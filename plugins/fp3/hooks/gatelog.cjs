#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// AI-generated (Claude Opus 5) under the direction of Lajosházi, László Gergely.
//
// gatelog — one append-only record of every time a gate blocked work, and of
// whether it turned out to be right.
//
// ☠️ WHY. The 2026-09-03 gate review could not compute the one number that would
// justify REMOVING a gate. The old log recorded 37 firings as `{t, g}` - that a
// gate fired, never whether it was right - so per-gate precision was
// unmeasurable retrospectively, and the rule the review was written around ("if
// the false-block rate exceeds the catches, the gate is net negative") could not
// be applied to a single one of them. A gate set that cannot be pruned only
// grows, and every one of them can point at an incident for ever.
//
// ☠️ AND WHY IT IS SHARED, NOT PER-HOOK. Each gate keeping its own log would be
// the same mistake this project just spent a morning undoing with the plan: two
// lists is a question with two answers. One file, every gate.
//
// The record is APPEND-ONLY and outcomes are separate lines. A log that is
// rewritten to add a verdict is a log whose earlier state cannot be recovered,
// and the interesting case here is exactly "what did we think at the time".
//
//   gatelog.cjs log <gate> [detail...]        → prints the id it wrote
//   gatelog.cjs outcome <id|last> <catch|false|override> [why...]
//   gatelog.cjs report [days]                 → per gate: fired, catches, false,
//                                               overrides, unlabelled
//   gatelog.cjs pending                       → the unlabelled firings, oldest first
//
// Used from a hook: require() it and call log(). Never throws at the caller: a
// hook must not fail a turn because bookkeeping failed.

'use strict';
const fs = require('fs');
const path = require('path');

const FILE = process.env.FP3_GATELOG ||
  path.join(process.env.CLAUDE_STATE_DIR ||
    path.join(process.env.HOME || '/home/fp3', '.claude', '.state'), 'fp3-gatelog.jsonl');

const OUTCOMES = ['catch', 'false', 'override'];

function append(rec) {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.appendFileSync(FILE, JSON.stringify(rec) + '\n');
    return true;
  } catch { return false; }
}

function read() {
  try {
    return fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

// ☠️ THE ID IS THE TIMESTAMP PLUS A COUNTER, NOT A RANDOM STRING. It has to be
// something a person can read back out of the log by eye and out of a hook
// message by copying, and it has to sort.
function newId(rows) {
  const d = new Date();
  const day = d.toISOString().slice(0, 10).replace(/-/g, '');
  const n = rows.filter((r) => r.kind === 'fire' && String(r.id).startsWith(day)).length + 1;
  return `${day}.${n}`;
}

function log(gate, detail) {
  const rows = read();
  const id = newId(rows);
  append({ kind: 'fire', id, t: Date.now(), gate, detail: detail || '' });
  return id;
}

// ☠️ THE PREVIOUS UNLABELLED FIRING IS THE ENFORCEMENT, and it is deliberately
// not another standing instruction. Asking to be labelled in every blocking
// message would add a line to every gate for ever, which is the noise this whole
// morning was spent removing. Instead the NEXT firing of the same gate carries
// the question about the last one: it costs nothing when gates are labelled, and
// it is impossible to ignore for long when they are not.
function pendingFor(gate) {
  const rows = read();
  const labelled = new Set(rows.filter((r) => r.kind === 'outcome').map((r) => r.id));
  const fires = rows.filter((r) => r.kind === 'fire' && !labelled.has(r.id));
  return gate ? fires.filter((r) => r.gate === gate) : fires;
}

function askLine(gate) {
  const p = pendingFor(gate);
  if (!p.length) return '';
  const last = p[p.length - 1];
  const ago = ((Date.now() - last.t) / 36e5).toFixed(1);
  return `\n☠️ The previous firing of this gate (${last.id}, ${ago} h ago) is still ` +
    `unlabelled, so nobody can say whether this gate earns its place. One word:\n` +
    `  node "${__filename}" outcome ${last.id} catch|false|override -- "<what happened>"\n` +
    `  catch = it stopped a real mistake · false = it blocked correct work · ` +
    `override = it was pushed past.`;
}

function report(days) {
  const rows = read();
  const since = days ? Date.now() - days * 864e5 : 0;
  const fires = rows.filter((r) => r.kind === 'fire' && r.t >= since);
  const out = new Map();
  for (const r of rows) if (r.kind === 'outcome') out.set(r.id, r.outcome);
  const by = new Map();
  for (const f of fires) {
    const g = by.get(f.gate) || { fired: 0, catch: 0, false: 0, override: 0, unlabelled: 0 };
    g.fired++;
    const o = out.get(f.id);
    if (o && OUTCOMES.includes(o)) g[o]++; else g.unlabelled++;
    by.set(f.gate, g);
  }
  const lines = [];
  lines.push(`${'gate'.padEnd(24)} ${'fired'.padStart(5)} ${'catch'.padStart(5)} ` +
    `${'false'.padStart(5)} ${'ovrd'.padStart(5)} ${'?'.padStart(4)}  verdict`);
  for (const [g, v] of [...by].sort((a, b) => b[1].fired - a[1].fired)) {
    // ☠️ A VERDICT IS ONLY SPOKEN WHEN IT CAN BE. The judged fraction has to be
    // most of the firings before "net negative" means anything; below that the
    // honest output is "not enough labels", not a number with a straight face.
    const judged = v.catch + v.false + v.override;
    // ☠️ THE TWO REASONS FOR "CANNOT SAY" ARE DIFFERENT AND MUST NOT READ ALIKE.
    // Too few firings is a gate nobody has tested yet; too few labels is a gate
    // nobody has judged. The first is fixed by waiting, the second by working -
    // and printing "1/1 judged — not enough to say" made the second look like
    // the first.
    const verdict = v.fired < 3 ? `too few firings yet (${v.fired})`
      : judged < v.fired * 0.5 ? `only ${judged}/${v.fired} labelled — judge them, or this stays unanswerable`
        : v.false > v.catch ? '☠️ NET NEGATIVE — more false blocks than catches'
          : v.catch ? 'earns its place' : 'no catches yet';
    lines.push(`${g.padEnd(24)} ${String(v.fired).padStart(5)} ${String(v.catch).padStart(5)} ` +
      `${String(v.false).padStart(5)} ${String(v.override).padStart(5)} ` +
      `${String(v.unlabelled).padStart(4)}  ${verdict}`);
  }
  const tot = fires.length;
  const ov = fires.filter((f) => out.get(f.id) === 'override').length;
  lines.push('', `${tot} firing(s)${days ? ` in ${days} day(s)` : ''}; ` +
    `override rate ${tot ? (100 * ov / tot).toFixed(1) : '0.0'} %` +
    ` — above ~20 % means a gate is mistuned, not that its user is undisciplined.`);
  return lines.join('\n');
}

module.exports = { log, askLine, pendingFor, FILE };

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  const sep = rest.indexOf('--');
  const head = sep < 0 ? rest : rest.slice(0, sep);
  const tail = sep < 0 ? [] : rest.slice(sep + 1);
  if (cmd === 'log') {
    if (!head[0]) { console.error('usage: log <gate> [detail]'); process.exit(1); }
    console.log(log(head[0], head.slice(1).join(' ') || tail.join(' ')));
  } else if (cmd === 'outcome') {
    let [id, outcome] = head;
    if (!id || !OUTCOMES.includes(outcome)) {
      console.error(`usage: outcome <id|last> <${OUTCOMES.join('|')}> [-- "<why>"]\n` +
        '  catch    = it stopped a real mistake\n' +
        '  false    = it blocked work that was correct\n' +
        '  override = it was pushed past\n' +
        '☠️ Label it when the firing is RESOLVED, not when it happens - at the moment ' +
        'a gate fires nobody knows yet which of the three it was.');
      process.exit(1);
    }
    if (id === 'last') {
      const p = pendingFor();
      if (!p.length) { console.error('nothing unlabelled'); process.exit(1); }
      id = p[p.length - 1].id;
    }
    const rows = read();
    if (!rows.some((r) => r.kind === 'fire' && r.id === id)) {
      console.error(`no firing with id ${id}`); process.exit(1);
    }
    append({ kind: 'outcome', id, t: Date.now(), outcome, why: tail.join(' ').trim() });
    console.log(`${id} → ${outcome}`);
  } else if (cmd === 'report') {
    console.log(report(head[0] ? Number(head[0]) : 0));
  } else if (cmd === 'pending') {
    const p = pendingFor(head[0]);
    if (!p.length) { console.log('nothing unlabelled'); process.exit(0); }
    for (const r of p) {
      console.log(`${r.id}  ${new Date(r.t).toISOString().slice(0, 16).replace('T', ' ')}  ` +
        `${r.gate}${r.detail ? `  ${r.detail}` : ''}`);
    }
  } else {
    console.error('usage: log <gate> [detail] | outcome <id|last> <catch|false|override> [-- why] | ' +
      'report [days] | pending [gate]');
    process.exit(1);
  }
}
