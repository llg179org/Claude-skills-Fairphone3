#!/usr/bin/env node
// AI-generated (Claude Opus 5) under the direction of Lajosházi, László Gergely.
//
// Carry an autonomous run's PLAN and STATUS across turns, and refuse to end a
// turn while the plan still has work in it.
//
// The failure this exists to stop: during an autonomous run ("keep going until
// morning", "don't stop and ask"), the plan lives only in the model's head. At
// the end of a turn it evaporates, the assistant stops on a natural-looking
// boundary — a result reported, a document committed — and the user has to say
// "you stopped again". That is not a motivation problem; it is a state problem,
// so it gets state.
//
// Two hooks and a CLI:
//   Stop            - block the end of the turn while an item is open, and hand
//                     back the next step so the model resumes without a nudge
//   UserPromptSubmit- the user spoke: reset the anti-spin counter and show the plan
//   CLI             - how the model reads and edits the plan
//
// ☠️ ANTI-SPIN IS NOT OPTIONAL. A Stop hook that always blocks is an infinite
// loop. This one blocks at most MAX_BLOCKS times without the plan changing; a
// changed plan (an item finished, added, or re-scoped) resets the budget,
// because progress is exactly what the block is for. Running out of budget lets
// the turn end and says so.
//
//   node autonomy.cjs start "<goal>"      begin an autonomous run
//   node autonomy.cjs add "<step>" [...]  append steps
//   node autonomy.cjs done <id> [note]    mark a step finished
//   node autonomy.cjs drop <id> [why]     abandon a step, with the reason
//   node autonomy.cjs note <id> "<text>"  record progress without finishing
//   node autonomy.cjs wait <id> "<what>"  the item is blocked on something OUTSIDE
//                                         this session - a measurement that has to
//                                         run, a build, a person. It stays open and
//                                         visible, but it does not hold the turn
//   node autonomy.cjs show                print the plan
//   node autonomy.cjs stop                end the run (user said stop, or done)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.CLAUDE_STATE_DIR ||
  path.join(process.env.HOME || '/home/fp3', '.claude', '.state');
const FILE = path.join(DIR, 'fp3-autonomy.json');
const MAX_BLOCKS = 4;

const empty = () => ({ active: false, goal: '', items: [], nextId: 1, blocks: 0, lastHash: '', waitAnnounced: '' });
function read() {
  try { return Object.assign(empty(), JSON.parse(fs.readFileSync(FILE, 'utf8'))); }
  catch { return empty(); }
}
function write(s) {
  try { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(s, null, 1)); }
  catch { /* bookkeeping must never break the session */ }
}
// ☠️ A 'waiting' item is open but NOT actionable, and the difference is the whole
// point: blocking a turn over work that is waiting on a measurement produces a
// nudge every turn while nothing can move, and any note written in response
// restores the anti-spin budget, so it never terminates. That happened - the
// hook pushed for the next item five times while every item was blocked on one
// running measurement. Waiting items hold the plan, not the turn.
const openItems = (s) => s.items.filter((i) => i.status === 'todo' || i.status === 'doing');
const waitingItems = (s) => s.items.filter((i) => i.status === 'waiting');
const hash = (s) => crypto.createHash('sha1')
  .update(JSON.stringify(s.items.map((i) => [i.id, i.status, i.text, i.note || ''])))
  .digest('hex').slice(0, 12);

function render(s) {
  if (!s.active) return 'No autonomous run is active.';
  const line = (i) => {
    const mark = { todo: '[ ]', doing: '[~]', done: '[x]', dropped: '[-]', waiting: '[…]' }[i.status] || '[?]';
    return `  ${mark} ${i.id}. ${i.text}${i.note ? `\n        · ${i.note}` : ''}`;
  };
  return [`GOAL: ${s.goal}`, ...s.items.map(line)].join('\n');
}

