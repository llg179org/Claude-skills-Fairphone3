#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-or-later
# setup-nopasswd.sh — install a NOPASSWD sudoers drop-in for the pmOS user,
# so the device password (which on this device IS the screen-unlock PIN) never
# has to be typed, piped or held in a session again.
#
# WHY THIS EXISTS. Two different gates ask for credentials on this device and
# only one of them is solved by an SSH key:
#
#   ssh login  -> key auth (`fp3-link install-key`). Already passwordless.
#   sudo       -> PAM, locally, on the phone. It neither knows nor cares that
#                 the session arrived over a key, so a key CANNOT replace it.
#
# The result was a recurring stall: every fresh window (and every context
# compaction) lost the password and privileged work stopped dead.
#
# ☠️ WHAT IT COSTS. After this, whoever holds the host's SSH private key gets
# root on the phone rather than an unprivileged shell. If that key has no
# passphrase — check with `grep -q ENCRYPTED ~/.ssh/id_ed25519` — the phone's
# root is exactly as protected as that one file. Acceptable on a disposable
# dev device on a USB-only link; decide before running it, not after.
#
# ☠️ RUN IT ON A TTY. sudo must prompt for the password itself: passing it in
# argv would put it in the command line of every privileged process, where a
# world-readable `ps -o args` picks it up. A non-interactive runner (including
# Claude Code's `!` prefix) allocates no pty and this fails with
# "sudo: A terminal is required to authenticate" — that is the guard working.
#
#   scp setup-nopasswd.sh fp3@$FP3_DEV_IP:/tmp/
#   ssh -t fp3@$FP3_DEV_IP /tmp/setup-nopasswd.sh      # from a real terminal
#
# To undo: sudo rm /etc/sudoers.d/50-fp3-nopasswd
set -eu

USER_NAME=${1:-fp3}
F=/etc/sudoers.d/50-fp3-nopasswd
# ☠️ The temporary name deliberately contains a dot: sudo's includedir skips
# such files, so a malformed drop-in can never be picked up mid-write. Writing
# straight to $F and validating afterwards would leave a window in which a
# syntax error locks every user out of sudo.
T=$F.tmp

sudo sh -c '
set -eu
grep -qE "^[@#]includedir[[:space:]]+/etc/sudoers\.d" /etc/sudoers || {
	echo "FAIL: /etc/sudoers has no includedir for /etc/sudoers.d - refusing"
	exit 1
}
printf "%s ALL=(ALL) NOPASSWD: ALL\n" "'"$USER_NAME"'" > "'"$T"'"
visudo -cf "'"$T"'"
chmod 440 "'"$T"'"
mv "'"$T"'" "'"$F"'"
echo "installed: '"$F"'"
'

# The check that matters: not that the file exists, but that sudo now grants
# root without asking. -n makes sudo fail rather than prompt.
echo "--- verify ---"
if sudo -n true 2>/dev/null; then
	echo "OK: sudo now works without a password"
else
	echo "STILL ASKS FOR A PASSWORD - inspect /etc/sudoers and the drop-in"
	exit 1
fi
