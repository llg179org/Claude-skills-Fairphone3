#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# UT ADSP SSR-recovery differential trace (plan: lovely-dazzling-rain).
# On the PROVEN-working UT (slot_a, halium-10.0 4.9.218) we stop+restart the ADSP
# via SSR; the fresh ADSP's framer-recovery sequence is the working counterpart of the
# pmOS cold boot. Whatever the recovery switches on beyond QMI (clk diff,
# smp2p/smem, HAL ioctl) is a candidate for the trigger missing on pmOS.
#
# Run FROM THE HOST, with the phone booted into UT, with LIVE adb (adb get-state==device).
# NEVER `sudo adb`! (it breaks the UT adb key) — plain adb + on-device sudo.
# usage: ut-ssr-trace.sh [outdir]
#   env: UT_PW=<sudo password>  SSR_NODE=<trigger node override>  SSR_CMD=<restart|crash>

# Config lives in fp3-env.sh; every value there has a documented default.
# Resolve symlinks first: these scripts are commonly installed as symlinks in
# /usr/local/bin, where a bare $0 would look for fp3-env.sh next to the symlink.
_self="$(readlink -f "$0")"
for _d in "$(dirname "$_self")" "$(dirname "$_self")/.." "$(dirname "$_self")/../.." ; do
    [ -r "$_d/fp3-env.sh" ] && . "$_d/fp3-env.sh" && break
done

set -uo pipefail
OUT=${1:-$FP3_PMOS/ut-ssr-$(date +%Y%m%d-%H%M)}
mkdir -p "$OUT"
echo "OUT=$OUT"

# ---------- [0] adb + sudo-password autodetect ----------
adb wait-for-device
PW=""
for p in "${UT_PW:-}" phablet "$FP3_PW"; do
  [ -n "$p" ] || continue
  if adb shell "echo $p | sudo -S whoami" 2>/dev/null | grep -q root; then PW=$p; break; fi
done
[ -n "$PW" ] || { echo "ERROR: neither 'phablet' nor '"$FP3_PW"' works as the sudo password (supply it via the UT_PW env var)"; exit 1; }
S(){ adb shell "echo $PW | sudo -S sh -c '$1'" 2>/dev/null; }
S 'uname -r; date' | tee "$OUT/meta.txt"

# ---------- [0b] SSR-trigger discovery (NO guessing) ----------
echo "=== [0b] SSR-trigger node discovery ==="
S 'ls -d /sys/kernel/debug/msm_subsys 2>/dev/null && ls /sys/kernel/debug/msm_subsys/;
   ls -d /sys/bus/msm_subsys/devices/*/ 2>/dev/null;
   for d in /sys/bus/msm_subsys/devices/*/; do echo -n "$d name="; cat $d/name 2>/dev/null | tr -d "\n"; echo -n " restart_level="; cat $d/restart_level 2>/dev/null; done;
   ls /sys/kernel/boot_adsp/ 2>/dev/null; ls -d /sys/kernel/debug/subsys* 2>/dev/null' | tee "$OUT/ssr-inventory.txt"

NODE="${SSR_NODE:-}"
if [ -z "$NODE" ] && S 'test -e /sys/kernel/debug/msm_subsys/adsp && echo YES' | grep -q YES; then
  NODE=/sys/kernel/debug/msm_subsys/adsp
fi
if [ -z "$NODE" ] && S 'test -e /sys/kernel/boot_adsp/boot && echo YES' | grep -q YES; then
  # adsp-loader (qdsp6v2): echo 0 = subsystem_put (graceful shutdown), echo 1 = subsystem_get (powerup)
  NODE=/sys/kernel/boot_adsp/boot
fi
if [ -z "$NODE" ]; then
  echo "ERROR: no known SSR-trigger node. Check $OUT/ssr-inventory.txt and supply it in the SSR_NODE env var."
  exit 3
fi
echo "SSR trigger: $NODE  (cmd: ${SSR_CMD:-restart})" | tee "$OUT/trigger.txt"

