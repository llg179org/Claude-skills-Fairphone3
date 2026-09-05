#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// AI-generated (Claude Opus 5) under the direction of Lajosházi, László Gergely.
//
// THE HOST HALF OF THE COMPLETION LOOP. Reads the sentinels `fp3-measure-done`
// leaves on the phone and turns them into queue movement, so a measurement the
// device ran on a timer does not sit unnoticed.
//
//   queue-sync.cjs            consume new completions and act on them
//   queue-sync.cjs --dry-run  say what it would do, change nothing
//   queue-sync.cjs --list     show every sentinel on the device, consumed or not
//
// ☠️ WHAT IT DOES NOT DO: it never closes the run's own task. The 2026-09-03
// night exited cleanly and produced nothing usable, so "finished" is not
// "succeeded" and only a human or an evaluator task may close it. What it does
// is (a) write the completion facts into that task's `why`, so the next reader
// sees them without logging into the phone, and (b) release the EVALUATOR, which
// is the thing that was deadlocked.
//
// THE CONVENTION, and it is the point of the whole design:
//   the run task R      is left alone, only annotated
//   its evaluator E     is marked  [~]  with  until: completion:R
//   when R's sentinel appears, E flips to [ ] ready and the dispatcher hands it out
//
// ☠️ E must NOT use `after: R`. That was the actual deadlock on 2026-09-05: #118
// judged whether #85's night was good enough and carried `after: 85`, so the
// evaluation that would justify closing 85 could not start until 85 was closed.
// `until: completion:R` depends on the run STOPPING, which is a fact the device
// knows, instead of on a verdict, which it does not.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const STATE_DIR = process.env.CLAUDE_STATE_DIR ||
  path.join(process.env.HOME || '/home/fp3', '.claude', '.state');
const SEEN = path.join(STATE_DIR, 'fp3-completions.json');
const QUEUE = '/home/fp3/git/Claude-skills-Fairphone3/plugins/fp3/hooks/queue.cjs';
const REMOTE = '/var/log/fp3/completions';
// overridable so the release path can be tested against a scratch queue
const TODO = process.env.FP3_TODO || '/mnt/1TB/pmos/fp3-pmaports/docs/TODO.md';

const dry = process.argv.includes('--dry-run');
const list = process.argv.includes('--list');

function ssh(cmd) {
  try { return execFileSync('fp3-ssh', [cmd], { encoding: 'utf8', timeout: 60000 }); }
  catch (e) { return null; }
}
// ☠️ A failed queue.cjs call must not be swallowed. Marking a sentinel consumed
// after the action failed would lose the release silently and for good - the
// same shape as reporting a restore that did not happen, which cost this project
// two dead touchscreens on 2026-09-04. `q` records the failure; the caller
// refuses to consume the sentinel when anything failed.
let failed = 0;
function q(...args) {
  if (dry) return `(dry-run) queue.cjs ${args.join(' ')}`;
  try { return execFileSync('node', [QUEUE, ...args], { encoding: 'utf8' }).trim(); }
  catch (e) { failed++; return `☠️ queue.cjs FAILED: ${String(e.message).split('\n')[0]}`; }
}
const readSeen = () => { try { return JSON.parse(fs.readFileSync(SEEN, 'utf8')); } catch { return {}; } };
const writeSeen = (s) => { if (!dry) { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(SEEN, JSON.stringify(s, null, 1)); } };

// ---- read every sentinel in one round trip; the link is the slow part
const blob = ssh(`for f in ${REMOTE}/*.done; do [ -f "$f" ] || continue; echo "==FILE $f"; cat "$f"; done 2>/dev/null`);
if (blob === null) { console.error('queue-sync: cannot reach the device'); process.exit(1); }

