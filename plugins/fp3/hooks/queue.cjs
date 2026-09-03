#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// AI-generated (Claude Opus 5) under the direction of Lajosházi, László Gergely.
//
// fp3 queue hook — hands a stopped agent its next task, and otherwise gets out
// of the way.
//
// ☠️ WHY THIS REPLACES `autonomy.cjs`. That hook kept its own plan: 124 items and
// 100 recorded facts in a state file, beside a `docs/TODO.md` that had not been
// touched in four days. Two lists is not redundancy, it is a question with two
// answers - "the user's words: külön van listája a hooknak és külön van todo csak
// megnehezíti a feladatok követését". And measured on the live state, the per-turn
// reminder it emitted was 71 % fact list against 24 % anything to do with the
// work, so the thing it interrupted every turn to say was mostly not the work.
//
// The specification this file implements, in the user's words:
//
//   "a hooknak egyáltalán nem kellene listát tartalmaznia, hiszen ott a TODO. A
//    hook dolga csak annyi, hogy a leállt agentnek megüzeni mi a következő
//    feladat, és csak addig hagyja aludni az agentet, amíg a háttérben futó
//    tevékenység indokolja (de ha nincs futó feladat, akkor ne altasson
//    fölöslegesen). A hook egyetlen célja, hogy a feladatok ki legyenek osztva és
//    folyamatos legyen a haladás fölösleges várakozások nélkül."
//
// So: THE QUEUE IS A SECTION OF docs/TODO.md. This file parses it and holds no
// tasks of its own. What it does keep is one integer - see ANTI-SPIN below - and
// that is deliberately not a list.
//
// ☠️ AND THE "ott a TODO" ARGUMENT ONLY HALF HELD, WHICH IS WHY THE QUEUE IS A
// SECTION AND NOT THE WHOLE FILE. Measured before writing this: docs/TODO.md is
// 3713 lines, 40 narrative "##" items and ZERO checkboxes - a dated dossier, not
// a task list. A third file next to it would have repeated the very mistake being
// fixed, so the queue lives at the top of that same file, between markers, and
// the dossier below it stays exactly what it is.

'use strict';
const fs = require('fs');
const path = require('path');
// ☠️ NEVER let bookkeeping break a turn: every gatelog call is wrapped.
let gatelog = null;
try { gatelog = require('./gatelog.cjs'); } catch { /* optional */ }
const gl = (fn, ...a) => { try { return gatelog ? gatelog[fn](...a) : ''; } catch { return ''; } };

const TODO = process.env.FP3_QUEUE_FILE ||
  '/mnt/1TB/pmos/fp3-pmaports/docs/TODO.md';
// ☠️ ARCHIVING WAS AN UNASSIGNED MANUAL STEP. This file's own comment used to say
// a finished task is "kept only until somebody moves it to TODO-DONE.md" - and
// nobody was somebody. A queue that only ever grows stops being readable, which
// is the complaint that produced the whole redesign.
const DONE_FILE = process.env.FP3_DONE_FILE ||
  path.join(path.dirname(TODO), 'TODO-DONE.md');
const DONE_HEAD = '# Closed from the queue';
const BEGIN = '<!-- FP3-QUEUE:BEGIN -->';
const END = '<!-- FP3-QUEUE:END -->';
const STATE_DIR = process.env.CLAUDE_STATE_DIR ||
  path.join(process.env.HOME || '/home/fp3', '.claude', '.state');
const STATE = path.join(STATE_DIR, 'fp3-queue.json');

// ☠️ CLAIMS EXIST BECAUSE TWO WINDOWS GOT THE SAME TASK. Measured 2026-09-03
// with two simulated sessions against one queue: both were handed "1. Elso
// feladat". Nothing in the design stopped that - the hook read the file, took
// ready[0] and blocked, and read-only is not coordination.
//
// ☠️ AND THE CLAIM DELIBERATELY DOES NOT LIVE IN TODO.md. Writing the claim into
// the document would make every dispatch a write to the one file every window
// shares - i.e. it would CREATE the write collision it is meant to prevent, and
// churn the git history with coordination noise. The queue is *what to do*; the
// claim is *who is on it this minute*, and a minute-scale fact does not belong in
// a document that is reviewed and committed.
//
// ☠️ CORRECTED: an earlier version of this comment said the queue "stays
// human-owned". It does not, and the correction matters because the whole write
// model hangs off it. Only the GOAL is the person's. Agents edit the queue
// routinely - adding tasks, changing `after:`, marking things done - and from
// several windows at once. So a whole-file rewrite of TODO.md is the NORMAL
// operation, not the exception, and every edit has to go through the same lock
// and re-read as `done` does. That is what the `add`/`set`/`mark` subcommands are
// for: an agent that edits this file with a text editor instead is racing every
// other window, and the loser's edit disappears without a sound.
const CLAIMS = path.join(STATE_DIR, 'fp3-queue-claims.json');
// A window that dies holding a claim must not park the task for ever.
const CLAIM_TTL_MIN = 90;

// ☠️ ANTI-SPIN IS THE ONE PIECE OF STATE, AND IT IS NOT NEGOTIABLE. A Stop hook
// that blocks to hand out a task will hand out the SAME task for ever if the task
// cannot be started - the agent replies, the hook fires, the agent replies. The
// predecessor learned this the expensive way and the budget is carried over
// verbatim in spirit: at most MAX_NUDGE consecutive blocks for one unchanged
// queue, then it lets the turn end and says why.
const MAX_NUDGE = 3;

