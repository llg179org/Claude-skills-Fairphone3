#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# FAST BATTERY DRAIN for the duty-cycle charger test.
# pmOS does NOT charge → there we drain the battery under full load until the capacity
# measured in TWRP drops to the target (65% by default).
#
# LOAD: `sha256sum /dev/zero` on all $(nproc) cores (pure CPU burn; heavier than `yes`
# because it has no I/O pauses). The torch LED is not exposed → this is the main consumer,
# + max display brightness.
#
# BASED ON THERMAL MEASUREMENT (2026-06-29):
#   - The CPU zones PLATEAU at ~76°C under full 8-core load (HW throttle) → SAFE.
#   - `pmi632-thermal` (the BATTERY-SIDE sensor, the real fire-risk indicator) stays at 37°C THROUGHOUT,
#     it does not even flinch at the CPU load.
#   → so the load can run CONTINUOUSLY; the guard:
#        primary = battery side (pmi632-thermal) abort BATT_MAX (45°C) — real safety
#        backstop= hottest CPU zone  abort CPU_MAX (86°C)
#   If it trips: STOP + cool down (batt<BATT_COOL AND cpu<CPU_COOL), then resume.
#
# usage: discharge.sh [target_cap=65] [burst_min=25] [batt_max=45] [cpu_max=86]
#   run it in the background:  ./discharge.sh 65 25 > discharge.log 2>&1 &
set -uo pipefail
cd "$(dirname "$0")"; source ./fp3-env.sh 2>/dev/null

TARGET="${1:-65}"      # drain down to this capacity (%)
BURST_MIN="${2:-25}"   # length of one pmOS load burst in minutes (then a TWRP measurement)
BATT_MAX="${3:-45}"    # °C: battery-side (pmi632-thermal) abort — the REAL safety threshold
CPU_MAX="${4:-86}"     # °C: hottest CPU zone backstop (plateau ~76, so it rarely trips)
BATT_COOL=41           # °C: battery side must cool back down to this
CPU_COOL=68            # °C: CPU must cool back down to this
GUARD_S=8              # thermal check interval under load
LOG=./discharge.log

SSH(){ sshpass -p "$FP3_PW" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
       -o ConnectTimeout=8 "fp3@$FP3_SSH_IP" "$@" 2>/dev/null; }
say(){ printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

pmos_up(){ ping -c1 -W2 "$FP3_SSH_IP" >/dev/null 2>&1 && SSH 'echo ok' 2>/dev/null | grep -q ok; }

ensure_pmos(){
  pmos_up && return 0
  say "pmOS not up → to-pmos.sh"
  ./to-pmos.sh >>"$LOG" 2>&1 || true
  local i; for i in $(seq 1 50); do pmos_up && { say "pmOS up"; return 0; }; sleep 4; done
  say "pmOS did NOT come up"; return 1
}

# °C integer: battery side (pmi632-thermal) and hottest CPU zone
batt_c(){ local m; m=$(SSH 'for z in /sys/class/thermal/thermal_zone*; do [ "$(cat $z/type)" = pmi632-thermal ] && cat $z/temp; done' 2>/dev/null); echo $(( ${m:-0}/1000 )); }
cpu_c(){  local m; m=$(SSH 'cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | sort -rn | head -1'); echo $(( ${m:-0}/1000 )); }

LOAD_PID=""
start_load(){
  say "load starting: sha256sum on every core + max display"
  # PERSISTENT host-side SSH: the remote 'wait' keeps the processes alive as long as this lives.
  sshpass -p "$FP3_PW" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
    -o ServerAliveInterval=15 -o ConnectTimeout=8 "fp3@$FP3_SSH_IP" \
    'for i in $(seq 1 $(nproc)); do sha256sum /dev/zero & done; wait' >/dev/null 2>&1 &
  LOAD_PID=$!
  SSH 'mb=$(cat /sys/class/backlight/1a94000.dsi.0/max_brightness 2>/dev/null); \
       echo '"$FP3_PW"' | sudo -S sh -c "echo ${mb:-255} > /sys/class/backlight/1a94000.dsi.0/brightness" 2>/dev/null' || true
}
stop_load(){ [ -n "$LOAD_PID" ] && kill "$LOAD_PID" 2>/dev/null; LOAD_PID=""
             SSH 'pkill -x sha256sum 2>/dev/null; pkill -x yes 2>/dev/null' >/dev/null 2>&1; }

run_burst(){
  start_load
  local end=$(( $(date +%s) + BURST_MIN*60 )) bt ct last_log=0 now
  while now=$(date +%s); [ "$now" -lt "$end" ]; do
    bt=$(batt_c); ct=$(cpu_c)
    if [ $((now-last_log)) -ge 30 ]; then
      say "  load: batt=${bt}°C cpu=${ct}°C  (target ${TARGET}%, $(( (end-now)/60 ))min left)"; last_log=$now
    fi
    if [ "$bt" -ge "$BATT_MAX" ] || [ "$ct" -ge "$CPU_MAX" ]; then
      say "  ⚠️ abort: batt=${bt}°C(max ${BATT_MAX}) cpu=${ct}°C(max ${CPU_MAX}) → STOP+cool-down"
      stop_load
      while :; do sleep 10; bt=$(batt_c); ct=$(cpu_c); say "    cooling: batt=${bt}°C cpu=${ct}°C"
        [ "$bt" -le "$BATT_COOL" ] && [ "$ct" -le "$CPU_COOL" ] && break; done
      start_load; last_log=0
    fi
    sleep "$GUARD_S"
  done
  stop_load
}

twrp_cap(){
  ./to-twrp.sh >>"$LOG" 2>&1 || true
  local i; for i in $(seq 1 40); do adb get-state 2>/dev/null | grep -q recovery && break; sleep 3; done
  local cap temp st
  cap=$(adb shell 'cat /sys/class/power_supply/battery/capacity' 2>/dev/null | tr -d '\r')
  temp=$(adb shell 'cat /sys/class/power_supply/battery/temp' 2>/dev/null | tr -d '\r')
  st=$(adb shell 'cat /sys/class/power_supply/battery/status' 2>/dev/null | tr -d '\r')
  echo "${cap:-?}|${temp:-?}|${st:-?}"
}

say "=== DISCHARGE start: target=${TARGET}% burst=${BURST_MIN}min battMax=${BATT_MAX}°C cpuMax=${CPU_MAX}°C ==="
cyc=0
while :; do
  cyc=$((cyc+1))
  ensure_pmos || { say "pmOS failure, stopping (phone is probably in fastboot/TWRP)"; exit 1; }
  say "--- burst $cyc (${BURST_MIN}min load) ---"
  run_burst
  IFS='|' read -r cap temp st < <(twrp_cap)
  say "--- measurement after burst $cyc: cap=${cap}% temp=$( [ "$temp" != "?" ] && echo "$((temp/10))°C" || echo "?") status=$st ---"
  if [ "$cap" != "?" ] && [ "$cap" -le "$TARGET" ] 2>/dev/null; then
    say "✅ TARGET REACHED: ${cap}% ≤ ${TARGET}% — phone in TWRP (charging/cooling). The charger test can start."
    exit 0
  fi
  say "still going: ${cap}% > ${TARGET}% → another burst (back to pmOS)"
done
