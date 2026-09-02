#!/usr/bin/env node
// AI-generated (Claude Opus 5) under the direction of Lajosházi, László Gergely.
//
// Self-check for the dependency graph in autonomy.cjs. It drives the REAL CLI in
// a throwaway state directory (CLAUDE_STATE_DIR) with FP3_AUTONOMY_NO_WRITE=1, so
// it cannot touch a live run's state or its STATUS.md.
//
// ☠️ IT ALSO RUNS ONE CASE THAT MUST FAIL. A verifier not yet shown failing has
// proved nothing - this project has twice shipped a check that could only pass
// (a curl that returned 302 for every hash; a battery that reported 27 ok on a
// silent speaker). `--demo-broken` asserts something false on purpose, so the
// red path is visible next to the green one.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOK = path.join(__dirname, 'autonomy.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomy-test-'));
const env = { ...process.env, CLAUDE_STATE_DIR: dir, FP3_AUTONOMY_NO_WRITE: '1' };

let pass = 0, fail = 0;
const run = (...args) => {
  try {
    return { ok: true, out: execFileSync('node', [HOOK, ...args], { env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
};
const state = () => JSON.parse(fs.readFileSync(path.join(dir, 'fp3-autonomy.json'), 'utf8'));
const check = (name, cond, detail) => {
  if (cond) { pass += 1; console.log(`  ok    ${name}`); }
  else { fail += 1; console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`); }
};

console.log(`state dir: ${dir}`);
run('start', 'dependency selftest');
run('add', '★ egy csillag, ez az elofeltetel');          // 1
run('add', '★★★ harom csillag, ez var az elsore');       // 2
run('add', '★★ ket csillag, fuggetlen');                 // 3
run('add', '★ elofeltetel, amit eldobunk');              // 4
run('add', '★★ ez arra epul, amit eldobunk');            // 5

// --- old format still readable: an item with no `after` at all
check('a regi formatum olvashato (hianyzo after = ures lista)',
  state().items.every((i) => i.after === undefined));

// --- 1. dependencies and cycle rejection
run('after', '2', '1');
check('after felvesz elofeltetelt', (state().items.find((i) => i.id === 2).after || []).join() === '1');

const self = run('after', '1', '1');
check('onhivatkozas elutasitva', !self.ok && /cannot depend on itself/.test(self.out), self.out.trim());

const nope = run('after', '2', '999');
check('nem letezo id elutasitva', !nope.ok && /no item 999/.test(nope.out), nope.out.trim());

const cyc = run('after', '1', '2');            // 2 already depends on 1
check('kor elutasitva, es MEGMONDJA a kort',
  !cyc.ok && /cycle/.test(cyc.out) && /1 → 2 → 1/.test(cyc.out), cyc.out.trim());

// --- 2. blocked is not actionable, and NEXT skips it
const plan = run('show').out;
run('flush');
// ☠️ THE FIRST Stop DOES NOT NECESSARILY CARRY NEXT. Other gates share that hook
// - a review is due, a result is unrecorded - and each takes the turn for itself.
// The first version of this test read one Stop, got a gate message, and reported
// NEXT=null as a dependency bug. Ask a few times and take the first answer that
// is actually the ranking.
const stop = () => execFileSync('node', [HOOK], {
  env, encoding: 'utf8', input: JSON.stringify({ hook_event_name: 'Stop' }),
});
const next = () => {
  for (let k = 0; k < 5; k++) {
    const m = /NEXT \(highest priority open item\): (\d+)\./.exec(stop());
    if (m) return Number(m[1]);
  }
  return null;
};
const n1 = next();
check('a blokkolt 3★ NEM lesz NEXT', n1 !== 2, `NEXT=${n1}`);

// --- 3. inheritance: the 1★ prerequisite outranks the independent 2★
check('az 1★ elofeltetel orokli a 3★-ot es O lesz a NEXT', n1 === 1, `NEXT=${n1} (varhato 1)`);
const r = stop();
check('a render megmutatja, MIERT kerult elore', /1★ \(↑3 via #2\)/.test(r),
  (/\(↑[^)]*\)/.exec(r) || ['nincs ↑ jelolés'])[0]);
check('a blokkolt kulon szekcioba kerul', /BLOCKED — prerequisites unfinished/.test(r) && /waiting on: 1/.test(r));

// --- 4. a dropped prerequisite is flagged, not treated as met
run('after', '5', '4');
run('drop', '4', 'nem kell megis');
const r2 = stop();
check('az eldobott elofeltetel NEM szamit teljesitettnek', /⛔ 5\./.test(r2));
check('es dontesként jelzi, nem varakozaskent', /prerequisite dropped or gone: 4/.test(r2), 
  (/prerequisite[^\n]*/.exec(r2) || ['nincs jelzés'])[0]);

// --- 5. unafter releases it
run('unafter', '5', '4');
check('unafter felszabadit', (state().items.find((i) => i.id === 5).after || []).length === 0);

// --- 6. `after` counts as progress (it is in the hash)
const h = () => { run('flush'); return state().lastHash; };
const before = state().lastHash;
run('after', '3', '1');
stop();
check('az after benne van a hash-ben (haladasnak szamit)', state().lastHash !== before,
  `${before} -> ${state().lastHash}`);

// --- the deliberately broken case
if (process.argv.includes('--demo-broken')) {
  console.log('\n--- szandekosan rossz eset, hogy a verifikator bukni is lathato legyen:');
  check('DEMO: a blokkolt item NEXT lesz (ez HAMIS allitas)', next() === 2, `NEXT=${next()}`);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