const readState = () => {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
};
const writeState = (s) => {
  try {
    fs.mkdirSync(path.dirname(STATE), { recursive: true });
    const tmp = `${STATE}.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
    fs.renameSync(tmp, STATE);           // atomic: a torn state file loses the run
  } catch { /* a hook must never be the reason a turn fails */ }
};

// ☠️ AN EXCLUSIVE-CREATE LOCK, NOT A MUTEX. `wx` fails if the file exists, which
// is the one atomic primitive available across processes here. It is held for the
// microseconds of a read-modify-write and released in a finally, and a lock older
// than a minute is broken on sight - a lock that can outlive its holder is worse
// than no lock, because it stops the work silently.
function withLock(fn) {
  const lock = `${CLAIMS}.lock`;
  for (let i = 0; i < 50; i++) {
    try {
      const fd = fs.openSync(lock, 'wx');
      try { fs.writeSync(fd, String(process.pid)); fs.closeSync(fd); return fn(); }
      finally { try { fs.unlinkSync(lock); } catch { /* already gone */ } }
    } catch (e) {
      if (e.code !== 'EEXIST') return fn();          // no lock is better than no work
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 60000) fs.unlinkSync(lock);
      } catch { /* raced with the holder */ }
      // busy-wait briefly; this is contended for microseconds, not seconds
      const until = Date.now() + 20;
      while (Date.now() < until) { /* spin */ }
    }
  }
  return fn();
}

const readClaims = () => {
  try { return JSON.parse(fs.readFileSync(CLAIMS, 'utf8')); } catch { return {}; }
};
// ☠️ THE COMPLETION RECORD IS PRESERVED UNLESS THE CALLER REPLACES IT, and that
// is not a nicety. Callers build their new state from `liveClaims()`, which
// strips `__completed` because it is a different kind of record with a different
// lifetime - so the first claim taken after a completion was silently erasing the
// history the affinity depends on. Found by the first-refusal test, one step after
// the feature it broke appeared to work.
function writeClaims(c) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const prevAll = readClaims();
    for (const k of ['__completed', '__device']) {
      if (!(k in c) && prevAll[k]) c = Object.assign({}, c, { [k]: prevAll[k] });
    }
    const tmp = `${CLAIMS}.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(c, null, 1));
    fs.renameSync(tmp, CLAIMS);
  } catch { /* coordination must never fail a turn */ }
}
// Expired claims are dropped on every read, so a window that was closed mid-task
// releases it by doing nothing.
function liveClaims() {
  const c = readClaims(), out = {}, cut = Date.now() - CLAIM_TTL_MIN * 60000;
  for (const [id, v] of Object.entries(c)) {
    if (id.startsWith('__')) continue;           // a different record with its own life
    if (v && v.at > cut) out[id] = v;
  }
  return out;
}
// Completions expire on the affinity window, not the claim TTL: the claim is
// "I am on it", the completion is "I still remember it".
// The device lease: who holds the phone, through which task, since when. It
// expires with the claim TTL, and a running measurement counts as held by
// whoever started it (measurement-watch keeps no session, so it reads as "busy,
// not yours" to everyone - which is the safe reading).
function deviceLease() {
  const c = readClaims();
  const d = c.__device;
  if (d && d.at > Date.now() - CLAIM_TTL_MIN * 60000) return d;
  return null;
}
function measurementRunning() {
  try {
    const m = JSON.parse(fs.readFileSync(MEAS, 'utf8'));
    const cut = Date.now() - 6 * 60 * 60 * 1000;
    return Object.keys(m).filter((u) => m[u] && !m[u].done && (m[u].started || 0) > cut);
  } catch { return []; }
}
function deviceBusy(me) {
  const d = deviceLease();
  if (d && d.session !== me) return `leased to ${d.session} (task ${d.task})`;
  const run = measurementRunning();
  if (run.length && !(d && d.session === me)) return `measurement running: ${run.join(', ')}`;
  return '';
}
function laneOf(me, all) {
  const env = String(process.env.FP3_LANE || '').toLowerCase();
  if (LANES.includes(env) && env !== 'any') return env;
  const st = all && all[me];
  if (st && LANES.includes(st.lane) && st.lane !== 'any') return st.lane;
  return '';
}

function completions() {
  const c = (readClaims().__completed) || {}, out = {}, cut = Date.now() - AFFINITY_MIN * 60000;
  for (const [id, v] of Object.entries(c)) if (v && v.at > cut) out[id] = v;
  return out;
}

// --- parsing ---------------------------------------------------------------
//
// A task is a checkbox line; everything indented under it belongs to it. The
// markers, and what each one means to this hook:
//
//   [ ]  ready — may be handed out
//   [~]  waiting on something outside the session (a measurement, a timer)
//   [@]  needs a person; never handed to the agent
//   [x]  done — set by hand; `done <id>` moves the task out instead
//
// ☠️ THE KEYS ARE FEW ON PURPOSE. Every key here replaces prose that used to say
// the same thing worse: `after:` replaces "PARKOL, a 116. mögé", `until:`
// replaces "a telefon foglalt 16:02-ig". A note that states a schedule in words
// goes stale silently and nothing re-reads it; a key is checked on every parse.
// ☠️ `continues:` IS NOT `after:`, AND THE LIVE QUEUE SHOWS WHY. Seven tasks sit
// `after: 85`, but only one of them - "evaluate the night's balance" - is a
// continuation of 85's work; the other six are merely GATED on its result and are
// different work entirely (an SMSM A/B, a driver change, a wrapper). Reusing
// `after:` for affinity would hand the agent that ran the replication a kernel
// patch because both mention 85. Only the author knows which follow-on carries
// the same context, so the author says so.
// ☠️ `lane:` IS THE ONE KEY THAT KNOWS ABOUT THE PHONE. Two kinds of work now run
// side by side - the upstreaming (mail, b4, the STATUS page: needs no device) and
// the power/bring-up measurements (needs THE phone, of which there is one). With
// no lane, whichever window stopped first was handed whichever task was on top:
// an upstreaming window got a flash-and-reboot, and two phone tasks could be
// dispatched to two windows and collide on the device mid-measurement (it has
// happened: "two sets of hands on one phone"). So: `lane: phone` marks a task
// that touches the device, `lane: upstreaming` one that must not, and a task
// with no lane is anybody's. A window declares its own lane (FP3_LANE=… in the
// environment, or `queue.cjs lane phone|upstreaming|any`) and is only handed
// tasks of that lane or of none. And the phone itself is a LEASE: claiming a
// `lane: phone` task takes it, `done`/`release` gives it back, a running
// unattended measurement (measurement-watch's state) holds it too - and no other
// window is handed a phone task while it is held.
const KEYS = ['after', 'continues', 'until', 'when', 'they-do', 'why', 'lane'];
const LANES = ['phone', 'upstreaming', 'any'];
const MEAS = path.join(STATE_DIR, 'fp3-measurements.json');

