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
//   node autonomy.cjs add "<step>" [...] [--after 12,15]
//                                             append steps, optionally with the
//                                             steps that must finish first
//   node autonomy.cjs after <id> <id,id,...>  this step needs those finished first
//   node autonomy.cjs unafter <id> <id,...>   drop a prerequisite
//   node autonomy.cjs note <id> "<text>"      record progress without finishing
//   node autonomy.cjs wait <id> "<what>" [--until 19:00|90m|2d]
//                                             blocked on something OUTSIDE this
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
  let s;
  try { s = Object.assign(empty(), JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch { return empty(); }
  // Every read wakes the waits whose deadline has passed, so no path can see a
  // plan that still calls an expired reason current - not the Stop gate, not
  // `show`, not the resume block written into STATUS.md.
  sweepWaits(s);
  return s;
}
// ☠️ ATOMIC, BECAUSE A TORN STATE FILE LOSES THE RUN. write-then-rename means a
// reader never sees a half-written plan, however the process dies mid-write.
function write(s) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = `${FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
    fs.renameSync(tmp, FILE);
  } catch { /* bookkeeping must never break the session */ }
}

// ☠️ THE LIVENESS TEST DOES NOT SERIALISE. Two hooks can read the file at the
// same moment, both find the owner dead, and both take over "loudly" - after
// which the second write silently discards the first. The lock is what makes
// read-decide-write one step. It is deliberately forgiving: if it cannot be
// taken, the work proceeds unserialised rather than failing, because
// bookkeeping must never break the session - but a stale lock is cleared, so a
// process killed mid-update cannot wedge the next one.
const LOCK = `${FILE}.lock`;
function withLock(fn) {
  let fd = null;
  for (let i = 0; i < 60; i++) {
    try { fd = fs.openSync(LOCK, 'wx'); break; }
    catch {
      try {
        const age = Date.now() - fs.statSync(LOCK).mtimeMs;
        if (age > 30000) fs.unlinkSync(LOCK);
      } catch { /* it went away on its own */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try { return fn(); }
  finally {
    if (fd !== null) { try { fs.closeSync(fd); fs.unlinkSync(LOCK); } catch { /* ignore */ } }
  }
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
// ☠️ A PID ALONE IS NOT AN IDENTITY. pid_max on this machine is 4194304, so
// wrap-around is slow - but when it happens the failure is the ugly direction:
// the lock believes a recycled pid is the old owner FOREVER, and the
// dead-owner takeover never fires. Worse, if the recycled pid belongs to another
// user, the EPERM branch confirms it as "alive under another user". The identity
// is therefore (pid, start time, boot id): the start time comes from field 22 of
// /proc/PID/stat and cannot be forged by reuse, and the boot id stops a match
// surviving a reboot.
function starttime(pid) {
  try {
    const st = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    // the comm field can contain spaces and parentheses; fields are counted
    // after the last ')' precisely because of that.
    return Number(st.slice(st.lastIndexOf(')') + 2).split(' ')[19]) || 0;
  } catch { return 0; }
}
function bootId() {
  try { return fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); }
  catch { return ''; }
}
function me() {
  const pid = Number(process.env.CLAUDE_PID) || 0;
  return {
    sid: process.env.CLAUDE_CODE_SESSION_ID || process.env.CLAUDE_SESSION_ID || '',
    pid,
    start: starttime(pid),
    boot: bootId(),
    host: os.hostname(),
  };
}
function alive(o) {
  if (!o || !o.pid) return false;
  if (o.host && o.host !== os.hostname()) {
    return o.seen && (Date.now() - o.seen) / 6e4 < OWNER_STALE_MIN;   // cannot test a remote pid
  }
  if (o.boot && o.boot !== bootId()) return false;   // different boot: the pid means nothing
  // ☠️ Measured in this setup before being relied on: kill(own pid, 0) succeeds
  // and kill(999999, 0) gives ESRCH, so no PID-namespace artefact is turning a
  // live process into a dead one here. A sandbox elsewhere could; re-measure
  // before trusting this on another machine.
  try { process.kill(o.pid, 0); }
  catch (e) { if (e.code !== 'EPERM') return false; }
  // The pid exists - but is it the SAME process? A recycled pid has a different
  // start time, and that is the whole point of recording it.
  if (o.start) {
    const now = starttime(o.pid);
    if (now && now !== o.start) return false;
  }
  return true;
}
// Returns '' when this session may proceed, or a sentence saying why not.
function ownershipBlock(s) {
  const m = me();
  const o = s.owner;
  if (!m.sid) return '';                       // no identity to enforce with
  if (!o || !o.sid) { s.owner = Object.assign({}, m, { at: Date.now(), seen: Date.now() }); return ''; }
  if (o.sid === m.sid) {
    // ☠️ THE SAME SESSION ID IS NOT THE SAME WINDOW. `claude --resume <sid>` in a
    // second terminal carries the same sid while the original is still running,
    // which is exactly the incident this lock exists for. So: same sid and the
    // old process gone = a genuine resume, inherit it; same sid and the old
    // process alive = two windows, refuse as loudly as for any stranger.
    if (!m.pid || o.pid === m.pid || !alive(o)) {
      Object.assign(o, { seen: Date.now(), pid: m.pid || o.pid, start: m.start || o.start,
                         boot: m.boot || o.boot });
      return '';
    }
    return `This run is already held by another window of the SAME session ` +
      `(pid ${o.pid}, still alive; you are pid ${m.pid}).\n` +
      `☠️ A second \`claude --resume\` does not inherit the run - it duplicates the hands on ` +
      `the phone.\nClose or finish that window, or take it over deliberately: ` +
      `node "${__filename}" claim --force`;
  }
  if (alive(o)) {
    return `This autonomous run belongs to another session that is still running ` +
      `(pid ${o.pid} on ${o.host}, last seen ${((Date.now() - (o.seen || o.at)) / 6e4).toFixed(0)} min ago).\n` +
      `☠️ Two sessions editing one plan means two sets of hands on one phone - it has already ` +
      `happened here, mid-measurement.\n` +
      `Go back to it:  claude --resume ${o.sid}\n` +
      `If that session is genuinely finished with the run and you know it, take it over ` +
      `deliberately:  node "${__filename}" claim --force`;
  }
  // ☠️ THE TAKEOVER RE-READS UNDER THE LOCK. Deciding on a copy read before the
  // lock is check-then-act: two sessions could both find the owner dead and both
  // announce a takeover, and the later write would discard the earlier silently.
  const fresh = withLock(() => {
    const cur = read();
    if (cur.owner && cur.owner.sid && cur.owner.sid !== o.sid) return cur.owner;  // someone got there first
    cur.owner = Object.assign({}, m, { at: Date.now(), seen: Date.now(), tookOverFrom: o.sid });
    write(cur);
    return null;
  });
  if (fresh && fresh.sid !== m.sid) {
    return `Another session took this run over while you were deciding to ` +
      `(now ${fresh.sid}, pid ${fresh.pid}). Do not race it.`;
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
// (an "open" item is todo or doing; whether it is ACTIONABLE additionally depends
// on its prerequisites - see actionableItems() below)
// ☠️ WAITING NOW MEANS "WAITING ON SOMETHING OUTSIDE THE PLAN". Since blockedItems
// admits `waiting` too, an item waiting on item 116 belongs to exactly one of the
// two buckets - and when this filter still returned all of them, the Stop summary
// printed those seven items twice: once in its own list and again in the BLOCKED
// block underneath. Caught by reading the hook's own output one turn after
// installing it, which is the only reason it did not stand.
const waitingItems = (s) => s.items.filter((i) =>
  i.status === 'waiting' && !blockers(s, i).all.length);
// The hash is what the anti-spin budget watches, so EVERY kind of progress must
// be in it - including a recorded fact, which is the only progress there is on a
// turn whose whole job was to write down a result.
const hash = (s) => crypto.createHash('sha1')
  .update(JSON.stringify([
    // ☠️ `after` IS IN THE HASH. Adding a dependency is progress - it is often the
    // whole content of a turn that untangles a plan - and if the hash cannot see
    // it, the anti-spin budget is not given back and the next Stop nudges as if
    // nothing happened.
    s.items.map((i) => [i.id, i.status, i.text, i.note || '', i.ev || '', (i.after || []).join(',')]),
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
    // The durable record has to survive a compaction on its own, so the
    // dependency is written out here too - not only computed in the reminder.
    const dep = (i.after || []).length ? `  (after ${i.after.join(', ')})` : '';
    return `  ${mark} ${i.id}. ${i.text}${dep}${ev}${i.note ? `\n        · ${i.note}` : ''}`;
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

// ☠️ RANK WITHOUT DEPENDENCIES PUSHES WORK THAT CANNOT BE STARTED. NEXT was
// "most stars, ties by id", and nothing in the plan could say that item 9 needs
// item 12 finished first. So a 3★ step that is not yet startable outranks the 1★
// step it is waiting on, the hook nudges for it every turn, and the reply is
// either a note that changes nothing or the 1★ done out of order and unrecorded.
//
// ☠️ AND INHERITANCE IS NOT A TEXT REWRITE. The stars are the author's INTENT -
// how much this step matters - and they stay exactly as written. The ranking is a
// property of the GRAPH: a step that unblocks something urgent is urgent to do,
// whether or not anybody thought to star it that way. Editing the text to say 3★
// would destroy the intent and make the two indistinguishable; computing it keeps
// both, and the render shows WHICH item lent the priority so the order can be
// argued with.
const after = (i) => (Array.isArray(i.after) ? i.after : []);
const byId = (s) => new Map(s.items.map((i) => [i.id, i]));
// Unmet prerequisites, split by kind: a `dropped` prerequisite is NOT met - the
// step it stood for never happened - but it will never become met either, so it
// is reported as a decision to make rather than as a wait.
function blockers(s, i) {
  const m = byId(s);
  const open = [], gone = [];
  for (const id of after(i)) {
    const p = m.get(id);
    if (!p) { gone.push(id); continue; }          // deleted prerequisite: same decision
    if (p.status === 'done') continue;
    (p.status === 'dropped' ? gone : open).push(id);
  }
  return { open, gone, all: open.concat(gone) };
}
function parseIds(t) {
  return String(t || '').split(/[\s,]+/).filter(Boolean).map(Number)
    .filter((n) => Number.isFinite(n));
}
// Would `id` depend (transitively) on itself once `pre` are its prerequisites?
// Returns the path for the error message - "which cycle" is the only useful part.
function findCycle(s, id, pre) {
  const m = byId(s);
  const seen = new Set();
  const walk = (cur, path) => {
    if (cur === id && path.length) return path.concat([id]);
    if (seen.has(cur)) return null;
    seen.add(cur);
    const it = m.get(cur);
    for (const a of (cur === id ? pre : after(it || {}))) {
      const r = walk(a, path.concat([cur]));
      if (r) return r;
    }
    return null;
  };
  return walk(id, []);
}
const isActionable = (s, i) => (i.status === 'todo' || i.status === 'doing') && !blockers(s, i).all.length;
const actionableItems = (s) => s.items.filter((i) => isActionable(s, i));
// ☠️ THIS USED TO IGNORE `waiting`, AND THAT WAS THE WHOLE WALL OF TEXT.
// Measured 2026-09-03: 9 of 18 waiting items already carried an `after` edge
// (19, 30, 31, 41, 54, 55, 64, 85, 118) - the dependency graph was there and the
// renderer threw it away, because this filter only admitted todo/doing. So every
// one of them fell into the verbose WAITING section and printed two lines of
// prose instead of collapsing to "waiting on: 116". The diagnosis that blamed
// the data model ("parked in prose instead of `after`") was wrong: only 2 of 18
// genuinely lack an edge. One status check, not a redesign.
const blockedItems = (s) => s.items.filter((i) =>
  (i.status === 'todo' || i.status === 'doing' || i.status === 'waiting') && blockers(s, i).all.length);

// Effective priority = max(own stars, every dependent's effective priority),
// transitively. Cycles are refused at write time; the `seen` set keeps a state
// file hand-edited into a cycle from hanging the hook instead of reporting it.
function effPrioMap(s) {
  const deps = new Map();                          // id -> items that require it
  for (const i of s.items) for (const a of after(i)) {
    if (!deps.has(a)) deps.set(a, []);
    deps.get(a).push(i);
  }
  const memo = new Map();
  const walk = (i, seen) => {
    if (memo.has(i.id)) return memo.get(i.id).p;
    if (seen.has(i.id)) return prio(i);            // cycle: stop at own stars
    seen.add(i.id);
    let best = prio(i), from = null;
    for (const d of deps.get(i.id) || []) {
      const v = walk(d, seen);
      if (v > best) { best = v; from = d.id; }     // credit the item that lent it
    }
    seen.delete(i.id);
    memo.set(i.id, { p: best, from });
    return best;
  };
  for (const i of s.items) walk(i, new Set());
  return memo;
}
function byEff(s) {
  const m = effPrioMap(s);
  const e = (i) => (m.get(i.id) ? m.get(i.id).p : prio(i));
  return (a, b) => e(b) - e(a) || prio(b) - prio(a) || a.id - b.id;
}
// "1★ (↑3 via #7)" - shown only when the rank is not the item's own stars, so the
// reader can see why it moved up and dispute it.
function effTag(s, i, m) {
  m = m || effPrioMap(s);
  const r = m.get(i.id);
  if (!r || r.p <= prio(i) || r.from == null) return '';
  return `  ${prio(i)}★ (↑${r.p} via #${r.from})`;
}
function clip(t, n) {
  t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
// ☠️ NEXT COMES FROM THE ACTIONABLE SET, NOT THE OPEN SET. An item whose
// prerequisites are unfinished is open, and pointing at it is pointing at work
// that cannot be started.
function nextItem(s, open) {
  const pool = (open || s.items).filter((i) => isActionable(s, i));
  return [...pool].sort(byEff(s))[0];
}

// ☠️ EVERY GATE HERE POINTS AT AN INCIDENT; NONE OF THEM CAN SAY WHETHER IT HAS
// CAUGHT ANYTHING SINCE. A gate that fires often and rightly earns its cost; one
// that has not fired in weeks is either a perfect deterrent or dead weight, and
// only a log tells those apart. The same doctrine this project applies to its
// instruments - a verifier not yet shown failing has proved nothing - applies to
// its rules. `gates` prints the tally, so REMOVING a gate stays as cheap an
// operation as adding one.
function logGate(s, name) {
  s.gateLog = (s.gateLog || []).concat([{ t: Date.now(), g: name }]).slice(-500);
  s.gateFirst = s.gateFirst || {};
  if (!s.gateFirst[name]) s.gateFirst[name] = Date.now();
}
function renderGates(s) {
  const log = s.gateLog || [];
  const first = s.gateFirst || {};
  const names = [...new Set(Object.keys(first).concat(log.map((e) => e.g)))].sort();
  if (!names.length) return 'No gate has fired yet in this run.';
  const out = ['GATE LOG — a gate that never fires is either a perfect deterrent or dead weight:'];
  for (const n of names) {
    const hits = log.filter((e) => e.g === n);
    const days = ((Date.now() - (first[n] || Date.now())) / 864e5).toFixed(1);
    const last = hits.length ? `${((Date.now() - hits[hits.length - 1].t) / 36e5).toFixed(1)} h ago` : 'never';
    const flag = hits.length === 0 ? '   ← never caught anything: keep it or drop it, deliberately' : '';
    out.push(`  ${n.padEnd(22)} ${String(hits.length).padStart(4)} fires   last ${last.padEnd(12)} armed ${days} d${flag}`);
  }
  out.push('☠️ Overrides are gates failing loudly rather than silently: count `claim --force` and');
  out.push('   `consulted none` here too. A gate overridden more often than obeyed is mistuned.');
  return out.join('\n');
}

// Parse only what can be parsed without guessing. "08:35" and "2026-09-02 08:35"
// become a timestamp; anything else ("this evening") is kept as prose and rendered
// as prose - an unparsed time is still an agreed time, it just cannot be counted down.
function parseWhen(w) {
  const hm = /^(\d{1,2}):(\d{2})$/.exec(w.trim());
  if (hm) {
    const d = new Date();
    d.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
    // An agreed time that already passed today means today, not tomorrow: the
    // point of the field is to show it as overdue, never to hide it a day out.
    return d.getTime();
  }
  const t = Date.parse(w);
  return Number.isFinite(t) ? t : 0;
}

// ☠️ THIS BLOCK IS RENDERED TWICE ON PURPOSE - once at the top for priority, and
// once as the LAST THING in the plan. The person reads the bottom of the console,
// and everything a turn does scrolls between the two. A standing instruction that
// is only at the top is an instruction they have to scroll back for, which in
// practice means one they ask about instead.
function parseUntil(spec) {
  const d = /^(\d+)\s*([mhd])$/.exec(String(spec).trim());
  if (d) return Date.now() + Number(d[1]) * { m: 6e4, h: 36e5, d: 864e5 }[d[2]];
  const hm = /^(\d{1,2}):(\d{2})$/.exec(String(spec).trim());
  if (hm) {
    const t = new Date();
    t.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
    // a clock time that already passed today means TOMORROW - unlike an agreed
    // human time, a wait deadline in the past would fire the instant it is set
    if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1);
    return t.getTime();
  }
  const p = Date.parse(spec);
  return Number.isFinite(p) ? p : 0;
}

// ☠️ THE PLAN WAKES ITSELF UP. Every read of the state sweeps the waiting items
// and returns the expired ones to `todo`, so the next Stop hands out real work
// instead of reporting an empty actionable list. The item keeps its note, with
// the expiry stamped on the front, so the reason it waited is still auditable -
// an item that silently returns is as bad as one that silently rots.
function sweepWaits(s) {
  let woke = 0;
  for (const i of s.items) {
    if (i.status !== 'waiting' || !i.waitUntil || i.waitUntil > Date.now()) continue;
    i.status = 'todo';
    i.note = `☠️ THE WAIT EXPIRED (${i.waitSpec}) — re-check the reason before acting: ${i.note || ''}`;
    delete i.waitUntil; delete i.waitSpec;
    woke += 1;
  }
  return woke;
}

function renderHuman(s, tail) {
  const hs = s.items.filter((i) => i.status === 'human');
  if (!hs.length) return [];
  const out = ['', tail
    ? '⏰ STILL WAITING ON A PERSON — this is what they are doing and what it is for:'
    : 'AGREED WITH A PERSON — a time somebody else is keeping; do not move it silently:'];
  for (const i of hs.sort((a, b) => (a.humanAt || 0) - (b.humanAt || 0))) {
    let when = i.humanWhen;
    if (i.humanAt) {
      const m = (i.humanAt - Date.now()) / 6e4;
      when += m >= 0 ? `  (in ${m < 1 ? '<1' : m.toFixed(0)} min)`
        : `  ⏳ ${(-m).toFixed(0)} min AGO — if it has not happened, ASK, do not reschedule`;
    }
    // ☠️ NOT clipped. Everything else in this renderer is trimmed to keep the
    // reminder short; this is the one item somebody else has to act on, and a
    // truncated instruction is worse than none - it looks complete.
    out.push(`  ⏰ ${i.id}. ${i.text}`);
    out.push(`        WHEN: ${when}`);
    if (i.humanSteps && i.humanSteps.length) {
      out.push('        THEY DO:');
      i.humanSteps.forEach((t, k) => out.push(`          ${k + 1}. ${t}`));
    } else {
      out.push('        THEY DO: ☠️ NOT WRITTEN DOWN — say it before they have to ask');
    }
    // ☠️ THE INSTRUCTION IS UNCLIPPED; ITS REASONING IS NOT. The rule above
    // protects what the person has to DO - text, WHEN, THEY DO. It was applied to
    // the whole item, so the working notes rode along at full length and buried
    // the instruction in the middle of themselves: on 2026-09-03 item 112's NOTE
    // was 588 characters of P-CSCF TLV analysis wedged between "what you do" and
    // "what it decides", and the user's report was that the human items were the
    // hard ones to find. Reasoning is looked up in the plan when wanted; it does
    // not belong in a standing instruction.
    if (i.humanMine) out.push(`        I DO MEANWHILE: ${clip(i.humanMine, 220)}`);
    if (i.humanNext) out.push(`        THEN: ${clip(i.humanNext, 220)}`);
    if (i.note) out.push(`        NOTE: ${clip(i.note, 180)}`);
  }
  return out;
}

// ☠️ THE REMINDER COULD NOT SAY WHETHER ANYTHING WAS HAPPENING. At 06:00 on
// 2026-09-03 the user read a plan whose every item was waiting and could not tell
// whether the run was working towards 19:00 or simply idle - "nem egyértelmű
// addig történik-e valami vagy csak üresen áll". Nothing in the renderer knew
// about time: it listed state, never a schedule. This line answers three
// questions before the list: is anything to be done NOW, what is the next thing
// that happens on its own, and how long until then.
//
// ☠️ AND AN EVENT NOBODY WROTE DOWN DOES NOT EXIST. The same morning, the run's
// whole point - a measurement "starting at 19:00" - had no timer, no at-job and
// no cron behind it anywhere, and neither the plan nor the hook noticed. Waits
// and agreed human times are inferred here; anything else has to be declared
// with `event`, which is the one piece of schedule this hook keeps.
// ☠️ A `waitUntil` IS NOT AN EVENT, AND SORTING THEM TOGETHER HID THE ONE THAT
// WAS. First version returned the earliest of everything, so NEXT read "10:24 —
// item 75 comes back" while the thing the whole day was pointed at, a 19:00
// measurement, sat behind it unmentioned. A `waitUntil` is a note to myself to
// look again; a declared event is something that happens whether or not anybody
// is watching, and a person who agreed a time is keeping it. Those two happen;
// the reminder does not. Rank by that, and say the lesser one as an aside.
function nextEvent(s) {
  const happens = [], reminders = [];
  const ev = s.event && s.event.at ? s.event : null;
  if (ev && ev.at > Date.now()) happens.push({ at: ev.at, what: ev.what || 'declared event' });
  for (const i of s.items) {
    if (i.status === 'human' && i.humanAt > Date.now()) {
      happens.push({ at: i.humanAt, what: `item ${i.id}, with a person` });
    }
    if (i.status === 'waiting' && i.waitUntil > Date.now()) {
      reminders.push({ at: i.waitUntil, what: `item ${i.id} comes back` });
    }
  }
  const by = (a, b) => a.at - b.at;
  return { ev: happens.sort(by)[0] || null, note: reminders.sort(by)[0] || null };
}
const untilStr = (ms) => {
  const m = ms / 6e4;
  return m < 1 ? '<1 min' : m < 90 ? `${m.toFixed(0)} min` : `${(m / 60).toFixed(1)} h`;
};
function clockLine(s, open, blocked) {
  const { ev: n, note } = nextEvent(s);
  const at = (t) => `${new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` +
    ` (in ${untilStr(t - Date.now())})`;
  const when = (n
    ? `${at(n.at)} — ${n.what}`
    : '☠️ NOTHING HAPPENS ON ITS OWN. If the run is waiting for a moment, no clock is ' +
      'keeping it: declare it (`event`) or arm it on the device.')
    + (note && (!n || note.at < n.at) ? `\n      (sooner, but only a reminder: ${at(note.at)} ${note.what})` : '');
  // ☠️ SAY "IDLE" IN THOSE WORDS when it is idle. A reader who has to infer it
  // from an empty ACTIONABLE section infers it wrong, which is the report this
  // line exists because of.
  const now = open.length
    ? `${open.length} to do right now`
    : blocked.length || s.items.some((i) => i.status === 'waiting' || i.status === 'human')
      ? 'IDLE — nothing to do in this session; everything open waits on something else'
      : 'IDLE — nothing open at all';
  return `NOW: ${now}\nNEXT: ${when}`;
}

function renderPlan(s) {
  if (!s.active) return 'No autonomous run is active.';
  const open = actionableItems(s);
  const blocked = blockedItems(s);
  // Only items waiting on something OUTSIDE the plan; anything waiting on another
  // item is rendered once, in BLOCKED, with the id it waits for.
  const waiting = s.items.filter((i) => i.status === 'waiting' && !blockers(s, i).all.length);
  const em = effPrioMap(s);
  const done = s.items.filter((i) => i.status === 'done').length;
  const dropped = s.items.filter((i) => i.status === 'dropped').length;
  const out = [
    `GOAL: ${s.goal}`,
    `${done} done · ${dropped} dropped · ${open.length} actionable · ` +
      `${blocked.length ? `${blocked.length} blocked · ` : ''}${waiting.length} waiting` +
      `${s.items.filter((i) => i.status === 'human').length ? ` · ${s.items.filter((i) => i.status === 'human').length} with a person` : ''}` +
      `   (every item, with notes: \`node "${__filename}" show\`)`,
    clockLine(s, open, blocked),
  ];
  out.push(...renderHuman(s, false));
  if (open.length) {
    out.push('', 'ACTIONABLE — highest priority first, act on the top one:');
    for (const i of [...open].sort(byEff(s))) {
      out.push(`  ${i.status === 'doing' ? '[~]' : '[ ]'} ${i.id}. ${i.text}` +
        effTag(s, i, em) + (i.ev ? `  ⟨${i.ev}⟩` : '') + (i.note ? `\n        · ${i.note}` : ''));
    }
  }
  if (blocked.length) {
    // One line each, like the waiting items: these cannot be worked on, so the
    // only thing worth reading is WHAT they are waiting for.
    out.push('', 'BLOCKED — prerequisites unfinished; finish those first:');
    for (const i of [...blocked].sort(byEff(s))) {
      const b = blockers(s, i);
      const gone = b.gone.length
        ? `  ☠️ prerequisite dropped or gone: ${b.gone.join(', ')} — decide: \`drop\` this too, or \`unafter\``
        : '';
      out.push(`  ⛔ ${i.id}. ${clip(i.text, 100)}${effTag(s, i, em)}\n` +
        `        waiting on: ${b.all.join(', ')}${gone}`);
    }
  }
  if (waiting.length) {
    out.push('', 'WAITING — nothing to do on these; do not disturb what they measure:');
    // ☠️ THE STALENESS FLAG MUST NOT BECOME THE NOISE IT REPLACED. With 25
    // waiting items, flagging every old one rebuilds the wall of text this
    // renderer exists to cut. Only the two oldest carry the question.
    // ☠️ AND ROTATE THE QUESTION. Flagging the two oldest by waitAt means the same
    // two items are asked about forever while the rest are never asked at all -
    // which is how twelve items kept a reason that had expired at 08:15. Ask the
    // two whose reason has gone longest WITHOUT being questioned.
    const flagged = new Set([...waiting].filter((i) => i.waitAt && !i.waitUntil)
      .sort((a, b) => (a.waitAsked || a.waitAt) - (b.waitAsked || b.waitAt))
      .slice(0, 2).map((i) => i.id));
    for (const i of waiting) if (flagged.has(i.id)) i.waitAsked = Date.now();
    for (const i of [...waiting].sort(byPrio)) {
      // ☠️ A WAIT REASON GOES STALE SILENTLY. One item in this run waited all
      // day on "the 16:06 timer", which had fired that afternoon; another on
      // "the phone is busy until 16:02". Nothing re-reads a reason nobody is
      // shown, so an old one is surfaced with its age and a question.
      const h = i.waitAt ? (Date.now() - i.waitAt) / 36e5 : null;
      // ☠️ SHOW THE DATE WHEN IT IS NOT TODAY. Rendering a two-day deadline as a
      // bare clock time made "--until 2d" print "back at 10:24 AM" - i.e. a wait
      // set for Thursday looked like one expiring in minutes. A deadline that
      // reads as the wrong day is worse than none, because it is believed.
      const age = i.waitUntil
        ? `  ⏰ back at ${new Date(i.waitUntil).toLocaleString([],
            new Date(i.waitUntil).toDateString() === new Date().toDateString()
              ? { hour: '2-digit', minute: '2-digit' }
              : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
        : (h != null && h >= 2 && flagged.has(i.id)
          ? `  ⏳ ${h.toFixed(0)} h, and NO --until — is this reason still true?` : '');
      out.push(`  … ${i.id}. ${clip(i.text, 100)}${age}\n        ⟵ ${clip(i.note, 100) || 'reason unstated'}`);
    }
  }
  // ☠️ RENDERED ONCE. This used to print at the top AND the bottom, unclipped:
  // the one thing another person has to act on was also the longest thing in
  // the reminder, and it was there twice. It stays at the top, where it is read.
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
  // ☠️☠️ MEASURED 2026-09-03: THE FACT LIST WAS 71 % OF THE PER-TURN REMINDER
  // (measured 51 %, retracted 20 %), against 24 % for everything to do with the
  // work. The user's report was "too much is on it" and the diagnosis blamed the
  // waiting items - which are 9 %. Nobody had measured the split, including me.
  //
  // ☠️ THE TWO HALVES ARE NOT THE SAME KIND OF THING, and that is why only one is
  // cut. RETRACTED is a per-turn guard: its whole job is to stop the next turn
  // rebuilding on a dead claim, and a retraction that is not in front of the
  // reader does not do it - this run has rebuilt on a retracted claim before.
  // MEASURED is a RECORD: it survives compaction, and it is already carried in
  // full by SessionStart, by PreCompact and by STATUS.md. Re-emitting all of it
  // on every single turn buys nothing the record does not already buy.
  const RECENT = 8;
  if (m.length) {
    const show = compact ? m.slice(-RECENT) : m;
    out.push(compact && m.length > show.length
      ? `MEASURED and standing — ${m.length} results; the ${show.length} most recent ` +
        `(all of them: SessionStart, STATUS.md, or \`show\`):`
      : 'MEASURED and standing:');
    for (const f of show) {
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
  const READONLY = new Set(['show', 'flush', 'status', 'claim', 'gates']);
  if (cmd === 'gates') { console.log(renderGates(s)); process.exit(0); }
  if (cmd === 'claim') {
    const m = me();
    if (rest[0] !== '--force' && ownershipBlock(s)) fail(ownershipBlock(s));
    s.owner = Object.assign({}, m, { at: Date.now(), seen: Date.now(),
      forced: rest[0] === '--force' ? (s.owner || {}).sid || 'nobody' : undefined });
    write(s);
    if (rest[0] === '--force') { logGate(s, 'OVERRIDE:claim-force'); write(s); }
    console.log(`run claimed by session ${m.sid} (pid ${m.pid} on ${m.host})` +
      (rest[0] === '--force' ? ' — FORCED; the previous owner will be told it lost the run' : ''));
    process.exit(0);
  }
  if (!READONLY.has(cmd)) {
    const blocked = ownershipBlock(s);
    if (blocked) { logGate(s, 'foreign-session'); write(s); fail(`REFUSED: ${blocked}`); }
  }

  switch (cmd) {
    case 'start':
      Object.assign(s, empty(), { active: true, goal: arg || s.goal });
      break;
    // ☠️ A GOAL THAT CANNOT BE EDITED IS A GOAL THAT GOES STALE, AND THE ONLY WAY
    // TO CHANGE IT WAS `start`, WHICH DELETES EVERY ITEM. So when the objective
    // moved - 2026-09-02: "shortest possible testing time" became a cost, where
    // night-long legs had been priced at zero - the header kept announcing the old
    // one above a list built for it, and the list is read against that header every
    // single turn. Editing the goal has to be cheaper than restarting the run, or
    // the run silently optimises for a target nobody holds any more.
    case 'goal': {
      if (!arg) fail('usage: goal "<the objective function, in the words it was given>"\n' +
        'This does NOT touch the items. Re-rank them yourself afterwards: a new goal that ' +
        'leaves the old ordering in place has changed a caption, not a plan.');
      const was = s.goal;
      s.goal = arg;
      s.goalHistory = (s.goalHistory || []).concat({ t: Date.now(), from: was, to: arg });
      console.error('goal changed. ☠️ The items were NOT re-ranked - that is deliberate, ' +
        'because only you know which of them the new goal makes pointless. Walk the list ' +
        'now and drop what no longer produces a decision; a goal change that adds no `drop` ' +
        'is usually a goal change that has not been believed.');
      break;
    }
    case 'add': {
      const ai = rest.indexOf('--after');
      const pre = ai < 0 ? [] : parseIds(rest[ai + 1]);
      const texts = (ai < 0 ? rest : rest.slice(0, ai)).filter(Boolean);
      for (const id of pre) if (!s.items.some((i) => i.id === id)) fail(`no item ${id} to depend on`);
      // ☠️ SAY WHICH ID YOU JUST CREATED. Adding several items in a loop and then
      // closing them by guessed number went wrong twice in one session: the ids
      // had shifted, so `done` landed on a neighbouring item and marked work
      // finished that had never been started - while the item actually finished
      // stayed open. A silent allocator invites exactly that.
      for (const t of texts.length > 1 ? texts : [texts[0] || arg]) {
        if (!t) continue;
        const id = s.nextId++;
        s.items.push({ id, text: t, status: 'todo', ...(pre.length ? { after: pre } : {}) });
        console.error(`added #${id}: ${clip(t, 70)}`);
      }
      s.active = true;
      break;
    }
    case 'after': case 'unafter': {
      const id = Number(rest[0]);
      const it = s.items.find((i) => i.id === id);
      if (!it) fail(`no item ${rest[0]}\nusage: ${cmd} <id> <id,id,...>`);
      const ids = parseIds(rest.slice(1).join(','));
      if (!ids.length) fail(`usage: ${cmd} <id> <id,id,...>`);
      if (cmd === 'unafter') {
        it.after = after(it).filter((a) => !ids.includes(a));
        if (!it.after.length) delete it.after;
        break;
      }
      for (const a of ids) {
        if (a === id) fail(`REFUSED: item ${id} cannot depend on itself.`);
        if (!s.items.some((i) => i.id === a)) fail(`REFUSED: no item ${a} to depend on.`);
      }
      const merged = [...new Set(after(it).concat(ids))];
      const cyc = findCycle(s, id, merged);
      if (cyc) fail(`REFUSED: that would make a cycle: ${cyc.join(' → ')}.\n` +
        '☠️ A cycle is not a scheduling detail - every item on it becomes permanently ' +
        'un-startable, and the plan looks full while nothing can move. Decide which ' +
        'direction is real and `unafter` the other.');
      it.after = merged;
      break;
    }
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
      if (agent === 'none') logGate(s, 'OVERRIDE:consulted-none');
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
    // ☠️ A HUMAN TASK IS NOT A `waiting` ITEM. `waiting` is passive - something
    // measures, and nobody owes anybody anything. A task handed to a person who
    // agreed to a TIME is the opposite: an obligation in both directions, and the
    // side that can quietly break it is this one. The failure mode is not
    // forgetting, it is DRIFT - "call at 08:35" becomes "call in a few minutes"
    // becomes an apology, and each slip is individually reasonable while the
    // collaboration degrades. So the time is stored, it is rendered ABOVE the
    // actionable list, and moving it costs an explicit --reschedule that is logged
    // as an override, exactly like `claim --force`.
    case 'human': {
      const id = Number(rest[0]);
      const it = s.items.find((i) => i.id === id);
      if (!it) fail(`no item ${rest[0]}`);
      const args = rest.slice(1);
      const force = args.includes('--reschedule');
      // ☠️ THE INSTRUCTION HAS TO LIVE IN THE STATE, NOT IN A SENTENCE I TYPED
      // ONCE. Measured the hard way: the person was told what to do in prose, the
      // console then scrolled on with unrelated work, and by the time the agreed
      // moment came they had to ask "what was the call supposed to be - is ringing
      // enough, do I answer?". A one-line note cannot answer that. So the steps
      // they perform, what I am doing meanwhile, and what happens after are FIELDS,
      // re-rendered in full every turn.
      const steps = [];
      let mine = '', next = '';
      for (let k = 0; k < args.length; k++) {
        if (args[k] === '--step') steps.push(args[++k] || '');
        else if (args[k] === '--mine') mine = args[++k] || '';
        else if (args[k] === '--next') next = args[++k] || '';
      }
      const drop = new Set();
      for (let k = 0; k < args.length; k++) {
        if (['--step', '--mine', '--next'].includes(args[k])) { drop.add(k); drop.add(k + 1); }
        else if (args[k] === '--reschedule') drop.add(k);
      }
      const body = args.filter((_, k) => !drop.has(k));
      const sep = body.indexOf('--');
      const when = (sep < 0 ? body : body.slice(0, sep)).join(' ').trim();
      const text = sep < 0 ? '' : body.slice(sep + 1).join(' ').trim();
      if (!when) fail('usage: human <id> <when> [--reschedule] -- "<what the person agreed to do>"\n' +
        '`when` is the agreed time, written the way it was agreed: "08:35", "this evening", "after the call".');
      const at = parseWhen(when);
      if (it.humanAt && it.humanWhen !== when && !force) fail(
        `REFUSED: item ${id} already has an agreed time with a person: "${it.humanWhen}".\n` +
        '☠️ Moving it is not bookkeeping - somebody arranged their morning around it. If the time really ' +
        'has to move, say so TO THEM first, then record it with --reschedule.\n' +
        'A time pushed twice is a promise the other side stops believing.');
      if (it.humanAt && force) logGate(s, 'OVERRIDE:human-reschedule');
      it.status = 'human';
      if (steps.length) it.humanSteps = steps;
      if (mine) it.humanMine = mine;
      if (next) it.humanNext = next;
      if (!it.humanSteps || !it.humanSteps.length) console.error(
        '☠️ no --step given: this item now shows a time and no instructions. The person will have to ' +
        'ask what to do at the moment they were supposed to be doing it.\n' +
        '   human <id> <when> --step "..." --step "..." --mine "<what I do meanwhile>" --next "<what follows>"');
      it.humanWhen = when;
      it.humanAt = at;
      it.humanSetAt = Date.now();
      if (text) it.note = text;
      break;
    }
    // ☠️ ONE FIELD, NOT A CALENDAR. This is deliberately a single next-external-
    // event, not a schedule: the hook's job is to say whether the run is idle and
    // until when, and a second list here would rebuild the thing this file is
    // being cut down from.
    case 'event': {
      const body = rest.join(' ');
      if (body.trim() === 'none') { s.event = null; break; }
      const sep = rest.indexOf('--');
      const when = (sep < 0 ? rest : rest.slice(0, sep)).join(' ').trim();
      const what = sep < 0 ? '' : rest.slice(sep + 1).join(' ').trim();
      if (!when) fail('usage: event <when> -- "<what happens then, and what arms it>"\n' +
        '       event none    (nothing is scheduled any more)\n' +
        '☠️ Only declare an event something ACTUALLY arms - a timer, a cron, a person who ' +
        'agreed. A declared event with nothing behind it is worse than none: it reads as ' +
        'a promise the run is keeping and it is keeping nothing.');
      const at = parseWhen(when);
      if (!at) fail(`could not read a time out of "${when}"`);
      if (!what) fail('say WHAT happens and what arms it — a bare time tells a reader nothing.');
      s.event = { at, what, setAt: Date.now() };
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
      else if (cmd === 'wait') {
        // ☠️ A WAIT WITHOUT AN EXPIRY IS HOW A PLAN ROTS. Measured: a dozen items
        // were parked with "the phone is busy with the census until ~08:15". The
        // census ended at 08:15 and nothing re-read the sentence, so at 10:19 the
        // plan still reported zero actionable work while the phone had been free
        // for two hours - and the owner had to ask why nothing was happening.
        // Being blocked has a WHEN, and the WHEN belongs in the state, not in a
        // sentence nobody re-evaluates. `--until` makes the item come back BY
        // ITSELF.
        const ui = rest.indexOf('--until');
        const spec = ui >= 0 ? rest[ui + 1] : '';
        const body = ui >= 0 ? rest.slice(1, ui).join(' ') : text;
        it.status = 'waiting';
        it.note = body || it.note;
        it.waitAt = Date.now();
        it.waitAsked = Date.now();
        if (spec) {
          const until = parseUntil(spec);
          if (!until) fail(`cannot read "${spec}" as a time.\n` +
            'Use a clock time ("08:15", "2026-09-02 19:00") or a duration ("90m", "6h", "2d").');
          it.waitUntil = until; it.waitSpec = spec;
        } else {
          delete it.waitUntil; delete it.waitSpec;
          console.error('☠️ no --until given. This item will sit in WAITING until somebody ' +
            'happens to re-read the reason - which is exactly how a plan reports "nothing to do" ' +
            'while the thing it waits for finished hours ago.\n' +
            `   wait ${id} "<why>" --until 19:00   |   --until 90m   |   --until 2d`);
        }
      }
      else { it.status = 'dropped'; if (text) it.note = text; }
      break;
    }
    case 'stop':
      s.active = false;
      break;
    case 'flush': case 'show':
      break;
    default:
      console.error('usage: start|goal|add|note|wait|human|event|after|unafter|done|drop|measured|retracted|consulted|status|watch|flush|show|stop');
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

  // ☠️ DO NOT START SOMETHING THAT OUTLIVES THE ANSWER YOU ARE WAITING FOR.
  // Observed 2026-09-02: a review was asked for, and before it came back a
  // 75-minute census was launched on the phone. The review's first point was
  // that the census's alarm length was wrong - and by then the phone was
  // unreachable inside its own sleep cycles, so the run could not be stopped.
  // A fifth of its samples are systematically contaminated as a result.
  //
  // The rule is not about censuses. It is: if the thing you are about to start
  // takes longer than the answer you are already waiting for, the answer comes
  // first. Asking and then acting is the same as not asking.
  if (ev.hook_event_name === 'PreToolUse') {
    const cmd = String((ev.tool_input || {}).command || '');

    // ☠️ RECOGNISE THE BYPASS, NOT THE WORK. The first version matched script
    // names and "long-looking" commands, which is brittle in the worst way: a new
    // script is simply not in the list and the gate silently stops protecting.
    // The checks themselves now live in tools/fp3-measure, where they bind
    // whoever calls them - a second terminal, a hand-typed ssh - instead of only
    // this session. So the only thing left for a session hook to notice is
    // someone going around that door.
    const RAW_LAUNCH = /\b(systemd-run|nohup|setsid)\b/;
    const TO_DEVICE = /\b(ssh\s|scp\s|fp3[:\s]|172\.16\.42\.1|192\.168\.100\.17)/;
    // ☠️ AN SSH LOGIN IS AN AP WAKE, AND I HAVE SPOILED TWO MEASUREMENTS WITH ONE.
    // A rehearsal leg came back with a 9 s median sleep against a 90 s alarm - 28
    // samples instead of 4, of which the gate kept ONE - because this session
    // ssh'd and pinged the phone in the middle of it to answer a question about
    // the reboot. Earlier the same day, polling ssh's during the owner's call test
    // woke the phone between calls. Both times the rule was known and written down
    // in prose; prose is not a gate.
    //
    // fp3-measure records what it launched and when it is due. Until then, a
    // command that touches the phone is refused - because the answer during a
    // measurement is "the phone is measuring, I will look at HH:MM", not a quick
    // ssh. Reading the result afterwards costs nothing; reading it during costs
    // the measurement.
    const MEASURING = path.join(DIR, 'fp3-measuring.json');
    let meas = null;
    try { meas = JSON.parse(fs.readFileSync(MEASURING, 'utf8')); } catch { /* none */ }
    const PROBE = /\b(ssh\s|scp\s|ping\s|172\.16\.42\.1|192\.168\.100\.17)/;
    if (meas && meas.until > Date.now() && PROBE.test(cmd)
        && !/fp3-measure|FP3_TOUCH_ANYWAY/.test(cmd)) {
      logGate(s, 'touching-a-running-measurement'); write(s);
      const mins = Math.ceil((meas.until - Date.now()) / 6e4);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            `A measurement is running on the phone (${meas.unit || 'unnamed'}), due in ${mins} min.\n\n` +
            `☠️ AN SSH LOGIN IS AN AP WAKE. This session has already spoiled two measurements ` +
            `this way: a rehearsal leg woke every 9 s against a 90 s alarm because of one ` +
            `"let me just check" ssh, and the owner's call test was woken between calls by ` +
            `polling. Both times the rule existed - in prose.\n\n` +
            `Wait for it. If somebody asks what the phone is doing, the answer is "it is ` +
            `measuring, I will look at ${new Date(meas.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}" - not a quick ssh.\n` +
            `If this genuinely cannot wait, put FP3_TOUCH_ANYWAY=1 in the command and say in ` +
            `your reply that the measurement is now contaminated.`,
        },
      }));
      process.exit(0);
    }
    if (s.active && RAW_LAUNCH.test(cmd) && TO_DEVICE.test(cmd) && !/fp3-measure/.test(cmd)) {
      logGate(s, 'wrapper-bypass'); write(s);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason:
            `This starts something on the phone directly instead of through the one door.\n\n` +
            `  docs/power/bringup/tools/fp3-measure <eta-minutes> <script-on-device> [args...]\n\n` +
            `☠️ The wrapper refuses what a hook cannot see: it checks whether a review is still ` +
            `out (a 75-minute census was launched today minutes before the answer said its alarm ` +
            `length was wrong), whether the phone is already measuring, and whether the phone is ` +
            `merely UNREACHABLE - which is not the same as idle, and reads as idle to a naive ` +
            `check. It also requires an ETA, because a measurement nobody can watch is one ` +
            `nobody notices failing.\n\n` +
            `A one-off command that is genuinely not a measurement can be phrased without ` +
            `systemd-run / nohup / setsid.`,
        },
      }));
      process.exit(0);
    }

    process.exit(0);
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
    const open = actionableItems(s);
    const blocked = blockedItems(s);
    const waiting = waitingItems(s);
    const h = hash(s);
    if (h !== s.lastHash) { s.blocks = 0; s.lastHash = h; }

    // ☠️ The staleness gate shares the anti-spin budget on purpose: a second
    // budget is a second way to spin. It fires when a result has landed - a new
    // capture, uncommitted docs - and nothing in the plan mentions it, which is
    // precisely the state an auto-compaction turns into lost work.
    const stale = staleReasons(s);
    if (stale.length && s.blocks < MAX_BLOCKS) {
      s.blocks += 1; logGate(s, 'unrecorded-result'); write(s); flushStatus(s);
      process.stdout.write(JSON.stringify({
        decision: 'block',
        systemMessage: `[hajcsár] ${stale.length} rögzítetlen eredmény - a kapu visszaküldött leírni`,
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
      s.blocks += 1; s.consultAnnounced = true; logGate(s, 'review-due'); write(s); flushStatus(s);
      if (due.startsWith('PENDING:')) {
        // ☠️ CHASE THE ONE THAT IS OUT; DO NOT START ANOTHER. A second reviewer
        // asked the same question duplicates the work and, worse, answers a
        // state that has moved - the dated trap in this repo's own notes.
        process.stdout.write(JSON.stringify({
          decision: 'block',
          systemMessage: `[hajcsár] a kikért bírálat ${due.slice(8)} perce kint van rögzítetlenül`,
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
        systemMessage: `[hajcsár] külső bírálat esedékes (${due}) - kérek egyet a friss adatokkal`,
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
      // ☠️ A HUMAN TASK CHANGES THIS BRANCH'S SIGNATURE. Without it in wsig, the
      // "nothing left but waiting" message is announced once and then suppressed
      // as a repeat - so the moment somebody is actually waiting on a person, the
      // instructions stop being printed. That is the exact branch where they
      // matter most, because there is nothing else on screen to read.
      const humanSig = s.items.filter((i) => i.status === 'human')
        .map((i) => `${i.id}:${i.humanWhen}`).join('|');
      // ☠️ AND THE BLOCKED SET IS IN THE SIGNATURE TOO. This branch runs BEFORE
      // the all-blocked one, so in a mixed plan - some items waiting, some blocked
      // behind them - it takes the turn and the blocked items would never be named
      // at all. Caught by reading the branch order, not by a test: the live plan
      // has 22 waiting items, so this is the branch that always wins here.
      const bsig0 = blocked.map((i) => `${i.id}:${blockers(s, i).all.join('.')}`).join('|');
      const wsig = waiting.map((i) => `${i.id}:${i.note || ''}`).join('|') + '#' + humanSig + '#' + bsig0;
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
        `not to prove you are alive.` +
        (blocked.length ? `\n\n⛔ BLOCKED — open, but waiting on an unfinished prerequisite:\n` +
          blocked.map((i) => `  ${i.id}. ${clip(i.text, 90)}\n        waiting on: ${blockers(s, i).all.join(', ')}`)
            .join('\n') : '') +
        (humanSig ? '\n' + renderHuman(s, true).join('\n') : ''));
      process.exit(0);
    }
    // ☠️ ALL-BLOCKED IS THE SAME TRAP AS ALL-WAITING, AND IT IS WORSE, BECAUSE THE
    // PLAN LOOKS FULL. Nothing is startable, so a block produces a nudge every turn
    // for work that cannot begin, and any note written in reply restores the
    // anti-spin budget - it never terminates. Say it once, per distinct blocked set,
    // and let the turn end.
    if (!open.length && blocked.length) {
      const bsig = blocked.map((i) => `${i.id}:${blockers(s, i).all.join('.')}`).join('|');
      if (s.blockedAnnounced === bsig) { write(s); process.exit(0); }
      s.blockedAnnounced = bsig;
      logGate(s, 'all-blocked'); write(s); flushStatus(s);
      emit('Stop',
        `Nothing is startable: ${blocked.length} open item(s), every one waiting on an ` +
        `unfinished prerequisite.\n` +
        blocked.map((i) => `  ⛔ ${i.id}. ${clip(i.text, 90)}\n        waiting on: ${blockers(s, i).all.join(', ')}`)
          .join('\n') +
        `\n☠️ Not blocking the turn - a plan that is full but frozen would spin forever. ` +
        `Either the prerequisite is really open (finish it, or \`wait\` it with a reason), ` +
        `or the dependency is wrong (\`unafter\`). A dropped prerequisite is a decision, ` +
        `not a wait.`);
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
      // ☠️ ONE JSON OBJECT PER HOOK RUN. Two writes is not two messages, it is a
      // malformed stream - caught before it shipped, by reading the write rather
      // than the intent.
      process.stdout.write(JSON.stringify({
        systemMessage: `[hajcsár] ☠️ ${MAX_BLOCKS} kör óta nem mozdult a terv, ` +
          `${open.length} tétel nyitva - a kapu nem blokkol tovább, hogy ne pörögjön.`,
        hookSpecificOutput: {
          hookEventName: 'Stop',
          additionalContext:
            `☠️ The autonomous plan has not changed across ${MAX_BLOCKS} turns while ` +
            `${open.length} item(s) are still open. Not blocking again — that would spin. ` +
            `Tell the user plainly what is blocking item ${nextItem(s, open).id} ` +
            `("${clip(nextItem(s, open).text, 120)}") ` +
            `and what you need from them.`,
        },
      }));
      process.exit(0);
    }
    const nx = nextItem(s, open);
    s.blocks += 1; logGate(s, 'open-work'); write(s); flushStatus(s);
    process.stdout.write(JSON.stringify({
      decision: 'block',
      // ☠️ `reason` GOES TO THE MODEL, `systemMessage` GOES TO THE PERSON. This
      // hook had only `reason` for its whole life, so every gate it fired was
      // invisible to the user - who asked three times in one session why nothing
      // seemed to be running, while the driver was in fact firing on every turn.
      // A gate nobody can see is indistinguishable from a stall, and the person
      // watching cannot tell "waiting on a 30-minute measurement" from "stuck".
      // ☠️ ONE LINE, not the plan: the full listing is for the model, and pasting
      // it here would bury the terminal in the same text every turn.
      systemMessage:
        `[hajcsár] ${open.length} nyitott · következő: #${nx.id} ${clip(nx.text.replace(/^★+\s*/, ''), 70)}`,
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
