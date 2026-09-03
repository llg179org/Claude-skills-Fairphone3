#!/usr/bin/env node
// PreToolUse hook: say the trap out loud when a command is about to touch
// something whose failure mode costs a human at the phone.
//
// Why a hook rather than a document. The knowledge that would have prevented
// the 2026-08-16 boot hang existed in two places and neither one loaded in
// time: docs/deploy/README.md, which is keyed to the *task* "deploying" while
// the work in hand was "running an experiment", and the /fp3-kernel-test
// skill, which has to be invoked before it can warn about anything. Both are
// pull mechanisms - they need you to already know you need them, which is
// exactly what is missing at the moment they would help.
//
// This keys on the *target* instead, so it fires without anybody knowing it
// should. Keep the table short: a warning that fires on ordinary work is
// noise, and noise is how a real warning gets skimmed. Every line names a
// command, never an answer - the state belongs in the check, not here.

const RULES = [
  {
    // The one that cost the recovery: on disk, read before anything you can
    // talk to exists, and both remote channels need userspace.
    when: /extlinux\.conf|\/boot\/(vmlinuz|.*\.dtb)|cmdline/i,
    say: [
      'Boot config: a change here repeats on every boot and there is no console.',
      'Put anything risky on the NON-default label, and check the net first:',
      '  fp3-selftest --only boot-fallback',
      'Procedure: fp3-pmaports/docs/deploy/README.md',
    ],
  },
  {
    when: /fastboot\s+(flash|erase)|pmb(ootstrap)?\s+flasher/i,
    say: [
      'Flashing: confirm slot-retry-count >= 1 first, and never',
      '`pmb flasher flash_kernel` on pmOS - it overwrites lk2nd.',
      'Procedure: fp3-pmaports/docs/deploy/README.md',
    ],
  },
  {
    when: /USBIN_SUSPEND|input_suspend|power_supply\/.*charger\/status/i,
    say: [
      'The USB-input suspend bit lives in the PMIC and survives a warm reboot.',
      'Never reboot while it is set: restore it first with',
      '  echo Charging > /sys/class/power_supply/pmi632-charger/status',
    ],
  },
  {
    when: /apk\s+(add|del)|apk-tools/i,
    say: [
      'apk resolves the whole `world`, not just this package, and can carry out',
      'deletions left over from an earlier interrupted upgrade. Run it with',
      '--simulate first and read the output for `Purging`.',
      'apk add linux-fp3 also regenerates extlinux.conf: re-arm the fallback',
      'entry, panic=10 and the menu timeout AFTER the install.',
    ],
  },
];

let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  // Match on whatever names the target, whichever tool is being used: a Bash
  // command line, or the path an Edit/Write is about to land on. Keying on the
  // command alone would miss editing extlinux.conf through the file tools.
  let cmd = '';
  try {
    const input = JSON.parse(raw || '{}');
    const ti = input.tool_input ?? {};
    cmd = [ti.command, ti.file_path, ti.path, ti.notebook_path]
      .filter((v) => typeof v === 'string')
      .join('\n');
  } catch {
    process.exit(0);
  }
  if (!cmd) process.exit(0);

  const hits = RULES.filter((r) => r.when.test(cmd));
  if (!hits.length) process.exit(0);

  const lines = hits.flatMap((h) => ['☠️ ' + h.say[0], ...h.say.slice(1).map((l) => '   ' + l)]);
  // additionalContext reaches the model; it does not block the call.
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: lines.join('\n'),
      },
    })
  );
  process.exit(0);
});