// How long a finished task's context is worth reusing, and how long its successor
// is held for the session that earned it. ☠️ Short on purpose: a session that
// finishes and goes quiet must not park its successor, and an hour-old context is
// not the advantage this exists to capture.
const AFFINITY_MIN = 120;
const FIRST_REFUSAL_MIN = 15;

function parse(text) {
  const b = text.indexOf(BEGIN), e = text.indexOf(END);
  if (b < 0 || e < 0 || e < b) return { err: `no ${BEGIN} … ${END} section in ${TODO}` };
  const body = text.slice(b + BEGIN.length, e).split('\n');
  const tasks = [];
  let cur = null;
  for (const raw of body) {
    const m = /^\s*-\s*\[([ x~@])\]\s*(?:(\d+)\.\s*)?(.*)$/.exec(raw);
    if (m) {
      cur = { mark: m[1], id: m[2] ? Number(m[2]) : null, text: m[3].trim(), line: raw };
      tasks.push(cur);
      continue;
    }
    const k = /^\s+([a-z-]+):\s*(.*)$/.exec(raw);
    if (k && cur && KEYS.includes(k[1])) { cur[k[1]] = k[2].trim(); continue; }
    // A blank line does not end a task; anything else unindented does.
    if (raw.trim() && !/^\s/.test(raw)) cur = null;
  }
  return { tasks };
}

const idsOf = (t) => String(t.after || '').split(/[,\s]+/).filter(Boolean).map(Number);

// ☠️ AN UNKNOWN PREREQUISITE COUNTS AS MET, AND THE HOOK SAYS SO OUT LOUD.
// Finished tasks leave this section for TODO-DONE.md, so "after: 116" with no 116
// in the queue is the normal way a dependency is satisfied. The failure mode is a
// typo, which would silently look finished - so it is never silent.
// ☠️ A CYCLE IN `after:` SILENTLY BLOCKS EVERYTHING IN IT, and looks exactly like
// a queue that is legitimately waiting. Ported from autonomy.cjs, which refused
// cycles at write time; here the queue is a hand-edited file, so it has to be
// detected at read time instead. Nothing else in this hook can tell the
// difference between "blocked" and "blocked for ever".
function cycles(tasks) {
  const byId = new Map(tasks.filter((t) => t.id != null).map((t) => [t.id, t]));
  const seen = new Map();           // id -> 0 visiting, 1 done
  const found = [];
  const walk = (id, stack) => {
    if (seen.get(id) === 1) return;
    if (seen.has(id)) { found.push([...stack.slice(stack.indexOf(id)), id].join(' → ')); return; }
    seen.set(id, 0);
    const t = byId.get(id);
    if (t) for (const n of idsOf(t)) walk(n, [...stack, id]);
    seen.set(id, 1);
  };
  for (const t of tasks) if (t.id != null) walk(t.id, []);
  return [...new Set(found)];
}

function blockedBy(t, byId) {
  const out = { open: [], unknown: [] };
  for (const id of idsOf(t)) {
    const p = byId.get(id);
    if (!p) out.unknown.push(id);
    else if (p.mark !== 'x') out.open.push(id);
  }
  return out;
}

