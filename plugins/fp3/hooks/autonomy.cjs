#!/usr/bin/env node
// AI-generated (Claude Opus 5) under the direction of Lajosházi, László Gergely.
//
// Carry an autonomous run's PLAN and STATUS across turns, refuse to end a turn
// while the plan still has work in it, and make sure an auto-compaction cannot
// take the run's findings with it.
//
// The first failure this exists to stop: during an autonomous run ("keep going
// until morning", "don't stop and ask"), the plan lives only in the model's
// head. At the end of a turn it evaporates, the assistant stops on a
// natural-looking boundary, and the user has to say "you stopped again". That
// is not a motivation problem; it is a state problem, so it gets state.
//
// The second failure, measured 2026-08-31: a session ran for hours, then an
// auto-compaction arrived. The plan survived - it is in this file's state - but
// three things did not.
//
//   1. Nothing fired after the compaction. The plan was injected on
//      UserPromptSubmit only, and an autonomous run goes hours without a user
//      prompt, so the resumed session ran blind until the user spoke.
//      => SessionStart, which also fires with source=compact.
//   2. The durable artefact the user actually reads on resume - the resume block
//      at the top of docs/STATUS.md - was written BY HAND at the end of the
//      session. Anything the hand-written pass forgot was gone.
//      => the block is generated from this state, and rewritten on every edit.
//   3. Free text carried a false record. An item was marked done with the note
//      "promoted to the skill (see below)" - a forward reference that was never
//      fulfilled, and read on resume as a finished job.
//      => `done` and `measured` demand evidence, and the evidence is checked to
//         exist before it is accepted.
//
// Hooks and a CLI:
//   SessionStart    - a session began, RESUMED, or came out of a compaction:
//                     hand back the plan and the findings, with no prompt needed
//   PreCompact      - a compaction is about to happen: flush the resume block
//   Stop            - block the end of the turn while an item is open, and hand
//                     back the next step so the model resumes without a nudge;
//                     also block when results have landed that nothing recorded
//   UserPromptSubmit- the user spoke: reset the anti-spin counter and show the plan
//   CLI             - how the model reads and edits the plan
//
// The third failure, measured 2026-09-01. An outside review (a Fable subagent)
// had been asked for twice, both times by hand, at a moment the model happened
// to think of it. The second one was therefore written WITHOUT the day's new
// measurements in front of it, so it gave advice for a state that had already
// moved - including a budget number that contradicted this run's own fitted
// slope. Two things were missing and both are state, so both live here: WHEN a
// review is due, and WHICH agent already carries the history.
//   => `consulted`, and a Stop gate that asks for one.
//
// ☠️ ANTI-SPIN IS NOT OPTIONAL. A Stop hook that always blocks is an infinite
// loop. This one blocks at most MAX_BLOCKS times without the plan changing; a
// changed plan (an item finished, added, re-scoped, a fact recorded) resets the
// budget, because progress is exactly what the block is for. Running out of
// budget lets the turn end and says so. THE STALENESS GATE SHARES THAT BUDGET -
// a gate with its own budget is a second way to spin.
//
//   node autonomy.cjs start "<goal>"          begin an autonomous run
//   node autonomy.cjs add "<step>" [...]      append steps
//   node autonomy.cjs note <id> "<text>"      record progress without finishing
//   node autonomy.cjs wait <id> "<what>"      blocked on something OUTSIDE this
//                                             session - a measurement that has to
//                                             run, a build, a person. Stays open
//                                             and visible; does not hold the turn
//   node autonomy.cjs done <id> <evidence> [-- <note>]
//                                             finish a step. EVIDENCE IS REQUIRED
//                                             and is checked to exist
//   node autonomy.cjs drop <id> "<why>"       abandon a step, with the reason
//   node autonomy.cjs measured <evidence> -- "<claim>"
//                                             a claim that now stands, with what
//                                             witnesses it
//   node autonomy.cjs retracted "<claim>" -- "<why it fell>"
//                                             a claim that has been DISPROVEN.
//                                             Never delete one: a deleted claim
//                                             gets rediscovered
//   node autonomy.cjs consulted <agent> [-- "<what it said>"]
//                                             an OUTSIDE REVIEW was ASKED FOR. Record it when
//                                             you LAUNCH it, not when it answers - otherwise the
//                                             gate fires again while one is in flight, and a
//                                             crash loses the only handle you had. Record it a
//                                             second time with the findings when it returns.
//                                             The agent name is the point: the next one goes to
//                                             the SAME agent by SendMessage, so it keeps history
//   node autonomy.cjs status <path/to/STATUS.md>   where the resume block is written
//   node autonomy.cjs watch <path>            a directory whose new contents mean
//                                             "a result landed" (captures, logs)
//   node autonomy.cjs show                    print the plan
//   node autonomy.cjs flush                   rewrite the resume block now
//   node autonomy.cjs stop                    end the run (user said stop, or done)
//
// EVIDENCE is ONE token, and every form but the last is verified on disk:
//   <path>            a file that exists
//   <path>:<line>     a file that exists and has at least that many lines
//   commit:<sha>      a commit that resolves in one of the known repos
//   capture:<dir>     a directory that exists
//   unverifiable:<why> the escape hatch. Accepted, but rendered as unverified -
//                     because a gate with no way out is a gate that gets lied to.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const DIR = process.env.CLAUDE_STATE_DIR ||
  path.join(process.env.HOME || '/home/fp3', '.claude', '.state');
const FILE = path.join(DIR, 'fp3-autonomy.json');
const MAX_BLOCKS = 4;
const BEGIN = '<!-- FP3-AUTONOMY-RESUME:BEGIN — generated by autonomy.cjs; edit the plan, not this block -->';
const END = '<!-- FP3-AUTONOMY-RESUME:END -->';