# ensure restart_level=RELATED on the adsp subsys (SYSTEM = the WHOLE phone would reboot!)
ADSPDIR=$(S 'for d in /sys/bus/msm_subsys/devices/*/; do [ "$(cat $d/name 2>/dev/null)" = adsp ] && echo $d; done' | tr -d '\r' | head -1)
if [ -n "$ADSPDIR" ]; then
  LVL=$(S "cat ${ADSPDIR}restart_level" | tr -d '\r')
  echo "adsp restart_level=$LVL ($ADSPDIR)" | tee -a "$OUT/trigger.txt"
  case "$LVL" in
    *RELATED*) : ;;
    *) echo "  -> setting it to RELATED (SSR, not a full reboot)"; S "echo RELATED > ${ADSPDIR}restart_level"; S "cat ${ADSPDIR}restart_level" | tee -a "$OUT/trigger.txt";;
  esac
fi

# ---------- [1] T0 baseline (framer UP) ----------
echo "=== [1] T0 baseline ==="
S 'cat /sys/kernel/debug/clk/clk_summary' > "$OUT/clk_T0.txt"; wc -l "$OUT/clk_T0.txt"
S 'ls /sys/bus/slimbus/devices/' | tr -d '\r' > "$OUT/slim-devices-T0.txt"; cat "$OUT/slim-devices-T0.txt"
S 'cat /sys/kernel/debug/regulator/regulator_summary 2>/dev/null' > "$OUT/regulator_T0.txt"
S 'ps -A 2>/dev/null || ps' > "$OUT/ps-T0.txt"
# ipc_logging DRAIN: reading "log" empties the buffer -> the T1 read = clean recovery delta
echo "--- ipc_logging drain (T0, saved as pre) ---"
S 'for d in /sys/kernel/debug/ipc_logging/*/; do n=$(basename $d); case "$n" in
     *slim*|*ngd*|*qmi*|*sps*|*bam*|*lpass*|*adsp*|*pdr*|*servreg*|*apr*|*smd*|*smem*|*smsm*|*smp2p*|*ipc_rtr*)
       echo "########## $n ##########"; timeout 5 cat "$d/log" 2>/dev/null ;; esac; done' > "$OUT/ipc-pre-drain.txt"
wc -l "$OUT/ipc-pre-drain.txt"
S 'echo "===== SSR-TRACE T0 marker =====" > /dev/kmsg'

# ---------- [1b] optional strace on the audio stack (userspace-path discovery) ----------
if S 'command -v strace' | grep -q strace; then
  APIDS=$(S 'ps -A 2>/dev/null | grep -iE "audio|pulse|hal" | grep -v grep' | awk '{print $2}' | tr '\n' ' ')
  echo "strace targets: $APIDS" | tee "$OUT/strace-pids.txt"
  for pid in $APIDS; do
    adb shell "echo $PW | sudo -S strace -f -tt -e trace=ioctl,openat,open,write -p $pid" > "$OUT/strace-$pid.txt" 2>&1 &
  done
  STRACE_BG=$(jobs -p)
else
  echo "(no strace on UT — skipped; ipc_logging+dmesg covers the kernel side)"
  STRACE_BG=""
fi

# ---------- [2] triggering the SSR ----------
if [ "$NODE" = "/sys/kernel/boot_adsp/boot" ]; then
  # two-phase graceful cycle: 0 (shutdown) -> state OFFLINE -> 1 (powerup)
  echo "=== [2] ADSP graceful down->up: echo 0 > boot; wait for OFFLINE; echo 1 > boot ==="
  S "echo 0 > $NODE"
  DOWN=0
  for i in $(seq 1 15); do
    st=$(S "cat ${ADSPDIR:-/sys/bus/msm_subsys/devices/subsys2/}state" | tr -d '\r')
    echo "  adsp state=$st"
    [ "$st" = OFFLINE ] && { DOWN=1; break; }
    sleep 2
  done
  if [ "$DOWN" != 1 ]; then
    echo "WARN: adsp did not go OFFLINE within 30s (a client refcount may be holding it) — powering it back up (echo 1) and exiting."
    S "echo 1 > $NODE"; exit 5
  fi
  S "echo 1 > $NODE"
