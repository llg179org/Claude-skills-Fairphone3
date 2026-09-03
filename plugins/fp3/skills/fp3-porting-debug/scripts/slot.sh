#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# A/B slot retry-count handling (in fastboot mode!).
# usage: slot.sh get | set [a|b] | active [a|b]
# Note: on this FP3 aboot `set_active` does NOT always reset the
# retry-count to 7. The REAL reset of the retry-count is a SUCCESSFUL boot (qbootctl-openrc
# mark_boot_successful in pmOS). Every failed boot is -1; at 0 the slot is unbootable.
set -uo pipefail
source "$(dirname "$0")/fp3-env.sh"
cmd=${1:-get}
case "$cmd" in
  get)
    have_fastboot || { echo "NOT in fastboot mode (fastboot required)."; exit 1; }
    for v in current-slot slot-count \
             slot-retry-count:a slot-retry-count:b \
             slot-successful:a slot-successful:b \
             slot-unbootable:a slot-unbootable:b \
             slot-active:a slot-active:b; do
      printf '%-22s ' "$v"; fb getvar "$v" 2>&1 | head -1
    done
    ;;
  set|active)
    s=${2:-a}
    have_fastboot || { echo "NOT in fastboot mode."; exit 1; }
    log "set_active $s"
    fb set_active "$s" 2>&1 | tail -2
    "$0" get | grep -E "current-slot|retry-count:$s|active:$s"
    ;;
  *) echo "usage: $0 get | set [a|b] | active [a|b]"; exit 2;;
esac
