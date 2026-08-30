#!/usr/bin/env node
// AI-generated (Claude Opus 5) under the direction of Lajosházi, László Gergely.
//
// Keep unattended device measurements and their watcher tasks paired.
//
// The failure this exists to stop, observed repeatedly: a measurement is started
// on the phone with `systemd-run --unit=X`, and then either (a) no background
// watcher is started, so the user has to keep asking "is it done yet?", or
// (b) the measurement is superseded and stopped, but its watcher keeps running
// and later reports on an aborted run as though it were a result.
//
// Prose in a skill did not fix this - the rule was already written down. So this
// hook tracks the pairing mechanically and says something at the moment it is
// wrong, not afterwards.
//
// State: $CLAUDE_STATE_DIR or ~/.claude/.state/fp3-measurements.json — per user,
// never inside the plugin, so a checkout stays clean.
'use strict';
const fs = require('fs');
const path = require('path');

const STATE_DIR = path.join(process.env.HOME || '/home/fp3', '.claude', '.state');
const STATE = path.join(STATE_DIR, 'fp3-measurements.json');
const MAX_AGE_MS = 6 * 60 * 60 * 1000; // forget runs older than six hours

function read() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; }
}
function write(s) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE, JSON.stringify(s, null, 1));
  } catch { /* never let bookkeeping break the session */ }
}
function prune(s) {
  const now = Date.now();
  for (const k of Object.keys(s)) {
    if (!s[k] || now - (s[k].started || 0) > MAX_AGE_MS || s[k].done) delete s[k];
  }
  return s;
}
function out(msg, event) {
  if (!msg) return;
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: event, additionalContext: msg },
  }));
}

let input = '';
process.stdin.on('data', (d) => (input += d));
process.stdin.on('end', () => {
  let ev;
  try { ev = JSON.parse(input); } catch { process.exit(0); }
  const event = ev.hook_event_name;
  const state = prune(read());

  if (event === 'PostToolUse' && ev.tool_name === 'Bash') {
    // ☠️ STRIP EVERYTHING THAT IS *TEXT ABOUT* A COMMAND BEFORE MATCHING.
    // Two false positives in the first hour, both from this hook's own paperwork:
    // a `cat > file <<EOF ... systemd-run --unit=X ... EOF` writing the rule
    // down, and a `git commit -m "...systemd-run --unit=..."` describing it.
    // Prose that mentions a launch is not a launch. Here-documents and -m
    // message arguments are therefore blanked first, and placeholder unit names
    // are ignored. Validating the checker's POSITIVE is what caught both, each
    // time within one tool call of installing the "fix".
    const cmd = String(ev.tool_input?.command || '')
      .replace(/<<-?\s*'?"?([A-Za-z_][A-Za-z0-9_]*)'?"?[\s\S]*?^\1$/gm, ' <heredoc> ')
      .replace(/-m\s+'[\s\S]*?'/g, ' -m <msg> ')
      .replace(/-m\s+"[\s\S]*?"/g, ' -m <msg> ');
    const PLACEHOLDER = /^(x|y|z|n|name|unit|foo|bar|test|example|abc|def)$/i;
    const bg = ev.tool_input?.run_in_background === true;
    const notes = [];

    // 1. a measurement being launched on the device
    for (const m of cmd.matchAll(/systemd-run\s+[^|;&]*?--unit=([A-Za-z0-9_.@-]+)/g)) {
      const unit = m[1];
      if (PLACEHOLDER.test(unit)) continue;   // documentation, not a run
      if (!state[unit]) state[unit] = { started: Date.now(), watcher: false };
    }

    // 2. a background watcher naming a unit we know about
    if (bg) {
      for (const unit of Object.keys(state)) {
        if (cmd.includes(unit)) state[unit].watcher = true;
      }
    }

    // 3. a measurement being stopped or superseded
    for (const m of cmd.matchAll(/systemctl\s+stop\s+([A-Za-z0-9_.@-]+)/g)) {
      const unit = m[1];
      if (state[unit]) {
        if (state[unit].watcher && !state[unit].warnedStale) {
          state[unit].warnedStale = true;
          notes.push(
            `☠️ You just stopped the measurement \`${unit}\`, and it still has a background ` +
            `watcher task waiting on it. Stop that watcher too (TaskStop), or it will later ` +
            `report on an aborted run as if it were a result.`
          );
        }
        state[unit].done = true;
      }
    }

    // 4. a launched measurement with no watcher yet
    const orphans = Object.keys(state).filter(
      (u) => !state[u].watcher && !state[u].done && !state[u].warnedNoWatcher
    );
    if (orphans.length && !bg) {
      for (const u of orphans) state[u].warnedNoWatcher = true;
      notes.push(
        `Unattended measurement running on the device: ${orphans.map((u) => `\`${u}\``).join(', ')}. ` +
        `Start a background watcher for it in this same response, so the result arrives on its own ` +
        `and the user does not have to ask whether it finished — e.g. Bash with run_in_background: ` +
        `\`until ! fp3-ssh 'systemctl is-active ${orphans[0]}' | grep -q active; do sleep 60; done; <report>\`. ` +
        `Also tell the user roughly when it will finish.`
      );
    }

    write(state);
    out(notes.join('\n\n'), 'PostToolUse');
    process.exit(0);
  }

  if (event === 'Stop') {
    const pending = Object.keys(state).filter(
      (u) => !state[u].watcher && !state[u].done && !state[u].blockedOnce
    );
    if (pending.length) {
      for (const u of pending) state[u].blockedOnce = true; // block at most once per unit
      write(state);
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason:
          `A measurement is still running unattended on the phone (${pending.map((u) => `\`${u}\``).join(', ')}) ` +
          `with no background watcher. Before ending the turn, start one with Bash ` +
          `run_in_background so its result arrives without the user having to ask, and tell them the ETA. ` +
          `If the run is no longer wanted, stop it on the device instead.`,
      }));
      process.exit(0);
    }
    write(state);
    process.exit(0);
  }

  process.exit(0);
});
