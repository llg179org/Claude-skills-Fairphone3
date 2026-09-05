#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# fp3-measure — the single entry point for anything that measures the phone.
#
#   fp3-measure run   <name> <minutes> -- <command…>   acquire, run, release
#   fp3-measure hold  <name> <minutes>                 acquire and return
#   fp3-measure free                                   release
#   fp3-measure status                                 who holds it, and until when
#
# WHY THIS EXISTS, and why the lock is not on this machine
# =======================================================
# The 2026-09-02 replication night was destroyed by a host-side watcher that
# ssh'd into the phone every 300 s — fifteen logins inside a 75-minute leg, into
# a run measuring how long the AP stays asleep. Three separate defences had been
# built that morning and every one of them would have fired; none did, because
# they all live inside one Claude session and the watcher lived outside it.
#
# ☠️ So a lock in ~/.claude, or anywhere on one host, cannot close this. The
# only thing every disturber shares is THE PHONE. The lock therefore lives on
# the device, and the ssh wrappers check it in the SAME connection they were
# going to make anyway — the check costs no extra login.
#
# ☠️ It is a lock, not a guarantee. A raw `ssh` that bypasses the wrappers is
# not stopped by anything here. This closes the paths people actually use.
set -u

LOCK='$HOME/.fp3-measure.lock'           # ☠️ Resolved ON THE DEVICE, and in the
                                         # home directory on purpose: /var/lock
                                         # is on a READ-ONLY rootfs under Ubuntu
                                         # Touch (measured 2026-09-05), and /run
                                         # is wiped by the reboots a multi-boot
                                         # run makes between its legs. The home
                                         # is writable on both OSes and persists.
WRAP="${FP3_MEASURE_WRAPPER:-fp3-ssh}"   # fp3-ssh (pmOS) or ut-ssh (UT)

usage() { sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

remote() { FP3_MEASURE_BYPASS=1 "$WRAP" "$@"; }

now() { date +%s; }

cmd=${1:-}; shift 2>/dev/null || true

case "$cmd" in
status)
    # ☠️ `|| true` runs ON THE DEVICE. Without it a missing lock file - the free
    # state, i.e. the common case - makes cat exit non-zero, the wrapper returns
    # that, and this reported "cannot reach the device" about a phone answering
    # fine. A status tool that calls healthy "unreachable" is worse than none.
    out=$(remote "cat $LOCK 2>/dev/null || true" 2>/dev/null) || {
        echo "fp3-measure: cannot reach the device to read the lock" >&2; exit 3; }
    if [ -z "$out" ]; then echo "free"; exit 0; fi
    IFS='|' read -r who what started expires <<<"$out"
    left=$(( expires - $(now) ))
    if [ "$left" -le 0 ]; then
        echo "stale lock (expired $(( -left ))s ago): $who — $what"
        echo "  it no longer blocks; 'fp3-measure free' removes it"
        exit 0
    fi
    echo "HELD by $who — $what"
    echo "  since $(date -d "@$started" '+%F %T'), expires in ${left}s"
    exit 1
    ;;
hold|run)
    name=${1:-}; mins=${2:-}
    [ -n "$name" ] && [ -n "$mins" ] || usage
    case "$mins" in ''|*[!0-9]*) echo "minutes must be a number" >&2; exit 2;; esac
    shift 2
    if [ "$cmd" = run ]; then
        [ "${1:-}" = "--" ] || usage
        shift
        [ "$#" -gt 0 ] || usage
    fi
    exp=$(( $(now) + mins * 60 ))
    who="${USER:-unknown}@$(hostname -s 2>/dev/null || echo host)"
    # ☠️ Acquire atomically ON THE DEVICE, and refuse only to a lock that has
    # not expired — a crashed run must not block the phone forever.
    got=$(remote "
        L=$LOCK
        if [ -r \$L ]; then
            e=\$(cut -d'|' -f4 \$L 2>/dev/null)
            case \"\$e\" in ''|*[!0-9]*) e=0;; esac
            if [ \"\$e\" -gt $(now) ]; then cat \$L; exit 0; fi
        fi
        mkdir -p \$(dirname \$L) 2>/dev/null
        printf '%s|%s|%s|%s\n' '$who' '$name' '$(now)' '$exp' > \$L && echo ACQUIRED
    " 2>/dev/null) || { echo "fp3-measure: cannot reach the device" >&2; exit 3; }
    if [ "$got" != ACQUIRED ]; then
        IFS='|' read -r w2 n2 s2 e2 <<<"$got"
        echo "fp3-measure: REFUSED — the phone is held by $w2 for '$n2'" >&2
        echo "  since $(date -d "@$s2" '+%F %T'), for another $(( e2 - $(now) ))s" >&2
        exit 1
    fi
    echo "fp3-measure: holding '$name' for ${mins}m (expires $(date -d "@$exp" '+%T'))"
    [ "$cmd" = hold ] && exit 0
    trap 'remote "rm -f $LOCK" >/dev/null 2>&1' EXIT INT TERM
    FP3_MEASURE_BYPASS=1 "$@"
    rc=$?
    echo "fp3-measure: '$name' finished (rc=$rc), releasing"
    exit $rc
    ;;
free)
    remote "rm -f $LOCK" >/dev/null 2>&1 && echo "released" || {
        echo "fp3-measure: cannot reach the device" >&2; exit 3; }
    ;;
*) usage ;;
esac
