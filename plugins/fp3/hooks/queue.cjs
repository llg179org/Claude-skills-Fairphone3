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
const BEGIN = '<!-- FP3-QUEUE:BEGIN -->';
const END = '<!-- FP3-QUEUE:END -->';
const STATE = path.join(
  process.env.CLAUDE_STATE_DIR ||
    path.join(process.env.HOME || '/home/fp3', '.claude', '.state'),
  'fp3-queue.json');

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

// --- parsing ---------------------------------------------------------------
//
// A task is a checkbox line; everything indented under it belongs to it. The
// markers, and what each one means to this hook:
//
//   [ ]  ready — may be handed out
//   [~]  waiting on something outside the session (a measurement, a timer)
//   [@]  needs a person; never handed to the agent
//   [x]  done — kept only until somebody moves it to TODO-DONE.md
//
// ☠️ THE KEYS ARE FEW ON PURPOSE. Every key here replaces prose that used to say
// the same thing worse: `after:` replaces "PARKOL, a 116. mögé", `until:`
// replaces "a telefon foglalt 16:02-ig". A note that states a schedule in words
// goes stale silently and nothing re-reads it; a key is checked on every parse.
const KEYS = ['after', 'until', 'when', 'they-do', 'why'];

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

function report(tasks) {
  const byId = new Map(tasks.filter((t) => t.id != null).map((t) => [t.id, t]));
  const ready = [], blocked = [], waiting = [], human = [];
  for (const t of tasks) {
    if (t.mark === 'x') continue;
    if (t.mark === '@') { human.push(t); continue; }
    const b = blockedBy(t, byId);
    t._b = b;
    if (b.open.length) blocked.push(t);
    else if (t.mark === '~') waiting.push(t);
    else ready.push(t);
  }
  return { ready, blocked, waiting, human, byId };
}

function idleText(r, tasks) {
  const n = nextUp(tasks);
  const lines = [];
  lines.push(r.waiting.length || r.blocked.length || r.human.length
    ? `IDLE — nothing can be started here: ${r.waiting.length} waiting on something outside ` +
      `this session, ${r.blocked.length} blocked behind another task, ${r.human.length} with a person.`
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
  const r = report(tasks);

  if (cli === 'show' || cli === 'next' || cli === 'check') {
    const unknown = tasks.flatMap((t) => (t._b ? t._b.unknown : []).map((u) => `${t.id} → ${u}`));
    if (cli === 'next') {
      console.log(r.ready.length ? describe(r.ready[0]) : idleText(r, tasks));
    } else {
      console.log(`${r.ready.length} ready · ${r.blocked.length} blocked · ` +
        `${r.waiting.length} waiting · ${r.human.length} with a person`);
      for (const t of r.ready) console.log(`  [ ] ${t.id}. ${t.text}`);
      for (const t of r.blocked) console.log(`  [⛔] ${t.id}. ${t.text}   ← after ${t._b.open.join(', ')}`);
      for (const t of r.waiting) console.log(`  [~] ${t.id}. ${t.text}${t.until ? `   ← until ${t.until}` : ''}`);
      for (const t of r.human) console.log(`  [@] ${t.id}. ${t.text}`);
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
          (r.ready.length
            ? `Next task:\n${describe(r.ready[0])}`
            : idleText(r, tasks)),
      },
    }));
    process.exit(0);
  }

  if (ev.hook_event_name !== 'Stop') process.exit(0);

  const st = readState();
  // The signature is the queue itself: a queue that has not changed cannot have
  // produced new work, so nudging again about it is noise.
  const sig = JSON.stringify(tasks.map((t) => `${t.mark}${t.id}${t.text}`));
  if (st.sig !== sig) { st.sig = sig; st.nudges = 0; }

  if (!r.ready.length) {
    // ☠️ NOT A BLOCK. The whole complaint that produced this file was a hook that
    // held the session at a standstill with nothing to do. Idle is reported once
    // per distinct queue and then it is quiet.
    if (st.said === sig) { writeState(st); process.exit(0); }
    st.said = sig; writeState(st);
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'Stop', additionalContext: idleText(r, tasks) },
    }));
    process.exit(0);
  }

  st.nudges = (st.nudges || 0) + 1;
  if (st.nudges > MAX_NUDGE) {
    writeState(st);
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
  writeState(st);
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
      `Do this one. When it is finished mark it \`[x]\` there — or move it to ` +
      `TODO-DONE.md, which is what satisfies anything with \`after: ${r.ready[0].id}\`.\n` +
      `If it turns out not to be startable, say so by changing its marker rather ` +
      `than by writing a note: \`[~]\` with an \`until:\` for something outside the ` +
      `session, \`[@]\` with \`when:\` and \`they-do:\` for a person.\n` +
      (r.ready.length > 1 ? `(${r.ready.length - 1} more ready behind it.)\n` : ''),
  }));
  process.exit(0);
}

main();