function parseUntil(v) {
  if (!v) return 0;
  const s = String(v).trim();
  let m = /^(\d{4}-)?(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const y = m[1] ? Number(m[1].slice(0, 4)) : new Date().getFullYear();
    return new Date(y, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const d = new Date();
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    // ☠️ A BARE CLOCK TIME IS TODAY, AND IF IT HAS PASSED IT IS TOMORROW. Reading
    // it as today-always makes a 19:00 written at 20:00 render as "8 h ago",
    // which reads as a missed deadline rather than tonight.
    if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  return 0;
}

const clip = (t, n) => (String(t || '').length > n ? String(t).slice(0, n - 1) + '…' : String(t || ''));
const untilStr = (ms) => {
  const m = ms / 6e4;
  return m < 1 ? '<1 min' : m < 90 ? `${m.toFixed(0)} min` : `${(m / 60).toFixed(1)} h`;
};

// --- what to say -----------------------------------------------------------
function describe(t) {
  const out = [`  ${t.id != null ? `${t.id}. ` : ''}${t.text}`];
  if (t.why) out.push(`     why: ${t.why}`);
  if (t.until) out.push(`     until: ${t.until}`);
  return out.join('\n');
}

// ☠️ NEXT IS ABOUT THINGS THAT HAPPEN, NOT ABOUT REMINDERS TO LOOK AGAIN. This
// distinction is the whole reason the previous renderer could not answer "is
// anything happening between now and 19:00": it sorted a self-imposed "check this
// again at 10:24" together with a measurement that starts on a timer, and the
// reminder won because it was sooner.
function nextUp(tasks) {
  const c = tasks
    .filter((t) => t.mark !== 'x' && parseUntil(t.until) > Date.now())
    .map((t) => ({ at: parseUntil(t.until), t }))
    .sort((a, b) => a.at - b.at);
  return c[0] || null;
}

// ☠️ AN EXPIRED `until:` IS NOT A WAIT, IT IS A TASK NOBODY LOOKED AT AGAIN.
// autonomy.cjs swept these and made the item actionable again; here the marker is
// a person's word in a file, so the hook must not rewrite it - but staying silent
// turns "back at 10:24" into a permanent parking space, which is exactly the rot
// the prose-scheduling it replaced used to have. It says so and leaves the edit
// to a human.
function expired(tasks) {
  return tasks.filter((t) => t.mark === '~' && t.until &&
    parseUntil(t.until) && parseUntil(t.until) < Date.now());
}

function report(tasks, me, lane) {
  const byId = new Map(tasks.filter((t) => t.id != null).map((t) => [t.id, t]));
  const claims = liveClaims();
  const done = completions();
  const busy = deviceBusy(me);
  const ready = [], blocked = [], waiting = [], human = [], held = [], refused = [],
    otherLane = [], device = [];
  for (const t of tasks) {
    if (t.mark === 'x') continue;
    if (t.mark === '@') { human.push(t); continue; }
    const b = blockedBy(t, byId);
    t._b = b;
    if (b.open.length) blocked.push(t);
    else if (t.mark === '~') waiting.push(t);
    else {
      const cl = t.id != null ? claims[String(t.id)] : null;
      // Mine is still mine: a window re-reading its own claim must get its task
      // back, or a second Stop in the same session would hand it something else.
      if (cl && me && cl.session !== me) { held.push({ t, cl }); continue; }
      // ☠️ THE LANE FILTER COMES BEFORE FIRST REFUSAL: a task in the wrong lane is
      // not "held briefly", it is never this window's.
      if (lane && t.lane && t.lane !== 'any' && t.lane !== lane) { otherLane.push(t); continue; }
      if (t.lane === 'phone' && busy) { device.push(t); continue; }
      // ☠️ FIRST REFUSAL FOR THE SESSION THAT EARNED IT. When two agents finish at
      // the same moment, whichever one stops first would otherwise take the
      // other's follow-on - and a follow-on handed to an empty context is paid for
      // twice: once to rebuild what the other agent already had, and once in the
      // mistakes that rebuild makes. So a task that `continues:` something another
      // session completed in the last FIRST_REFUSAL_MIN is skipped here. After
      // that window it is anybody's: a held task is worse than a cold one.
      const cont = String(t.continues || '').split(/[,\s]+/).filter(Boolean);
      const own = cont.map((id) => done[id]).find(Boolean);
      if (own && me && own.session !== me &&
          Date.now() - own.at < FIRST_REFUSAL_MIN * 60000) {
        refused.push({ t, own }); continue;
      }
      ready.push(own && own.session === me ? Object.assign(t, { _mine: true }) : t);
    }
  }
  // ☠️ MY OWN CONTINUATION GOES FIRST, and only that. Beyond it the file's order
  // is the priority a person set, and a scheduler that reorders on its own guesses
  // is a scheduler nobody can predict.
  ready.sort((a, b) => (b._mine ? 1 : 0) - (a._mine ? 1 : 0));
  return { ready, blocked, waiting, human, held, refused, otherLane, device, busy, lane, byId,
    cycles: cycles(tasks), expired: expired(tasks) };
}

function idleText(r, tasks) {
  const n = nextUp(tasks);
  const lines = [];
  if (r.cycles.length) {
    lines.push(`☠️ CIRCULAR \`after:\` — these can never start, and it does not look ` +
      `different from waiting:\n  ${r.cycles.join('\n  ')}`);
  }
  if (r.expired.length) {
    lines.push('☠️ `until:` has passed and the marker still says waiting — decide, do ' +
      'not let it park:\n  ' + r.expired.map((t) =>
        `${t.id}. ${clip(t.text, 70)}  (until ${t.until})`).join('\n  '));
  }
  // ☠️ "THE QUEUE IS EMPTY" WAS A LIE WHEN ANOTHER WINDOW HELD THE WORK. Caught on
  // the claim feature's own TTL test: one task, claimed elsewhere, and this said
  // the queue was empty - which reads as "there is nothing left to do" rather than
  // "somebody else is doing it". The two call for opposite reactions.
  const parts = [];
  if (r.waiting.length) parts.push(`${r.waiting.length} waiting on something outside this session`);
  if (r.blocked.length) parts.push(`${r.blocked.length} blocked behind another task`);
  if (r.human.length) parts.push(`${r.human.length} with a person`);
  if (r.refused.length) {
    parts.push(`${r.refused.length} held briefly for the session that earned them (` +
      r.refused.map(({ t, own }) => `${t.id}→${own.session}`).join(', ') + ')');
  }
  if (r.held.length) {
    parts.push(`${r.held.length} claimed by another window (` +
      r.held.map(({ t, cl }) => `${t.id}→${cl.session}`).join(', ') + ')');
  }
  if (r.otherLane.length) {
    parts.push(`${r.otherLane.length} in another lane than this window's (${r.lane}): ` +
      r.otherLane.map((t) => `${t.id}[${t.lane}]`).join(', '));
  }
  if (r.device.length) {
    parts.push(`${r.device.length} need the phone and the phone is ${r.busy}: ` +
      r.device.map((t) => t.id).join(', '));
  }
  lines.push(parts.length
    ? `IDLE — nothing can be started here: ${parts.join(', ')}.`
    : 'IDLE — the queue is empty.');
  lines.push(n
    ? `NEXT: ${new Date(n.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ` +
      `(in ${untilStr(n.at - Date.now())}) — ${n.t.id != null ? `${n.t.id}. ` : ''}${n.t.text}`
    : '☠️ NOTHING HAPPENS ON ITS OWN — no task carries an `until:`. If the run is ' +
      'waiting for a moment, nothing is keeping that moment: arm it on the device ' +
      'and write the time into the queue.');
  // ☠️ SAY WHAT NOT TO DO, BECAUSE THE FAILURE HERE IS INVENTED WORK. An idle
  // notice with no instruction gets answered by finding something to do, which is
  // how a plan grows items nobody asked for.
  lines.push('Do not schedule a wake-up for this and do not go looking for work: ' +
    'background work re-invokes you on its own, and the person is told what is waiting.');
  if (r.human.length) {
    lines.push('', 'WITH A PERSON — say this to them if it has not been said:');
    for (const t of r.human) {
      lines.push(`  ${t.id != null ? `${t.id}. ` : ''}${t.text}`);
      if (t.when) lines.push(`     when: ${t.when}`);
      if (t['they-do']) lines.push(`     they do: ${t['they-do']}`);
    }
  }
  return lines.join('\n');
}

// --- entry point -----------------------------------------------------------
function main() {
  const cli = process.argv[2];
  // ☠️ DO NOT TOUCH STDIN WHEN A SUBCOMMAND WAS GIVEN. `readFileSync(0)` on a
  // terminal blocks for ever waiting for input, so `queue.cjs check` hung until
  // it was killed - caught on the first run of this file. A hook is fed its event
  // on stdin; a person typing a subcommand is not feeding it anything.
  let ev = {};
  if (!cli) {
    let raw = '';
    try { raw = fs.readFileSync(0, 'utf8'); } catch { /* no stdin at all */ }
    try { ev = JSON.parse(raw || '{}'); } catch { ev = {}; }
  }

  // ☠️ THE SESSION ID COMES FROM THE HOOK INPUT, and the hook was throwing it
  // away: `session_id` is in every event and nothing read it. Without it there is
  // no "who", and without a who there is no claim and no per-window state.
  const me = String(ev.session_id || process.env.CLAUDE_CODE_SESSION_ID ||
    process.env.CLAUDE_SESSION_ID || '').slice(0, 12) || (cli ? 'cli' : '');

  let text;
  try { text = fs.readFileSync(TODO, 'utf8'); } catch (e) {
    if (cli) { console.error(`cannot read ${TODO}: ${e.message}`); process.exit(1); }
    process.exit(0);                     // a missing queue must not break a turn
  }
  const { tasks, err } = parse(text);
  if (err) {
    if (cli) { console.error(err); process.exit(1); }
    process.exit(0);
  }
  // `lane <phone|upstreaming|any>` - this window's lane, kept per session.
  if (cli === 'lane') {
    const v = String(process.argv[3] || '').toLowerCase();
    if (!LANES.includes(v)) { console.error(`usage: lane <${LANES.join('|')}>`); process.exit(1); }
    const all = readState();
    (all[me] || (all[me] = {})).lane = v;
    writeState(all);
    console.log(`lane of ${me || '(no session id)'} = ${v}` +
      (process.env.FP3_LANE ? `  (FP3_LANE=${process.env.FP3_LANE} in the environment wins)` : ''));
    process.exit(0);
  }
  const lane = laneOf(me, readState());
  const r = report(tasks, me, lane);

  // ☠️ EVERY WRITE TO THE QUEUE GOES THROUGH HERE, not only `done`. Agents add
  // tasks, change `after:` and close items, from several windows at once; an
  // agent that opens TODO.md in an editor and writes it back whole is racing
  // every other window, and the loser's edit vanishes silently. These take the
  // lock, RE-READ inside it, change the minimum, and rename atomically.
  const EDIT = { add: 1, set: 1, mark: 1 };
  if (EDIT[cli]) {
    const out = withLock(() => {
      const cur = fs.readFileSync(TODO, 'utf8');
      const b = cur.indexOf(BEGIN), e = cur.indexOf(END);
      if (b < 0 || e < 0) return `no queue section in ${TODO}`;
      const head = cur.slice(0, b + BEGIN.length), body = cur.slice(b + BEGIN.length, e),
        tail = cur.slice(e);
      let next = body;

      if (cli === 'add') {
        // validated below through KEYS; `lane:` gets its value checked here
        // because a misspelt lane would silently mean "anybody's".
        // ☠️ THE KEYS ARRIVE AS ONE `;`-SEPARATED ARGUMENT, so the value has to be
        // cut at the `;` before it is judged — the first version compared
        // "upstreaming;" against the list and refused every valid lane.
        // ☠️ AND ONLY THE PART AFTER `--` IS KEYS: joined whole, the task text
        // sat in front of "lane:" and the anchored match never saw it, so a bogus
        // lane went straight into the queue (task 132, dropped).
        {
          const av = process.argv.slice(3), s = av.indexOf('--');
          const keyStr = s < 0 ? '' : av.slice(s + 1).join(' ');
          for (const k of keyStr.split(/\s*;\s*/)) {
            const m = /^\s*lane:\s*(\S+)\s*$/.exec(k);
            if (m && !LANES.includes(m[1])) return `lane must be one of ${LANES.join('|')}`;
          }
        }
        const argv = process.argv.slice(3);
        const sep = argv.indexOf('--');
        const text = (sep < 0 ? argv : argv.slice(0, sep)).join(' ').trim();
        if (!text) return 'usage: add "<text>" [-- key: value ...]';
        // ☠️ THE ID IS ALLOCATED INSIDE THE LOCK. Two windows adding at the same
        // moment would otherwise both read the same maximum and both write it,
        // and two tasks with one number breaks every `after:` that names it.
        const ids = [...cur.matchAll(/^\s*-\s*\[[ x~@]\]\s*(\d+)\./gm)].map((m) => Number(m[1]));
        const id = (ids.length ? Math.max(...ids) : 0) + 1;
        const keys = sep < 0 ? [] : argv.slice(sep + 1).join(' ')
          .split(/\s*;\s*/).filter(Boolean).map((k) => `      ${k.trim()}`);
        next = body.replace(/\n*$/, '\n') + `- [ ] ${id}. ${text}\n` +
          (keys.length ? keys.join('\n') + '\n' : '');
        var added = id;
      } else {
        const id = Number(process.argv[3]);
        if (!id) return `usage: ${cli} <id> …`;
        const line = new RegExp(`^\\s*-\\s*\\[([ x~@])\\]\\s*${id}\\.`, 'm');
        if (!line.test(body)) return `no task ${id} in the queue`;
        if (cli === 'mark') {
          const m = process.argv[4];
          if (!/^[ x~@]$/.test(m || '')) return "usage: mark <id> ' '|x|~|@";
          next = body.replace(line, (s0) => s0.replace(/\[[ x~@]\]/, `[${m}]`));
        } else {
          const key = process.argv[4], val = process.argv.slice(5).join(' ').trim();
          if (!KEYS.includes(key)) return `usage: set <id> <${KEYS.join('|')}> <value>`;
          if (key === 'lane' && val && !LANES.includes(val)) return `lane must be one of ${LANES.join('|')}`;
          const at = body.search(line);
          const after = body.slice(at);
          const endOfTask = after.slice(1).search(/\n\s*-\s*\[[ x~@]\]|\n\S/);
          const blockEnd = endOfTask < 0 ? body.length : at + 1 + endOfTask;
          let blk = body.slice(at, blockEnd);
          const kre = new RegExp(`^\\s+${key}:.*$`, 'm');
          blk = kre.test(blk)
            ? (val ? blk.replace(kre, `      ${key}: ${val}`) : blk.replace(kre + '\n', ''))
            : (val ? blk.replace(/\n?$/, `\n      ${key}: ${val}`) : blk);
          next = body.slice(0, at) + blk + body.slice(blockEnd);
        }
      }

      // ☠️ VALIDATE BEFORE COMMITTING THE WRITE. A malformed edit would not throw;
      // it would silently drop tasks from the parse, and the next dispatch would
      // hand out the wrong one.
      const check = parse(head + next + tail);
      if (check.err) return `refusing to write: ${check.err}`;
      const before = parse(cur).tasks.length;
      const afterN = check.tasks.length;
      if (cli !== 'add' && afterN !== before) {
        return `refusing to write: task count would change ${before} → ${afterN}`;
      }
      const tmp = `${TODO}.${process.pid}`;
      fs.writeFileSync(tmp, head + next + tail);
      fs.renameSync(tmp, TODO);
      return cli === 'add' ? `added ${added}` : `${process.argv[3]} updated`;
    });
    console.log(out);
    process.exit(/refusing|usage|no task|no queue/.test(out) ? 1 : 0);
  }

  // ☠️ MARKING A TASK DONE IS A READ-MODIFY-WRITE ON A SHARED FILE, so it happens
  // under the lock and touches ONE line. The alternative - rewriting TODO.md whole
  // from two windows - is last-writer-wins with silent loss, and that is how the
  // queue itself would be corrupted by the very concurrency this release adds.
  // `drop <id>` — remove a task that should never have been added, without an
  // archive entry. `done` is for work that happened; this is for a typo.
  if (cli === 'done' || cli === 'release' || cli === 'drop') {
    const id = Number(process.argv[3]);
    if (!id) { console.error(`usage: ${cli} <id>`); process.exit(1); }
    const out = withLock(() => {
      const cur = fs.readFileSync(TODO, 'utf8');
      const re = new RegExp(`^(\\s*-\\s*\\[)[ x~@](\\]\\s*${id}\\.)`, 'm');
      if (!re.test(cur)) return `no task ${id} in the queue`;
      if (cli === 'done' || cli === 'drop') {
        // Cut the whole task block - the checkbox line and its indented keys.
        const b = cur.indexOf(BEGIN), e = cur.indexOf(END);
        const body = cur.slice(b + BEGIN.length, e);
        const at = body.search(re);
        const rest = body.slice(at + 1);
        const nl = rest.search(/\n\s*-\s*\[[ x~@]\]/);
        const blockEnd = nl < 0 ? body.length : at + 1 + nl;
        const block = body.slice(at, blockEnd).replace(/\n*$/, '');
        const nextBody = (body.slice(0, at) + body.slice(blockEnd)).replace(/^\n+/, '\n');
        const nextTodo = cur.slice(0, b + BEGIN.length) + nextBody + cur.slice(e);

        const chk = parse(nextTodo);
        if (chk.err) return `refusing to write: ${chk.err}`;
        if (chk.tasks.length !== parse(cur).tasks.length - 1) {
          return `refusing to write: task count would go ` +
            `${parse(cur).tasks.length} → ${chk.tasks.length}, expected one less`;
        }

        // ☠️ APPEND FIRST, REMOVE SECOND. Two files cannot be written atomically
        // together, so the order decides which way a crash fails. Appending first
        // risks a duplicate entry - visible, and removable by hand. Removing first
        // risks losing the record entirely. A duplicate beats a loss.
        if (cli === 'drop') {
          const tmp0 = `${TODO}.${process.pid}`;
          fs.writeFileSync(tmp0, nextTodo); fs.renameSync(tmp0, TODO);
          const c0 = liveClaims(); delete c0[String(id)];
          const l0 = readClaims().__device;
          c0.__device = (l0 && Number(l0.task) === id) ? null : l0;
          writeClaims(c0);
          return `${id} dropped (not archived)`;
        }
        let done = '';
        try { done = fs.readFileSync(DONE_FILE, 'utf8'); } catch { done = ''; }
        if (!done.includes(DONE_HEAD)) {
          done = done.replace(/\n*$/, '\n') +
            `\n---\n\n${DONE_HEAD}\n\n` +
            'Tasks closed out of the `FP3-QUEUE` section of [`TODO.md`](TODO.md),\n' +
            'newest last, moved by `queue.cjs done`. The item number is the original\n' +
            'so that `after:` and `continues:` references still resolve.\n';
        }
        // ☠️ THE ARCHIVED ENTRY IS RE-RENDERED, NOT PASTED. Pasting the block
        // verbatim kept its `- [ ]` marker - a finished task filed as not done -
        // and nested the whole thing under a date bullet, which is not the shape
        // the rest of this file uses. Match the file: `- [x] **id.** text`, keys
        // indented under it, and the closing date on the same line.
        const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const lines = block.trim().split('\n');
        const head0 = lines[0].replace(/^\s*-\s*\[[ x~@]\]\s*(\d+)\.\s*/, '');
        const keys = lines.slice(1).map((l) => `      ${l.trim()}`);
        done = done.replace(/\n*$/, '\n') +
          `\n- [x] **${id}.** ${head0}  — closed ${stamp}\n` +
          (keys.length ? keys.join('\n') + '\n' : '');
        const dtmp = `${DONE_FILE}.${process.pid}`;
        fs.writeFileSync(dtmp, done); fs.renameSync(dtmp, DONE_FILE);

        const tmp = `${TODO}.${process.pid}`;
        fs.writeFileSync(tmp, nextTodo); fs.renameSync(tmp, TODO);
      }
      const c = liveClaims();
      // ☠️ ATTRIBUTE THE COMPLETION TO WHOEVER CLAIMED IT, NOT TO WHOEVER TYPED
      // `done`. Caught by the affinity feature's own first test: `done` runs from
      // the command line, where the hook's `session_id` is absent, so every
      // completion was recorded against "cli" and no successor could ever match a
      // session.
      //
      // Two things fixed it, and they answer different questions. `me` now falls
      // back to $CLAUDE_CODE_SESSION_ID, which IS exported into the Bash
      // environment - an earlier version of this comment said it was not, which
      // was wrong and was corrected by running `env`. That answers "who am I".
      // This line answers "who earned this", which is not the same: the claim
      // records who took the task, and a task may be closed from a different
      // window than the one that did it.
      const owner = (c[String(id)] && c[String(id)].session) || me;
      delete c[String(id)];
      // The phone goes back with the task that held it.
      const lease = readClaims().__device;
      c.__device = (lease && Number(lease.task) === id) ? null : lease;
      const prev = readClaims().__completed || {};
      if (cli === 'done') prev[String(id)] = { session: owner, at: Date.now() };
      c.__completed = prev;
      writeClaims(c);
      return cli === 'done'
        ? `${id} archived to ${path.basename(DONE_FILE)} and released (credited to ${owner})`
        : `${id} released`;
    });
    console.log(out);
    process.exit(0);
  }
  if (cli === 'claims') {
    const c = liveClaims();
    const e = Object.entries(c);
    const d = deviceLease(), run = measurementRunning();
    console.log(`phone: ${d ? `leased to ${d.session} via task ${d.task}` : 'free'}` +
      (run.length ? `; measurement running: ${run.join(', ')}` : ''));
    if (!e.length) { console.log('no live claims'); process.exit(0); }
    for (const [id, v] of e.sort((a, b) => a[1].at - b[1].at)) {
      console.log(`  ${id}. held by ${v.session} for ${((Date.now() - v.at) / 6e4).toFixed(0)} min` +
        `  ${v.text || ''}`);
    }
    process.exit(0);
  }

  if (cli === 'show' || cli === 'next' || cli === 'check') {
    const unknown = tasks.flatMap((t) => (t._b ? t._b.unknown : []).map((u) => `${t.id} → ${u}`));
    if (cli === 'next') {
      console.log(r.ready.length ? describe(r.ready[0]) : idleText(r, tasks));
    } else {
      console.log(`${r.ready.length} ready · ${r.blocked.length} blocked · ` +
        `${r.waiting.length} waiting · ${r.human.length} with a person` +
        `   (this window: lane ${r.lane || 'any'}; phone ${r.busy || 'free'})`);
      for (const t of r.ready) console.log(`  [${t._mine ? '★' : ' '}] ${t.id}. ${t.text}` +
        (t.lane ? `   [${t.lane}]` : '') +
        (t._mine ? '   ← continues work this session finished' : ''));
      for (const t of r.otherLane) console.log(`  [≠] ${t.id}. ${clip(t.text, 60)}   ← lane ${t.lane}, not this window's`);
      for (const t of r.device) console.log(`  [☎] ${t.id}. ${clip(t.text, 60)}   ← needs the phone; ${r.busy}`);
      for (const t of r.blocked) console.log(`  [⛔] ${t.id}. ${t.text}   ← after ${t._b.open.join(', ')}`);
      for (const t of r.waiting) console.log(`  [~] ${t.id}. ${t.text}${t.until ? `   ← until ${t.until}` : ''}`);
      for (const t of r.human) console.log(`  [@] ${t.id}. ${t.text}`);
      if (r.cycles.length) console.log(`\n☠️ circular after:  ${r.cycles.join('\n                    ')}`);
      for (const { t, own } of r.refused) console.log(`  [↻] ${t.id}. ${clip(t.text, 55)}` +
        `   ← first refusal: ${own.session} finished what it continues`);
      for (const { t, cl } of r.held) console.log(`  [»] ${t.id}. ${clip(t.text, 60)}` +
        `   ← claimed by ${cl.session}, ${((Date.now() - cl.at) / 6e4).toFixed(0)} min ago`);
      if (r.expired.length) console.log(`\n☠️ expired until:   ` +
        r.expired.map((t) => `${t.id}. (${t.until})`).join(', '));
    }
    if (unknown.length) {
      console.log(`\n☠️ prerequisites not in the queue (treated as met — check for a typo): ${unknown.join(', ')}`);
    }
    process.exit(0);
  }

  // ☠️ A SESSION THAT JUST STARTED IS ALSO A STOPPED AGENT THAT DOES NOT KNOW THE
  // NEXT TASK. This is the one place the predecessor's loss actually bites: it
  // carried the plan across a compaction in its own state, and dropping that state
  // would drop the continuity with it. It does not, because the queue is now a
  // file in the repository - but nothing would TELL a fresh session to read it, so
  // one line does. It never blocks and it never lists: the next task, or idle.
  if (ev.hook_event_name === 'SessionStart') {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext:
          `The work queue is the FP3-QUEUE section of ${TODO} — that file is the only ` +
          `list; this hook keeps none.\n` +
          // ☠️ THE THREE METHOD LINES A START-UP PROMPT USED TO CARRY, delivered by
          // the hook instead, so no prompt has to be kept current: this window's
          // lane, how to change it, and where to read more.
          `This window's lane: ${lane || `none (may be handed any task; set FP3_LANE=phone|upstreaming ` +
            `in the environment, or run \`node "${__filename}" lane phone|upstreaming\`)`}. ` +
          `Phone: ${r.busy || 'free'}. ` +
          `Commands: \`node "${__filename}" check | next | claims\`; every write to the queue ` +
          `goes through add/set/mark/done/release (several windows share it). ` +
          `Method: Claude-skills-Fairphone3/README.md "Session start".\n` +
          (r.ready.length
            ? `Next task:\n${describe(r.ready[0])}`
            : idleText(r, tasks)),
      },
    }));
    process.exit(0);
  }

  if (ev.hook_event_name !== 'Stop') process.exit(0);

  // ☠️ THE NUDGE STATE IS PER WINDOW. It used to be one flat object in one file,
  // so window B's `said` suppressed window A's idle notice and their nudge counts
  // interleaved - two sessions sharing an anti-spin budget means neither gets the
  // three tries it was designed to have.
  const all = readState();
  const st = all[me] || (all[me] = {});
  const sig = JSON.stringify(tasks.map((t) => `${t.mark}${t.id}${t.text}`));
  if (st.sig !== sig) { st.sig = sig; st.nudges = 0; }

  if (!r.ready.length) {
    // ☠️ NOT A BLOCK. The whole complaint that produced this file was a hook that
    // held the session at a standstill with nothing to do. Idle is reported once
    // per distinct queue and then it is quiet.
    if (st.said === sig) { writeState(all); process.exit(0); }
    st.said = sig; writeState(all);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'Stop', additionalContext: idleText(r, tasks) },
    }));
    process.exit(0);
  }

  st.nudges = (st.nudges || 0) + 1;
  if (st.nudges > MAX_NUDGE) {
    writeState(all);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'Stop',
        additionalContext:
          `${r.ready.length} task(s) are ready and the queue has not changed in ${MAX_NUDGE} ` +
          `turns, so this is the last time it is said. If the top one cannot be done, it is ` +
          `not ready: change its marker to [~] with an \`until:\`, or to [@] with a \`when:\` ` +
          `and \`they-do:\`, in ${TODO}.\n${describe(r.ready[0])}`,
      },
    }));
    process.exit(0);
  }
  // ☠️ CLAIM IT UNDER THE LOCK, AND RE-READ INSIDE THE LOCK. Two windows can pass
  // the `ready` test at the same instant; only the one that writes first may keep
  // the task. The loser falls through to the next ready task on its next Stop.
  const got = withLock(() => {
    const c = liveClaims();
    const key = String(r.ready[0].id);
    if (c[key] && c[key].session !== me) return false;
    c[key] = { session: me, at: Date.now(), text: clip(r.ready[0].text, 60) };
    if (r.ready[0].lane === 'phone') {
      // re-read inside the lock: the phone may have been taken since report()
      const d = readClaims().__device;
      if (d && d.session !== me && d.at > Date.now() - CLAIM_TTL_MIN * 60000) return false;
      c.__device = { session: me, at: Date.now(), task: r.ready[0].id };
    }
    writeClaims(c);
    return true;
  });
  if (!got) { writeState(all); process.exit(0); }   // somebody else took it; try again next turn
  writeState(all);
  // ☠️ ASK ABOUT THE LAST ONE BEFORE LOGGING THIS ONE, or the question is about
  // the firing that is happening right now, which nobody can answer yet.
  const ask = gl('askLine', 'queue');
  gl('log', 'queue', `task ${r.ready[0].id}`);
  process.stdout.write(JSON.stringify({
    decision: 'block',
    systemMessage: `[sor] következő feladat: ${r.ready[0].id != null ? `${r.ready[0].id}. ` : ''}` +
      `${r.ready[0].text.slice(0, 60)}`,
    reason: ask +
      `The next task in the queue (${TODO}):\n\n${describe(r.ready[0])}\n\n` +
      // ☠️ SAY THE WHOLE CLOSING PROCEDURE HERE, AND NAME THE COMMAND. Nothing in
      // this system closes a task: the agent does, and it only does what it was
      // told at the moment it mattered. This text used to say "mark it `[x]`
      // there" - which is now exactly the wrong thing, because `[x]` left sitting
      // in the queue is a task nobody archived - and it named no command at all.
      // Moving the manual step from "edit the file" to "run a command nobody
      // mentions" is not an improvement.
      `Do this one. Then close it in one command — it archives the task to ` +
      `TODO-DONE.md, releases your claim, and is what satisfies anything with ` +
      `\`after: ${r.ready[0].id}\`:\n` +
      `  node "${__filename}" done ${r.ready[0].id}\n\n` +
      // ☠️ AND THE OUTPUT IS PART OF CLOSING, NOT A SEPARATE CHORE. `done` moves
      // the task; it cannot know what the work MEANT. That judgement is the
      // agent's, and it has to arrive with the task rather than later from a
      // different gate, or it arrives after the context that could make it.
      (r.ready[0].lane === 'upstreaming'
        ? `☠️ Closing is not only the marker. What this task produced goes, by hand, ` +
          `to docs/upstreaming/STATUS.md — the series' Rounds row (lore link), Test ` +
          `block, To do/Done, or the D- entry — and is committed. Method: the ` +
          `msm8953-mainline-pr skill, "Tracking the submissions". Never touch the phone ` +
          `from this lane.\n\n`
        : `☠️ Closing is not only the marker. Whatever this task measured goes, by ` +
          `hand, to:\n` +
          `  raw data → docs/power/bringup/captures/<date>_<name>/ with its own README.md\n` +
          `  the dated finding → docs/power/bringup/findings-log.md\n` +
          `  docs/power/README.md — ONLY if it changes what the phone does today\n` +
          `  never delete a disproven claim; write down why it fell\n` +
          (r.ready[0].lane === 'phone'
            ? `  (this task holds the phone lease; \`done\`/\`release\` gives it back)\n\n`
            : '\n')) +
      `If it turns out not to be startable, say so by changing its marker rather ` +
      `than by writing a note:\n` +
      `  node "${__filename}" mark ${r.ready[0].id} '~'   +  set ${r.ready[0].id} until <when>` +
      `   (waiting on something outside this session)\n` +
      `  node "${__filename}" mark ${r.ready[0].id} '@'   +  set … when/they-do` +
      `   (needs a person)\n` +
      `  node "${__filename}" release ${r.ready[0].id}` +
      `   (hand it back untouched, for another window)\n` +
      (r.ready.length > 1 ? `(${r.ready.length - 1} more ready behind it.)\n` : ''),
  }));
  process.exit(0);
}

main();
