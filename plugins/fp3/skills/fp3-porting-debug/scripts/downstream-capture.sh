#!/bin/sh
# SPDX-License-Identifier: GPL-2.0-or-later
# RUN THIS on the WORKING downstream system (Ubuntu Touch OR stock Android),
# as root (UT: `sudo`; Android: `adb shell su`). Send the output back.
OUT=/tmp/fp3-slim-trace.txt
{
echo "===== UNAME ====="; uname -a
echo "===== DMESG: slim/ngd/adsp/qmi/q6/avs/bam/capability ====="
dmesg | grep -iE "slim|ngd|adsp|qmi|q6|avs|bam|capability|master|laddr|framer|pd_?up|servreg|sysmon" 
echo "===== CLK SUMMARY (enabled clocks; this is the most important part) ====="
cat /sys/kernel/debug/clk/clk_summary 2>/dev/null
echo "===== REGULATOR SUMMARY ====="
cat /sys/kernel/debug/regulator/regulator_summary 2>/dev/null
echo "===== SLIMBUS sysfs ====="
ls -l /sys/bus/slimbus/devices/ 2>/dev/null
} > "$OUT" 2>&1
echo "DONE -> $OUT  (send this file back)"