const sentinels = [];
for (const chunk of blob.split('==FILE ').slice(1)) {
  const [head, ...rest] = chunk.split('\n');
  const kv = {};
  for (const line of rest) { const i = line.indexOf('='); if (i > 0) kv[line.slice(0, i)] = line.slice(i + 1); }
  if (kv.task) sentinels.push({ file: head.trim(), kv, hash: crypto.createHash('sha1').update(rest.join('\n')).digest('hex').slice(0, 12) });
}

if (!sentinels.length) { console.log('no completion sentinels on the device'); process.exit(0); }

const seen = readSeen();
if (list) {
  for (const s of sentinels)
    console.log(`${seen[s.kv.task] === s.hash ? 'consumed' : 'NEW     '}  task ${s.kv.task}  ${s.kv.outcome}  ${s.kv.ended}  ${s.kv.summary || ''}`);
  process.exit(0);
}

let acted = 0;
for (const s of sentinels) {
  const t = s.kv.task;
  if (seen[t] === s.hash) continue;                       // same run, already handled
  // ☠️ Task 0 means the run did not say whose it was. Report it EVERY time and
  // never consume it: a measurement nobody can attribute is a standing problem,
  // and silently forgetting it is how #85 was lost for two days in the first place.
  if (t === '0') {
    console.log(`\n☠️ UNATTRIBUTED completion (${s.kv.ended}, unit ${s.kv.unit}): ${s.kv.summary || ''}`);
    console.log('   Whoever armed that run did not set FP3_TASK, so no queue entry can be released.');
    continue;
  }
  acted++;
  const before = failed;
  console.log(`\n== task ${t}: ${s.kv.outcome} at ${s.kv.ended}`);
  console.log(`   ${s.kv.summary || '(no summary)'}`);
  if (s.kv.data) console.log(`   data: ${s.kv.data}`);

  // (a) annotate the run task - never close it
  const note = `DEVICE-REPORTED ${s.kv.outcome} at ${s.kv.ended}` +
    (s.kv.data ? `, data at ${s.kv.data}` : '') +
    (s.kv.summary ? `. ${s.kv.summary}` : '') +
    ` [recorded by queue-sync; "${s.kv.outcome}" means the run STOPPED, not that it succeeded]`;
  console.log('   ' + q('set', t, 'why', note).split('\n')[0]);

  // (b) release whatever was waiting on this completion.
  // ☠️ Done with the queue's OWN mark/set rather than a new subcommand: several
  // windows share queue.cjs, and widening it to serve one caller is a worse
  // trade than parsing the file the same way it does.
  const todo = fs.readFileSync(TODO, 'utf8');
  const waiting = [];
  const re = /^\s*-\s*\[([ x~@])\]\s*(\d+)\./gm;
  let m;
  while ((m = re.exec(todo))) {
    const id = m[2], from = m.index;
    const nextTask = todo.slice(from + 1).search(/\n\s*-\s*\[[ x~@]\]|\n\S/);
    const block = todo.slice(from, nextTask < 0 ? todo.length : from + 1 + nextTask);
    if (m[1] === '~' && new RegExp(`^\\s+until:\\s*completion:${t}\\s*$`, 'm').test(block)) waiting.push(id);
  }
  if (!waiting.length) console.log(`   nothing was waiting on completion:${t}`);
  for (const id of waiting) {
    console.log(`   releasing ${id} (was until: completion:${t})`);
    console.log('     ' + q('mark', id, ' ').split('\n')[0]);
    console.log('     ' + q('set', id, 'until', '').split('\n')[0]);
  }
  if (failed > before) {
    console.log(`   ☠️ ${failed - before} queue action(s) failed - NOT marking this completion consumed,`);
    console.log('      so the next run retries it rather than losing the release.');
  } else {
    seen[t] = s.hash;
  }
}
writeSeen(seen);
console.log(acted ? `\n${acted} completion(s) acted on${failed ? `, ${failed} queue action(s) FAILED` : ''}` : 'nothing new');
process.exit(failed ? 1 : 0);
