#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// AI-generated (Claude Fable 5.1) under the direction of Lajosházi, László Gergely.
//
// hooks-toggle — turn the fp3 hooks on or off in ~/.claude/settings.json by
// editing ONLY the `hooks` key.
//
// ☠️ WHY NOT `cp settings.json.hooks-all-on ~/.claude/settings.json`. That was
// the documented way to turn them back on (queue task 127), and the backup was a
// snapshot of the WHOLE settings file taken at 09:12. By 10:00 the live file had
// gained a plugin (kernel-review-workflow, its marketplace, its enable flag) —
// copying the backup over it would have uninstalled the plugin silently, and any
// later change to permissions or env would go the same way. A toggle that touches
// one key cannot do that. The hook list itself comes from hooks.json beside this
// file, so there is one source of truth for what the hooks are; this only maps
// `${CLAUDE_PLUGIN_ROOT}/hooks/<f>` onto the ~/.claude/hooks/ symlinks the
// settings file uses.
//
//   hooks-toggle.cjs on | off | status
'use strict';
const fs = require('fs');
const path = require('path');

const SETTINGS = path.join(process.env.CLAUDE_CONFIG_DIR ||
  path.join(process.env.HOME || '/home/fp3', '.claude'), 'settings.json');
const LINKDIR = path.join(path.dirname(SETTINGS), 'hooks');
const SRC = path.join(__dirname, 'hooks.json');
// ~/.claude/hooks/<link> -> hooks/<file>; a link is created when it is missing.
const LINK = {
  'risky-target.cjs': 'fp3-risky-target.cjs',
  'measurement-watch.cjs': 'fp3-measurement-watch.cjs',
  'queue.cjs': 'fp3-queue.cjs',
  'results-guard.cjs': 'fp3-results-guard.cjs',
  'precompact-status.cjs': 'precompact-status.cjs',
};

function render() {
  const src = JSON.parse(fs.readFileSync(SRC, 'utf8')).hooks;
  const out = {};
  for (const [ev, groups] of Object.entries(src)) {
    out[ev] = groups.map((g) => ({
      ...(g.matcher ? { matcher: g.matcher } : {}),
      hooks: g.hooks.map((h) => {
        const m = /\/hooks\/([A-Za-z0-9_.-]+)"?\s*$/.exec(h.command);
        const file = m ? m[1] : null;
        const link = file && LINK[file];
        if (!link) throw new Error(`no ~/.claude/hooks link mapping for ${h.command}`);
        const lp = path.join(LINKDIR, link);
        try { fs.lstatSync(lp); } catch {
          fs.mkdirSync(LINKDIR, { recursive: true });
          fs.symlinkSync(path.join(__dirname, file), lp);
        }
        return { type: 'command', command: `node ${lp}` };
      }),
    }));
  }
  return out;
}

const cmd = process.argv[2];
let s;
try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch (e) {
  console.error(`cannot read ${SETTINGS}: ${e.message}`); process.exit(1);
}
const count = (h) => Object.values(h || {}).reduce((n, g) => n + g.reduce((m, x) => m + (x.hooks || []).length, 0), 0);
if (cmd === 'status') {
  console.log(`${count(s.hooks)} hook registration(s) in ${SETTINGS}` +
    (count(s.hooks) ? ':\n  ' + Object.entries(s.hooks).map(([e, g]) =>
      `${e}: ${g.flatMap((x) => x.hooks.map((h) => path.basename(h.command.replace(/^node\s+/, '')))).join(', ')}`).join('\n  ') : ''));
  process.exit(0);
}
if (cmd !== 'on' && cmd !== 'off') { console.error('usage: hooks-toggle.cjs on|off|status'); process.exit(1); }
// ☠️ A DATED COPY OF THE WHOLE FILE BEFORE EVERY WRITE, so the previous state is
// one `cp` away — but it is a record, never the thing you restore hooks from.
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '');
fs.copyFileSync(SETTINGS, `${SETTINGS}.bak-${stamp}`);
s.hooks = cmd === 'on' ? render() : {};
const tmp = `${SETTINGS}.${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n');
fs.renameSync(tmp, SETTINGS);
console.log(`hooks ${cmd}: ${count(s.hooks)} registration(s) in ${SETTINGS} (previous copy: ${SETTINGS}.bak-${stamp})`);