const empty = () => ({
  active: false, goal: '', items: [], nextId: 1, blocks: 0, lastHash: '',
  waitAnnounced: '', facts: [], statusFile: '', watch: [], lastRecordAt: 0,
  consult: { agent: '', at: 0, atRecords: 0, note: '' }, consultAnnounced: false,
});
function read() {
  try { return Object.assign(empty(), JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch { return empty(); }
}
function write(s) {
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(s, null, 1)); }
  catch { /* bookkeeping must never break the session */ }
}
// ☠️ ONE RUN, ONE SESSION. This plan drives a single phone: two sessions editing
// it means two sets of hands on one device, and it has happened - a second
// terminal picked the plan up and carried on while the first was mid-measurement.
// The state file is shared, so the file is where the lock has to live.
//
// ☠️ AND THE LOCK MUST NOT OUTLIVE ITS OWNER. A lock that a crashed session keeps
// forever is worse than no lock; the next session cannot work and cannot see why.
// So ownership is not a timeout, it is a LIVENESS TEST: Claude Code exports
// CLAUDE_PID, and `kill(pid, 0)` distinguishes "quiet" from "gone" - EPERM means
// alive under another user, ESRCH means the owner is really dead and the run is
// free to take. Across machines a pid means nothing, so the hostname is recorded
// and a foreign host falls back to a staleness window.
const OWNER_STALE_MIN = 45;
function me() {
  return {
    sid: process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || '',
    pid: Number(process.env.CLAUDE_PID) || 0,
    host: os.hostname(),
  };
}
function alive(o) {
  if (!o || !o.pid) return false;
  if (o.host && o.host !== os.hostname()) {
    return o.seen && (Date.now() - o.seen) / 6e4 < OWNER_STALE_MIN;   // cannot test a remote pid
  }
  try { process.kill(o.pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}
// Returns '' when this session may proceed, or a sentence saying why not.
function ownershipBlock(s) {
  const m = me();
  const o = s.owner;
  if (!m.sid) return '';                       // no identity to enforce with
  if (!o || !o.sid) { s.owner = Object.assign({}, m, { at: Date.now(), seen: Date.now() }); return ''; }
  if (o.sid === m.sid) { o.seen = Date.now(); o.pid = m.pid || o.pid; return ''; }
  if (alive(o)) {
    return `This autonomous run belongs to another session that is still running ` +
      `(pid ${o.pid} on ${o.host}, last seen ${((Date.now() - (o.seen || o.at)) / 6e4).toFixed(0)} min ago).\n` +
      `☠️ Two sessions editing one plan means two sets of hands on one phone - it has already ` +
      `happened here, mid-measurement.\n` +
      `Go back to it:  claude --resume ${o.sid}\n` +
      `If that session is genuinely finished with the run and you know it, take it over ` +
      `deliberately:  node "${__filename}" claim --force`;
  }
  // The owner is gone. Take over, but say so - a silent handover hides the fact
  // that whatever it was measuring may have died with it.
  const dead = o.sid;
  s.owner = Object.assign({}, m, { at: Date.now(), seen: Date.now(), tookOverFrom: dead });
  console.error(`☠️ took over the run from session ${dead} (pid ${o.pid} is gone). ` +
    `Anything it had running on the device died with it - check before trusting a measurement in flight.`);
  return '';
}

// ☠️ A 'waiting' item is open but NOT actionable, and the difference is the whole
// point: blocking a turn over work that is waiting on a measurement produces a
// nudge every turn while nothing can move, and any note written in response
// restores the anti-spin budget, so it never terminates. That happened - the
// hook pushed for the next item five times while every item was blocked on one
// running measurement. Waiting items hold the plan, not the turn.
const openItems = (s) => s.items.filter((i) => i.status === 'todo' || i.status === 'doing');
const waitingItems = (s) => s.items.filter((i) => i.status === 'waiting');
// The hash is what the anti-spin budget watches, so EVERY kind of progress must
// be in it - including a recorded fact, which is the only progress there is on a
// turn whose whole job was to write down a result.
const hash = (s) => crypto.createHash('sha1')
  .update(JSON.stringify([
    s.items.map((i) => [i.id, i.status, i.text, i.note || '', i.ev || '']),
    s.facts.map((f) => [f.kind, f.text, f.ev || '']),
  ]))
  .digest('hex').slice(0, 12);

// ------------------------------------------------------- evidence
function repoRoots(s) {
  const cands = [process.cwd(), s.statusFile ? path.dirname(s.statusFile) : '', path.dirname(__filename)];
  const out = [];
  for (const c of cands) {
    if (!c) continue;
    try {
      const r = execFileSync('git', ['-C', c, 'rev-parse', '--show-toplevel'],
        { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (r && !out.includes(r)) out.push(r);
    } catch { /* not a repo; fine */ }
  }
  if (!out.includes(process.cwd())) out.push(process.cwd());
  return out;
}
function resolveAny(s, p) {
  if (path.isAbsolute(p)) return fs.existsSync(p) ? p : '';
  for (const r of repoRoots(s)) {
    const f = path.join(r, p);
    if (fs.existsSync(f)) return f;
  }
  return '';
}
/** Returns {ok, why, kind}. Never throws. */
// ☠️ THE HOOK CHECKS PROVENANCE; THESE TWO CHECK PLAUSIBILITY. Every guard here
// used to ask "does the artefact exist" - and three times in one run the
// artefact existed and the NUMBER in it was wrong. Full validity checking would
// need the same domain reasoning that made the error, so it belongs to the
// outside reviewer; but two sub-families are mechanical, and each cost a real
// mistake in this run.

// 1. MAGNITUDE. A voltage-slope method once produced "1806 mA" for a phone whose
// whole battery is 2185 mAh. A ten-line table catches that class instantly.
const BANDS = [
  { re: /(-?\d+(?:[.,]\d+)?)\s*%/g, lo: 0, hi: 100, unit: '%', hard: true },
  { re: /(-?\d+(?:[.,]\d+)?)\s*mAh/gi, lo: 0, hi: 3060, unit: 'mAh', hard: true },
  { re: /(-?\d+(?:[.,]\d+)?)\s*mA\b/g, lo: -2500, hi: 400, unit: 'mA', hard: false },
];
function magnitudeLint(text) {
  const out = [];
  for (const b of BANDS) {
    b.re.lastIndex = 0;
    let m;
    while ((m = b.re.exec(text))) {
      const v = parseFloat(m[1].replace(',', '.'));
      if (!isFinite(v)) continue;
      if (v < b.lo || v > b.hi) {
        out.push({ hard: b.hard, msg: `${m[1]} ${b.unit} is outside the plausible ` +
          `${b.lo}..${b.hi} ${b.unit} for this device` });
      }
    }
  }
  return out;
}

// 2. SCOPE. The most repeated mistake in this project is a claim whose quantifier
// is stronger than the experiment: one boot's state stated as the phone's
// property (the speaker amp), a firmware restart read as reboot-persistence, a
// banner believed over a grep. A claim carrying a universal word must say what
// was actually varied.
const UNIVERSAL = /\b(mindig|soha|perzisztens|t[uú]l[eé]li|NV-backed|always|never|persistent|permanent|survives|every boot|minden booton)\b/i;
function scopeMissing(text) {
  return UNIVERSAL.test(text) && !/scope:/i.test(text);
}

function checkEvidence(s, ev) {
  if (!ev) return { ok: false, why: 'no evidence given' };
  if (ev.startsWith('unverifiable:')) {
    const why = ev.slice('unverifiable:'.length).trim();
    return why
      ? { ok: true, kind: 'unverifiable' }
      : { ok: false, why: 'unverifiable: needs a reason after the colon' };
  }
  if (ev.startsWith('commit:')) {
    const sha = ev.slice(7).trim();
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) return { ok: false, why: `not a sha: ${sha}` };
    for (const r of repoRoots(s)) {
      try {
        execFileSync('git', ['-C', r, 'cat-file', '-e', `${sha}^{commit}`],
          { timeout: 4000, stdio: 'ignore' });
        return { ok: true, kind: 'commit' };
      } catch { /* try the next repo */ }
    }
    return { ok: false, why: `commit ${sha} resolves in none of: ${repoRoots(s).join(', ')}` };
  }
  if (ev.startsWith('capture:')) {
    const d = resolveAny(s, ev.slice(8).trim());
    if (!d) return { ok: false, why: `no such directory: ${ev.slice(8)}` };
    try { if (!fs.statSync(d).isDirectory()) return { ok: false, why: `${d} is not a directory` }; }
    catch { return { ok: false, why: `cannot stat ${d}` }; }
    return { ok: true, kind: 'capture' };
  }
  // bare path, optionally path:line
  const m = /^(.*):(\d+)$/.exec(ev);
  const p = m ? m[1] : ev;
  const f = resolveAny(s, p);
  if (!f) return { ok: false, why: `no such file: ${p}` };
  if (m) {
    let n = 0;
    try { n = fs.readFileSync(f, 'utf8').split('\n').length; } catch { return { ok: false, why: `cannot read ${f}` }; }
    if (n < Number(m[2])) return { ok: false, why: `${p} has ${n} lines, not ${m[2]}` };
    return { ok: true, kind: 'path:line' };
  }
  return { ok: true, kind: 'path' };
}

// ------------------------------------------------------- staleness
/** A result landed and nothing recorded it. Returns an array of reasons. */
function staleReasons(s) {
  const out = [];
  const since = s.lastRecordAt || 0;
  for (const w of s.watch) {
    const d = resolveAny(s, w);
    if (!d) continue;
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const n of names) {
      let st; try { st = fs.statSync(path.join(d, n)); } catch { continue; }
      if (st.mtimeMs > since) out.push(`${path.join(w, n)} is newer than the last plan edit`);
    }
  }
  if (s.statusFile) {
    try {
      const dir = path.dirname(s.statusFile);
      const dirty = execFileSync('git', ['-C', dir, 'status', '--porcelain', '--', '.'],
        { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      // ☠️ Exclude the status file itself. This hook WRITES it, so counting it
      // makes the gate fire on its own output - a self-triggering gate that can
      // never be cleared, which trains the reader to ignore the channel.
      const base = path.basename(s.statusFile);
      const lines = dirty ? dirty.split('\n').filter((l) => !l.endsWith(`/${base}`) && !l.endsWith(` ${base}`)) : [];
      if (lines.length) out.push(`uncommitted changes under ${dir}:\n     ` +
        lines.slice(0, 8).join('\n     '));
    } catch { /* not a repo, or git unavailable */ }
  }
  return out.slice(0, 6);
}

// ------------------------------------------------------- rendering
// ------------------------------------------------------- outside review
// A review is worth asking for when the picture has MOVED, so the trigger is
// progress, not the clock - with a clock fallback so a slow stretch still gets
// one. The agent NAME is the valuable half: a fresh general-purpose agent
// starts blind, while the same one messaged again already knows the earlier
// review and every retraction since.
const CONSULT_EVERY = 6;   // results recorded between reviews
const CONSULT_HOURS = 4;   // ...or this long, whichever comes first
const records = (s) =>
  s.facts.length + s.items.filter((i) => i.status === 'done' || i.status === 'dropped').length;
// ☠️ A GATE THAT FIRES WHILE THE ANSWER IS ON ITS WAY IS NOISE. The review is
// asked for by sending a message and arrives minutes later; the first version
// re-fired on every Stop in between, so the same demand appeared three times for
// one review and once while a review was already running. `consulting <agent>`
// marks it in flight and buys CONSULT_GRACE_MIN minutes of quiet - long enough
// for an answer, short enough that a review that never returns is asked again.
const CONSULT_GRACE_MIN = 20;
function consultDue(s) {
  if (!s.active) return '';
  const c = s.consult || {};
  if (c.pendingAt) {
    const mins = (Date.now() - c.pendingAt) / 6e4;
    if (mins < CONSULT_GRACE_MIN) return '';
    // ☠️ AN EXPIRED GRACE MUST NOT REPEAT "ASK FOR A REVIEW". The answer may
    // still be coming, and a second agent started here would review a state that
    // has moved - this repo's own dated trap. Escalate instead: chase the one
    // that is out.
    return `PENDING:${mins.toFixed(0)}`;
  }
  if (!c.at) return 'no outside review has been recorded in this run yet';
  const dn = records(s) - (c.atRecords || 0);
  if (dn >= CONSULT_EVERY) return `${dn} results have been recorded since the last review`;
  const dh = (Date.now() - c.at) / 36e5;
  if (dh >= CONSULT_HOURS) return `${dh.toFixed(1)} h since the last review`;
  return '';
}
function consultCall(s) {
  const c = s.consult || {};
  return c.agent
    ? `SendMessage({to: "${c.agent}", message: "<what changed since your last review: the new ` +
      `measurements, anything retracted, and the open questions>"})\n` +
      `  ← the SAME agent on purpose, so it still carries the earlier review.`
    : `Agent({subagent_type: "general-purpose", model: "fable", description: "Fable review",\n` +
      `        prompt: "<self-contained: the goal, what is measured, what was retracted, the ` +
      `open questions, and the repo paths to read>"})\n` +
      `  ☠️ NOT subagent_type "fork" — a fork always runs on the parent's model and ignores the ` +
      `model override, so it would be reviewing its own work.`;
}
// ☠️ `published` drops the agent handle. It is a session-local id that is dead
// tomorrow, and the resume block is written into a public repository - so it
// would be permanent noise there and useful nowhere. The local state keeps it.
function renderConsult(s, published) {
  const c = s.consult || {};
  if (!c.at) return 'OUTSIDE REVIEW: none recorded in this run.';
  const ago = ((Date.now() - c.at) / 36e5).toFixed(1);
  const who = c.agent && !published ? ` by agent ${c.agent}` : '';
  const note = published ? c.note : clip(c.note, 400);
  return `OUTSIDE REVIEW: last ${ago} h ago${who}, ` +
    `${records(s) - (c.atRecords || 0)} result(s) recorded since.` + (note ? `\n  · ${note}` : '');
}

function render(s) {
  if (!s.active) return 'No autonomous run is active.';
  const line = (i) => {
    const mark = { todo: '[ ]', doing: '[~]', done: '[x]', dropped: '[-]', waiting: '[…]' }[i.status] || '[?]';
    const ev = i.ev ? `  ⟨${i.ev}⟩` : '';
    return `  ${mark} ${i.id}. ${i.text}${ev}${i.note ? `\n        · ${i.note}` : ''}`;
  };
  return [`GOAL: ${s.goal}`, ...s.items.map(line)].join('\n');
}
// ☠️ THE PLAN IS NOT THE REMINDER. render() prints every item with every note,
// which is right for the durable record in STATUS.md and for `show` - and wrong
// for a hook that fires on every turn: at 59 items it was 75 KB of mostly
// finished work, re-read each turn, with the one line that mattered buried in
// it. A reminder nobody can skim is a reminder nobody reads. renderPlan() is
// what the hooks emit: actionable items in full, waiting items in one line,
// finished items as a count.
//
// ☠️ AND PRIORITY WAS IMPLICIT. The stars live in the item text, but the plan
// was ordered - and NEXT was picked - by id, i.e. by the order steps happened to
// be written down. Rank by stars, break ties by id, and say the rank out loud.
const prio = (i) => (String(i.text).match(/★/g) || []).length;
const byPrio = (a, b) => prio(b) - prio(a) || a.id - b.id;
function clip(t, n) {
  t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
function nextItem(open) { return [...open].sort(byPrio)[0]; }

function renderPlan(s) {
  if (!s.active) return 'No autonomous run is active.';
  const open = s.items.filter((i) => i.status === 'todo' || i.status === 'doing');
  const waiting = s.items.filter((i) => i.status === 'waiting');
  const done = s.items.filter((i) => i.status === 'done').length;
  const dropped = s.items.filter((i) => i.status === 'dropped').length;
  const out = [
    `GOAL: ${s.goal}`,
    `${done} done · ${dropped} dropped · ${open.length} actionable · ${waiting.length} waiting` +
      `   (every item, with notes: \`node "${__filename}" show\`)`,
  ];
  if (open.length) {
    out.push('', 'ACTIONABLE — highest priority first, act on the top one:');
    for (const i of [...open].sort(byPrio)) {
      out.push(`  ${i.status === 'doing' ? '[~]' : '[ ]'} ${i.id}. ${i.text}` +
        (i.ev ? `  ⟨${i.ev}⟩` : '') + (i.note ? `\n        · ${i.note}` : ''));
    }
  }
  if (waiting.length) {
    out.push('', 'WAITING — nothing to do on these; do not disturb what they measure:');
    // ☠️ THE STALENESS FLAG MUST NOT BECOME THE NOISE IT REPLACED. With 25
    // waiting items, flagging every old one rebuilds the wall of text this
    // renderer exists to cut. Only the two oldest carry the question.
    const flagged = new Set([...waiting].filter((i) => i.waitAt)
      .sort((a, b) => a.waitAt - b.waitAt).slice(0, 2).map((i) => i.id));
    for (const i of [...waiting].sort(byPrio)) {
      // ☠️ A WAIT REASON GOES STALE SILENTLY. One item in this run waited all
      // day on "the 16:06 timer", which had fired that afternoon; another on
      // "the phone is busy until 16:02". Nothing re-reads a reason nobody is
      // shown, so an old one is surfaced with its age and a question.
      const h = i.waitAt ? (Date.now() - i.waitAt) / 36e5 : null;
      const age = h != null && h >= 6 && flagged.has(i.id)
        ? `  ⏳ ${h.toFixed(0)} h — is this reason still true?` : '';
      out.push(`  … ${i.id}. ${clip(i.text, 100)}${age}\n        ⟵ ${clip(i.note, 100) || 'reason unstated'}`);
    }
  }
  return out.join('\n');
}

// ☠️ SAME LESSON, SECOND HALF. Trimming the plan left the fact list as the bulk:
// 23 KB of measured claims plus their witnesses, re-emitted on every turn. The
// witness belongs in the durable record (STATUS.md keeps it, `show` prints it) -
// what a turn-by-turn reminder needs is the CLAIM, so it is not contradicted or
// re-derived. The retractions keep more of their reason than the measurements do,
// because their whole job is to stop the reader rebuilding on a dead claim.
function renderFacts(s, compact) {
  const m = s.facts.filter((f) => f.kind === 'measured');
  const r = s.facts.filter((f) => f.kind === 'retracted');
  const out = [];
  if (m.length) {
    out.push('MEASURED and standing:');
    for (const f of m) {
      const flag = String(f.ev || '').startsWith('unverifiable:') ? ' ☠️ UNVERIFIED' : '';
      out.push(compact ? `  · ${clip(f.text, 200)}${flag}`
                       : `  · ${f.text}${flag}\n      witness: ${f.ev}`);
    }
  }
  if (r.length) {
    out.push('☠️ RETRACTED — do not rebuild on these:');
    for (const f of r) {
      out.push(compact ? `  · ${clip(f.text, 200)}\n      fell because: ${clip(f.ev, 140)}`
                       : `  · ${f.text}\n      fell because: ${f.ev}`);
    }
  }
  return out.join('\n');
}
function precompactLatest() {
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(process.env.HOME || '/home/fp3', '.claude');
  const base = path.join(home, '.state', 'precompact-status');
  let best = '', bestT = 0;
  let dirs = []; try { dirs = fs.readdirSync(base); } catch { return ''; }
  for (const d of dirs) {
    const f = path.join(base, d, 'latest.md');
    try { const t = fs.statSync(f).mtimeMs; if (t > bestT) { bestT = t; best = f; } } catch { /* none */ }
  }
  return best;
}

// ------------------------------------------------------- the resume block
function resumeBlock(s, stampIso) {
  const parts = [
    BEGIN,
    '',
    `## ⟲ Resume — autonomous run, generated ${stampIso}`,
    '',
    'This block is written by `plugins/fp3/hooks/autonomy.cjs` from the run state in',
    `\`${FILE}\`, on every plan edit and before every compaction. It is what a session`,
    'that lost its context reads first. Do not hand-edit it — edit the plan.',
    '',
    '```',
    render(s),
    '```',
    '',
  ];
  const facts = renderFacts(s);
  if (facts) parts.push('```', facts, '```', '');
  parts.push('```', renderConsult(s, true), '```', '');
  const stale = staleReasons(s);
  if (stale.length) {
    parts.push('**☠️ Results have landed that the plan does not mention yet:**', '');
    for (const r of stale) parts.push(`  - ${r}`);
    parts.push('');
  }
  const lp = precompactLatest();
  if (lp) parts.push(`Last pre-compaction transcript snapshot: \`${lp}\``, '');
  parts.push(END);
  return parts.join('\n');
}
// ☠️ A DRY RUN THAT WRITES IS NOT A DRY RUN. Exercising the hook against a COPY
// of the state (CLAUDE_STATE_DIR=/tmp/...) still wrote the real STATUS.md,
// because the path travels inside the state, not beside it - so a test with two
// deliberately fake items published them to the repo. Set FP3_AUTONOMY_NO_WRITE=1
// to render without publishing.
function flushStatus(s) {
  if (process.env.FP3_AUTONOMY_NO_WRITE) return '';
  if (!s.statusFile) return '';
  const f = s.statusFile;
  let text;
  try { text = fs.readFileSync(f, 'utf8'); } catch { return ''; }
  const block = resumeBlock(s, new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC');
  const b = text.indexOf(BEGIN);
  const e = text.indexOf(END);
  let out;
  if (b !== -1 && e !== -1 && e > b) {
    out = text.slice(0, b) + block + text.slice(e + END.length);
  } else {
    // first insert: put it directly under the H1 so it is the first thing read
    const nl = text.indexOf('\n');
    out = nl === -1 ? `${text}\n\n${block}\n` : `${text.slice(0, nl + 1)}\n${block}\n${text.slice(nl + 1)}`;
  }
  if (out === text) return f;
  try { fs.writeFileSync(f, out); } catch { return ''; }
  return f;
}

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
if (argv.length) {
  const s = read();
  const [cmd, ...rest] = argv;
  const arg = rest.join(' ');
  // `--` splits a positional head from free text; used by done/measured/retracted
  const dash = rest.indexOf('--');
  const head = dash === -1 ? rest : rest.slice(0, dash);
  const tail = dash === -1 ? [] : rest.slice(dash + 1);
  const fail = (msg) => { console.error(msg); process.exit(1); };

  // ☠️ READS ARE ALWAYS FINE; WRITES BELONG TO THE OWNER. A second session may
  // look at the plan - that is how it learns it should not touch it - but a
  // mutation from elsewhere is the failure this lock exists for.
  const READONLY = new Set(['show', 'flush', 'status', 'claim']);
  if (cmd === 'claim') {
    const m = me();
    if (rest[0] !== '--force' && ownershipBlock(s)) fail(ownershipBlock(s));
    s.owner = Object.assign({}, m, { at: Date.now(), seen: Date.now(),
      forced: rest[0] === '--force' ? (s.owner || {}).sid || 'nobody' : undefined });
    write(s);
    console.log(`run claimed by session ${m.sid} (pid ${m.pid} on ${m.host})` +
      (rest[0] === '--force' ? ' — FORCED; the previous owner will be told it lost the run' : ''));
    process.exit(0);
  }
  if (!READONLY.has(cmd)) {
    const blocked = ownershipBlock(s);
    if (blocked) fail(`REFUSED: ${blocked}`);
  }

  switch (cmd) {
    case 'start':
      Object.assign(s, empty(), { active: true, goal: arg || s.goal });
      break;
    case 'add':
      for (const t of rest.length > 1 ? rest : [arg]) {
        if (t) s.items.push({ id: s.nextId++, text: t, status: 'todo' });
      }
      s.active = true;
      break;
    case 'status':
      if (!arg) fail('usage: status <path/to/STATUS.md>');
      if (!fs.existsSync(arg)) fail(`no such file: ${arg} — the resume block needs a file that exists`);
      s.statusFile = path.resolve(arg);
      break;
    case 'watch': {
      if (!arg) fail('usage: watch <directory whose new contents mean a result landed>');
      const d = resolveAny(s, arg);
      if (!d) fail(`no such directory: ${arg}`);
      if (!s.watch.includes(arg)) s.watch.push(arg);
      break;
    }
    case 'reopen': {
      // ☠️ THE OTHER HALF OF THE `note` FIX. Making `note` stop reopening items
      // also removed the only way to reopen one on purpose - and in this run
      // three finished claims were later overturned by new evidence. Without
      // this the fix would trade "demands work on settled items" for the worse
      // failure "leaves overturned work marked done". So: loud, reasoned, and it
      // keeps the evidence that fell.
      const id = Number(head[0]);
      const it = s.items.find((i) => i.id === id);
      if (!it) fail(`no item ${head[0]}`);
      const why = head.slice(1).concat(tail).join(' ').trim();
      if (!why) fail(`usage: reopen ${id} "<what overturned it>"\n` +
        'Name the evidence that fell. Reopening without a reason is how a plan starts churning.');
      const was = it.ev ? ` (was closed with ${it.ev})` : '';
      it.status = 'todo';
      it.note = `☠️ REOPENED: ${why}${was}`;
      it.ev = '';
      break;
    }
    case 'consulting': {
      // ☠️ MARK IT WHEN YOU SEND, NOT WHEN IT ANSWERS. A review takes minutes to
      // come back; without this the gate re-fires on every Stop in between and
      // the same demand is read as three separate ones.
      const agent = head.join(' ').trim();
      if (!agent) fail('usage: consulting <agent-name-or-id>   (call it right after SendMessage)');
      // ☠️ IDEMPOTENT ON PURPOSE. A second call for the same agent refreshes the
      // clock rather than recording a parallel request - two live reviews of one
      // question duplicate the reviewer's work and leave the bookkeeping unable
      // to say which finding answered which prompt.
      const prev = s.consult || {};
      s.consult = Object.assign({}, prev, {
        agent,
        pendingAt: prev.pendingAt && prev.agent === agent ? prev.pendingAt : Date.now(),
        pendingRenewed: prev.pendingAt && prev.agent === agent ? Date.now() : 0,
      });
      break;
    }
    case 'consulted': {
      const agent = head.join(' ').trim();
      if (!agent) fail('usage: consulted <agent-name-or-id> [-- "<what the review said>"]\n' +
        'Record it when you LAUNCH the review (note "in flight"), then again with the findings.\n' +
        '☠️ The name is the point: the next review goes to the SAME agent by SendMessage so it ' +
        'keeps the history. A fresh agent starts blind and gives advice for a state that has moved.\n' +
        'If a review could not help right now, say so: consulted none -- "<why>".');
      s.consult = { agent, at: Date.now(), atRecords: records(s), note: tail.join(' ').trim(), pendingAt: 0 };
      s.consultAnnounced = false;
      break;
    }
    case 'measured': case 'retracted': {
      const text = tail.join(' ').trim();
      const lint = magnitudeLint(text);
      const hard = lint.filter((l) => l.hard);
      if (hard.length) fail('REFUSED: ' + hard.map((l) => l.msg).join('; ') +
        '\nEither the number is wrong or the unit is - check it before it becomes a standing claim.');
      for (const l of lint) console.error(`☠️ implausible: ${l.msg} — check it.`);
      if (scopeMissing(text)) fail('REFUSED: this claim uses a universal word ' +
        '(always / never / persistent / survives / NV-backed / mindig / soha / túléli) but says ' +
        'nothing about what was actually varied.\n' +
        '☠️ This is the most repeated mistake in this project: one boot\'s state stated as the ' +
        'phone\'s property, and a firmware restart read as reboot-persistence.\n' +
        'Add a `scope:` clause naming what the experiment varied — e.g. ' +
        '"scope: measured across a modem firmware restart only, NOT across a reboot".');
      if (cmd === 'measured') {
        const ev = head.join(' ').trim();
        if (!ev || !text) fail('usage: measured <evidence> -- "<the claim that now stands>"');
        const c = checkEvidence(s, ev);
        if (!c.ok) fail(`REFUSED: ${c.why}\n` +
          'Evidence is one token: <path> | <path>:<line> | commit:<sha> | capture:<dir> | unverifiable:<why>.\n' +
          '☠️ A claim recorded against evidence that does not exist is exactly the false record this gate exists to stop.');
        s.facts.push({ kind: 'measured', text, ev });
      } else {
        const claim = head.join(' ').trim();
        if (!claim || !text) fail('usage: retracted "<the claim>" -- "<why it fell>"');
        s.facts.push({ kind: 'retracted', text: claim, ev: text });
      }
      break;
    }
    case 'done': {
      const id = Number(head[0]);
      const it = s.items.find((i) => i.id === id);
      if (!it) fail(`no item ${head[0]}`);
      const ev = head.slice(1).join(' ').trim();
      if (!ev) fail(`REFUSED: done needs evidence — \`done ${id} <evidence> [-- <note>]\`\n` +
        'Evidence is one token: <path> | <path>:<line> | commit:<sha> | capture:<dir> | unverifiable:<why>.\n' +
        '☠️ 2026-08-31: an item was closed with the note "promoted to the skill (see below)" — a forward\n' +
        '   reference that was never fulfilled, and read on resume as finished work. Name the artefact.');
      const c = checkEvidence(s, ev);
      if (!c.ok) fail(`REFUSED: ${c.why}\nThe work is not done until the artefact exists. Do it, then say done.`);
      it.status = 'done'; it.ev = ev;
      if (tail.length) it.note = tail.join(' ');
      break;
    }
    case 'drop': case 'note': case 'wait': {
      const id = Number(rest[0]);
      const it = s.items.find((i) => i.id === id);
      if (!it) fail(`no item ${rest[0]}`);
      const text = rest.slice(1).join(' ');
      // ☠️ `note` RECORDS, IT DOES NOT REOPEN. The first version set status
      // 'doing' unconditionally, so writing down what happened un-finished the
      // item that had just been closed. Measured in one session: three items
      // closed with `done` were silently reopened by the `note` that followed,
      // and two `waiting` items were pulled back into the actionable list the
      // same way - each time the Stop gate then demanded work on something
      // already settled. Only a 'todo' is promoted; every other status stands.
      if (cmd === 'note') {
        if (it.status === 'todo') it.status = 'doing';
        it.note = text;
      }
      else if (cmd === 'wait') { it.status = 'waiting'; it.note = text || it.note; it.waitAt = Date.now(); }
      else { it.status = 'dropped'; if (text) it.note = text; }
      break;
    }
    case 'stop':
      s.active = false;
      break;
    case 'flush': case 'show':
      break;
    default:
      console.error('usage: start|add|note|wait|done|drop|measured|retracted|consulted|status|watch|flush|show|stop');
      process.exit(2);
  }
  if (cmd !== 'show') {
    // any edit is progress: give the anti-spin budget back and re-arm staleness
    if (cmd !== 'flush') { s.blocks = 0; s.waitAnnounced = ''; s.lastRecordAt = Date.now(); }
    s.lastHash = hash(s);
  }
  write(s);
  console.log(render(s));
  const facts = renderFacts(s);
  if (facts) console.log(facts);
  console.log(renderConsult(s));
  if (cmd !== 'show') {
    const w = flushStatus(s);
    if (w) console.log(`resume block written: ${w}`);
    else if (!s.statusFile) console.log('(no STATUS file set — `status <path>` makes the run survive a compaction)');
  }
  process.exit(0);
}

// ---------------------------------------------------------------- hooks
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  let ev; try { ev = JSON.parse(input); } catch { process.exit(0); }
  const s = read();
  const emit = (name, ctx) => process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: name, additionalContext: ctx },
  }));

  // ☠️ A FOREIGN SESSION IS TOLD, NEVER BLOCKED. Blocking another session's Stop
  // would trap it in a loop over a plan it must not touch; the point is to send
  // it back to the session that owns the run, not to jam it.
  if (s.active) {
    const foreign = ownershipBlock(s);
    if (foreign) {
      if (ev.hook_event_name === 'Stop') { process.exit(0); }
      emit(ev.hook_event_name,
        `☠️ There is an autonomous run in progress, and it is NOT this session's.\n${foreign}\n\n` +
        `Do not edit its plan, and do not touch the device it is measuring: another session may ` +
        `have something running on it right now.`);
      process.exit(0);
    }
    write(s);   // ownershipBlock refreshed the owner's heartbeat
  }

  // A compaction is imminent - flush the durable copy before the context goes.
  if (ev.hook_event_name === 'PreCompact') {
    if (s.active) flushStatus(s);
    process.exit(0);
  }

  // The session started, resumed, or came back from a compaction. THIS is the
  // one that makes an autonomous run survive: it needs no user prompt.
  if (ev.hook_event_name === 'SessionStart') {
    if (!s.active) process.exit(0);
    const src = ev.source || 'startup';
    const facts = renderFacts(s);
    const lp = precompactLatest();
    const stale = staleReasons(s);
    emit('SessionStart',
      `Autonomous run is ACTIVE (session source: ${src}). The plan and findings carried across ` +
      `the break:\n${renderPlan(s)}\n` +
      (facts ? `\n${facts}\n` : '') +
      `\n${renderConsult(s)}\n` +
      (stale.length ? `\n☠️ Results landed that the plan does not mention:\n  - ${stale.join('\n  - ')}\n` : '') +
      (s.statusFile ? `\nThe same block is in ${s.statusFile} between the FP3-AUTONOMY-RESUME markers.\n` : '') +
      (lp && src === 'compact' ? `Pre-compaction transcript snapshot: ${lp}\n` : '') +
      `\nContinue from here — do not re-derive what is listed above and do not re-open a ` +
      `RETRACTED claim. Edit the plan with \`node "${__filename}" done|note|wait|add|drop|measured|retracted|show ...\`.`);
    process.exit(0);
  }

  if (ev.hook_event_name === 'UserPromptSubmit') {
    // the user spoke: they can always redirect, so give the budget back
    if (s.active) {
      s.blocks = 0; write(s);
      const facts = renderFacts(s, true);
      emit('UserPromptSubmit',
        `Autonomous run in progress — the plan carried across turns:\n${renderPlan(s)}\n` +
        (facts ? `\n${facts}\n` : '') +
        `\n${renderConsult(s)}\n` +
        `Edit it with \`node "${__filename}" done|note|wait|add|drop|measured|retracted|show ...\`; ` +
        `\`stop\` ends the run.`);
    }
    process.exit(0);
  }

  if (ev.hook_event_name === 'Stop') {
    if (!s.active) process.exit(0);
    const open = openItems(s);
    const waiting = waitingItems(s);
    const h = hash(s);
    if (h !== s.lastHash) { s.blocks = 0; s.lastHash = h; }

    // ☠️ The staleness gate shares the anti-spin budget on purpose: a second
    // budget is a second way to spin. It fires when a result has landed - a new
    // capture, uncommitted docs - and nothing in the plan mentions it, which is
    // precisely the state an auto-compaction turns into lost work.
    const stale = staleReasons(s);
    if (stale.length && s.blocks < MAX_BLOCKS) {
      s.blocks += 1; write(s); flushStatus(s);
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason:
          `Results have landed that the run state does not record:\n  - ${stale.join('\n  - ')}\n\n` +
          `Write them down before the turn ends — an auto-compaction here loses them.\n` +
          `  \`node "${__filename}" measured <evidence> -- "<what now stands>"\`\n` +
          `  \`node "${__filename}" retracted "<claim>" -- "<why it fell>"\`  (never delete a ` +
          `disproven claim; a deleted one gets rediscovered)\n` +
          `  \`node "${__filename}" note <id> "<what happened>"\`, or commit the docs.\n` +
          `Any of those clears this. If the files are genuinely nothing to record — scratch ` +
          `output, a half-written page — commit or remove them and say so.`,
      }));
      process.exit(0);
    }

    // Outside review. It SHARES the anti-spin budget - a second budget is a
    // second way to spin - and fires at most once per due-window: recording the
    // review clears it, and so does running out of budget.
    const due = consultDue(s);
    if (!due && s.consultAnnounced) { s.consultAnnounced = false; write(s); }
    if (due && !s.consultAnnounced && s.blocks < MAX_BLOCKS) {
      s.blocks += 1; s.consultAnnounced = true; write(s); flushStatus(s);
      if (due.startsWith('PENDING:')) {
        // ☠️ CHASE THE ONE THAT IS OUT; DO NOT START ANOTHER. A second reviewer
        // asked the same question duplicates the work and, worse, answers a
        // state that has moved - the dated trap in this repo's own notes.
        process.stdout.write(JSON.stringify({
          decision: 'block',
          reason:
            `A review has been out for ${due.slice(8)} minutes with ${(s.consult || {}).agent} ` +
            `and has not been recorded.\n\n` +
            `Do NOT start a second one. Either it is still working - say so and carry on - or ` +
            `chase it at the SAME agent:\n  ${consultCall(s)}\n\n` +
            `When it lands: \`node "${__filename}" consulted ${(s.consult || {}).agent} -- ` +
            `"<the headline findings>"\`. If it will not land, close the loop honestly: ` +
            `\`consulted none -- "<why>"\`.`,
        }));
        process.exit(0);
      }
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason:
          `An outside review is due — ${due}.\n\n` +
          `Ask for one now, and put the CURRENT data in the prompt. ☠️ A review written against ` +
          `a state that has already moved answers that older state; that has already happened ` +
          `once in this run.\n\n  ${consultCall(s)}\n\n` +
          `Mark it in flight the moment you send, or this repeats every turn while the ` +
        `answer is on its way:\n  \`node "${__filename}" consulting <agent-name>\`\n` +
        `Then record it — this does not clear until you do:\n` +
          `  \`node "${__filename}" consulted <agent-name> -- "<the headline findings>"\`\n` +
          `and turn what survives into plan items (\`add\`) or standing facts (\`measured\`). ` +
          `☠️ Check its numbers against this run's own measurements before adopting them — a ` +
          `review can be arithmetically wrong, and one in this run was.\n` +
          `Relay to the user what the review actually said; its report is not shown to them.\n` +
          `If a review genuinely cannot help right now, say why: \`consulted none -- "<why>"\`.`,
      }));
      process.exit(0);
    }

    if (!open.length && waiting.length) {
      // ☠️ SAY IT ONCE. The first version emitted this summary on every Stop, so a
      // long wait produced the same paragraph turn after turn - the assistant
      // repeated it to the user each time because it arrives as fresh context.
      // A reminder that repeats unchanged is noise, and noise trains the reader to
      // skip the channel it arrives on. Re-announce only when the set of waiting
      // items actually changes.
      const wsig = waiting.map((i) => `${i.id}:${i.note || ''}`).join('|');
      if (s.waitAnnounced === wsig) { write(s); process.exit(0); }
      s.waitAnnounced = wsig; write(s); flushStatus(s);
      emit('Stop',
        `Every actionable item is done; ${waiting.length} item(s) are waiting on something ` +
        `outside this session:\n` +
        [...waiting].sort(byPrio).map((i) =>
          `  … ${i.id}. ${clip(i.text, 90)}\n        ⟵ ${clip(i.note, 90) || 'reason unstated'}`).join('\n') +
        `\nNot blocking, and no reply is owed. ☠️ A gate that can be satisfied with text ` +
        `teaches writing, not working: pass it by mutating state (done / wait / drop / reopen), ` +
        `never by narrating. Tell the user something when a measurement turned or they asked - ` +
        `not to prove you are alive.`);
      process.exit(0);
    }
    if (!open.length) {
      flushStatus(s);
      emit('Stop',
        'Every item in the autonomous plan is finished. Either add the next steps ' +
        `(\`node "${__filename}" add "..."\`) or close the run (\`stop\`) and say so.`);
      process.exit(0);
    }
    if (s.blocks >= MAX_BLOCKS) {
      write(s); flushStatus(s);
      emit('Stop',
        `☠️ The autonomous plan has not changed across ${MAX_BLOCKS} turns while ` +
        `${open.length} item(s) are still open. Not blocking again — that would spin. ` +
        `Tell the user plainly what is blocking item ${nextItem(open).id} ` +
        `("${clip(nextItem(open).text, 120)}") ` +
        `and what you need from them.`);
      process.exit(0);
    }
    const nx = nextItem(open);
    s.blocks += 1; write(s); flushStatus(s);
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason:
        `Autonomous run is active and the plan still has open work. Do not stop to ask — ` +
        `continue with the next item now.\n\n${renderPlan(s)}\n\n` +
        `NEXT (highest priority open item): ${nx.id}. ${clip(nx.text, 160)}\n` +
        `  \`node "${__filename}" note|done|wait|add ...\` — and \`wait ${nx.id} "<what for>"\` ` +
        `if it cannot be worked on right now (a window that must run its course, a build, a ` +
        `boot, an answer only the user can give). Reaching for something else instead is how ` +
        `a measurement gets disturbed.`,
    }));
    process.exit(0);
  }
  process.exit(0);
});