else
  echo "=== [2] ADSP SSR trigger: ${SSR_CMD:-restart} > $NODE ==="
  S "echo ${SSR_CMD:-restart} > $NODE" || { echo "ERROR: writing the trigger failed"; exit 4; }
fi

# ---------- [3] waiting for recovery (framer back up) ----------
echo "=== [3] waiting for recovery (max 120s) ==="
UP=0
for i in $(seq 1 60); do
  sleep 2
  DM=$(S 'dmesg | sed -n "/SSR-TRACE T0 marker/,\$p"')
  if echo "$DM" | grep -qiE "Rcvd master capability|adsp.*(is now up|powerup)"; then
    if echo "$DM" | grep -qi "Rcvd master capability"; then UP=1; break; fi
  fi
done
S 'dmesg | sed -n "/SSR-TRACE T0 marker/,$p"' > "$OUT/dmesg-recovery.txt"
wc -l "$OUT/dmesg-recovery.txt"
[ "$UP" = 1 ] && echo "FRAMER RECOVERY OK (Rcvd master capability)" || echo "WARN: no framer-recovery signal within 120s — check $OUT/dmesg-recovery.txt"

# stop the straces
[ -n "$STRACE_BG" ] && kill $STRACE_BG 2>/dev/null

# ---------- [4] T1 capture ----------
echo "=== [4] T1 capture ==="
S 'cat /sys/kernel/debug/clk/clk_summary' > "$OUT/clk_T1.txt"
S 'ls /sys/bus/slimbus/devices/' | tr -d '\r' > "$OUT/slim-devices-T1.txt"; cat "$OUT/slim-devices-T1.txt"
S 'cat /sys/kernel/debug/regulator/regulator_summary 2>/dev/null' > "$OUT/regulator_T1.txt"
# ipc_logging: after the T0 drain this is the CLEAN recovery sequence
S 'for d in /sys/kernel/debug/ipc_logging/*/; do n=$(basename $d); case "$n" in
     *slim*|*ngd*|*qmi*|*sps*|*bam*|*lpass*|*adsp*|*pdr*|*servreg*|*apr*|*smd*|*smem*|*smsm*|*smp2p*|*ipc_rtr*)
       echo "########## $n ##########"; timeout 5 cat "$d/log" 2>/dev/null ;; esac; done' > "$OUT/ipc-recovery.txt"
wc -l "$OUT/ipc-recovery.txt"

# ---------- [5] golden NGD regdump (0xc141000 — SAFE per the guardrail) ----------
echo "=== [5] golden NGD regdump (framer-up state) ==="
adb push /dev/stdin /data/local/tmp/ngddump.py >/dev/null 2>&1 <<'PY' || true
import mmap,os,struct
fd=os.open("/dev/mem",os.O_RDONLY|os.O_SYNC)
base=0xc141000
m=mmap.mmap(fd,0x1000,mmap.MAP_SHARED,mmap.PROT_READ,offset=base)
for name,o in [("CFG",0x0),("STATUS",0x4),("RX_MSGQ_CFG",0x10),("INT_EN",0x10),("INT_STAT",0x14),("INT_CLR",0x18)]:
    v=struct.unpack("<I",m[o:o+4])[0]; print("NGD1 +0x%04x %-12s = 0x%08x"%(o,name,v))
m.close(); os.close(fd)
PY
S 'python3 /data/local/tmp/ngddump.py 2>&1 || python /data/local/tmp/ngddump.py 2>&1' | tee "$OUT/ngd-golden-regs.txt"

# ---------- [6] diffs ----------
echo "=== [6] clk_summary T0<->T1 diff (what toggled during recovery) ==="
diff -u "$OUT/clk_T0.txt" "$OUT/clk_T1.txt" > "$OUT/clk-diff.txt" || true
wc -l "$OUT/clk-diff.txt"; grep -E "^[+-]" "$OUT/clk-diff.txt" | grep -viE "^[+-]{3}" | head -60
echo "=== slim-devices T0<->T1 ==="
diff -u "$OUT/slim-devices-T0.txt" "$OUT/slim-devices-T1.txt" || echo "(identical — codec re-enumerated)"
echo "=== DONE -> $OUT ==="