// ---------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
if (argv.length) {
  const s = read();
  const [cmd, ...rest] = argv;
  const arg = rest.join(' ');
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
    case 'done': case 'drop': case 'note': case 'wait': {
      const id = Number(rest[0]);
      const it = s.items.find((i) => i.id === id);
      if (!it) { console.error(`no item ${rest[0]}`); process.exit(1); }
      const text = rest.slice(1).join(' ');
      if (cmd === 'note') { it.status = 'doing'; it.note = text; }
      else if (cmd === 'wait') { it.status = 'waiting'; it.note = text || it.note; }
      else { it.status = cmd === 'done' ? 'done' : 'dropped'; if (text) it.note = text; }
      break;
    }
    case 'stop':
      s.active = false;
      break;
    case 'show':
      break;
    default:
      console.error('usage: start|add|done|drop|note|show|stop');
      process.exit(2);
  }
  if (cmd !== 'show') { s.blocks = 0; s.lastHash = hash(s); s.waitAnnounced = ''; }  // any edit is progress
  write(s);
  console.log(render(s));
  process.exit(0);
}

// ---------------------------------------------------------------- hooks
let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  let ev; try { ev = JSON.parse(input); } catch { process.exit(0); }
  const s = read();

  if (ev.hook_event_name === 'UserPromptSubmit') {
    // the user spoke: they can always redirect, so give the budget back
    if (s.active) {
      s.blocks = 0; write(s);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'UserPromptSubmit',
          additionalContext:
            `Autonomous run in progress — the plan carried across turns:\n${render(s)}\n` +
            `Edit it with \`node "${__filename}" done|note|wait|add|drop|show ...\`; \`stop\` ends the run.`,
        },
      }));
    }
    process.exit(0);
  }

  if (ev.hook_event_name === 'Stop') {
    if (!s.active) process.exit(0);
    const open = openItems(s);
    const waiting = waitingItems(s);
    if (!open.length && waiting.length) {
      // ☠️ SAY IT ONCE. The first version emitted this summary on every Stop, so a
      // long wait produced the same paragraph turn after turn - the assistant
      // repeated it to the user each time because it arrives as fresh context.
      // A reminder that repeats unchanged is noise, and noise trains the reader to
      // skip the channel it arrives on. Re-announce only when the set of waiting
      // items actually changes.
      const wsig = waiting.map((i) => `${i.id}:${i.note || ''}`).join('|');
      if (s.waitAnnounced === wsig) { write(s); process.exit(0); }
      s.waitAnnounced = wsig; write(s);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'Stop',
          additionalContext:
            `Every actionable item is done; ${waiting.length} item(s) are waiting on something ` +
            `outside this session:\n` + waiting.map((i) => `  … ${i.id}. ${i.text}${i.note ? ` (${i.note})` : ''}`).join('\n') +
            `\nNot blocking - there is nothing to do until those return. Say plainly what is ` +
            `being waited on and roughly when, then stop.`,
        },
      }));
      process.exit(0);
    }
    if (!open.length) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'Stop',
          additionalContext:
            'Every item in the autonomous plan is finished. Either add the next steps ' +
            `(\`node "${__filename}" add "..."\`) or close the run (\`stop\`) and say so.`,
        },
      }));
      process.exit(0);
    }
    const h = hash(s);
    if (h !== s.lastHash) { s.blocks = 0; s.lastHash = h; }
    if (s.blocks >= MAX_BLOCKS) {
      write(s);
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'Stop',
          additionalContext:
            `☠️ The autonomous plan has not changed across ${MAX_BLOCKS} turns while ` +
            `${open.length} item(s) are still open. Not blocking again — that would spin. ` +
            `Tell the user plainly what is blocking item ${open[0].id} ("${open[0].text}") ` +
            `and what you need from them.`,
        },
      }));
      process.exit(0);
    }
    s.blocks += 1; write(s);
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason:
        `Autonomous run is active and the plan still has open work. Do not stop to ask — ` +
        `continue with the next item now.\n\n${render(s)}\n\n` +
        `NEXT: ${open[0].id}. ${open[0].text}\n` +
        `Mark progress as you go: \`node "${__filename}" note ${open[0].id} "<what happened>"\`, ` +
        `\`done ${open[0].id}\`, or \`add "<new step>"\` when the work reveals more.\n` +
        `☠️ If the item cannot be worked on right now — a measurement window that has to ` +
        `run its course, a build, a boot, an answer only the user can give — mark it ` +
        `\`wait ${open[0].id} "<what it waits for>"\`. It stays open and visible but stops ` +
        `holding the turn, and this reminder stops repeating. Reaching for something to do ` +
        `instead is how a measurement gets disturbed. Use \`drop\` only to abandon a step ` +
        `for good.`,
    }));
    process.exit(0);
  }
  process.exit(0);
});
