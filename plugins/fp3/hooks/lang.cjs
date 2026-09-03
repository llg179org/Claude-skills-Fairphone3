#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-or-later
//
// AI-generated (Claude Fable 5.1) under the direction of Lajosházi, László Gergely.
//
// lang — the one-line messages a hook shows the PERSON, in the language Claude
// Code is configured for.
//
// ☠️ WHY. Two hooks carried Hungarian `systemMessage` lines in this public,
// English repository — the operator's language, hard-coded. The operator's
// language is a setting (`/config` → Language, stored as `"language"` in
// `.claude/settings.json`), not a property of the code, so the code reads it.
// Only the terminal-facing `systemMessage` is translated: the `reason` /
// `additionalContext` texts go to the model, which already answers in the
// configured language, and translating a paragraph of method in every hook would
// be a second copy of every rule.
//
//   const { t } = require('./lang.cjs');
//   t('queue.next', { id: 12, text: '…' })
//
// Project settings win over user settings, matching Claude Code's own precedence.
// An unknown language falls back to English; a missing key falls back to the
// English string, never to an empty line.
'use strict';
const fs = require('fs');
const path = require('path');

const CODES = {
  english: 'en', hungarian: 'hu', magyar: 'hu',
};

const STRINGS = {
  'queue.next': {
    en: '[queue] next task: {id}{text}',
    hu: '[sor] következő feladat: {id}{text}',
  },
  'results.unrecorded': {
    en: '[results-guard] {n} unrecorded result(s)',
    hu: '[eredmény-őr] {n} rögzítetlen eredmény',
  },
  'precompact.written': {
    en: '[precompact-status] Status snapshot written to {file} (and latest.md beside it). Read it after the compaction if the summary is thin.',
    hu: '[precompact-status] Állapot-pillanatkép kiírva: {file} (mellette latest.md). Tömörítés után olvasd el, ha az összefoglaló vékony.',
  },
  'measurement.unwatched': {
    en: '[measurement-watch] unattended measurement with no watcher: {units}',
    hu: '[mérés-figyelő] felügyelet nélküli mérés figyelő nélkül: {units}',
  },
};

function readLang(file) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8')).language;
    return typeof v === 'string' ? v : '';
  } catch { return ''; }
}

// cwd: the hook event's `cwd` when the caller has it, else the process's.
function language(cwd) {
  const home = process.env.CLAUDE_CONFIG_DIR ||
    path.join(process.env.HOME || '/home/fp3', '.claude');
  const c = cwd || process.cwd();
  const raw = readLang(path.join(c, '.claude', 'settings.local.json')) ||
    readLang(path.join(c, '.claude', 'settings.json')) ||
    readLang(path.join(home, 'settings.local.json')) ||
    readLang(path.join(home, 'settings.json')) || 'English';
  return CODES[raw.trim().toLowerCase()] || 'en';
}

function t(key, params, cwd) {
  const s = STRINGS[key] || {};
  const tpl = s[language(cwd)] || s.en || key;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (params && k in params ? String(params[k]) : ''));
}

module.exports = { t, language, STRINGS };

if (require.main === module) {
  const [cmd, key, ...rest] = process.argv.slice(2);
  if (cmd === 'language') console.log(language());
  else if (cmd === 't' && key) console.log(t(key, Object.fromEntries(rest.map((a) => a.split('=')))));
  else { console.error('usage: lang.cjs language | t <key> [k=v ...]'); process.exit(1); }
}
