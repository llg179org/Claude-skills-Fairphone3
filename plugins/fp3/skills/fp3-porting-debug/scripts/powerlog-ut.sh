#!/bin/sh
# Log the power state on Ubuntu Touch, for comparison against the same
# quantities on postmarketOS. One line per sample, written and synced as it
# happens: a run that only flushes at the end loses everything if the phone
# resets, and this one is meant to be left alone overnight.
#
# Fields, in order:
#   iso_time uptime_s capacity status charge_type vbat_uV ibat_uA temp_dC
#   usb_online usb_imax_uA usb_vbus_uV usb_real_type charge_done chgr_status_reg
OUT=/home/phablet/ut-powerlog.txt
B=/sys/class/power_supply/battery
U=/sys/class/power_supply/usb
R=/sys/kernel/debug/regmap/spmi0-02/registers

rd() { cat "$1" 2>/dev/null | tr -d '\n' | tr ' ' '_'; [ -r "$1" ] || printf '?'; }

[ -f "$OUT" ] || printf '# iso_time uptime_s capacity status charge_type vbat_uV ibat_uA temp_dC usb_online usb_imax_uA usb_vbus_uV usb_real_type charge_done chgr_status_reg\n' > "$OUT"

while : ; do
    # BATTERY_CHARGER_STATUS_1 at 0x1006: the charger's own state machine,
    # which is what says whether a charge terminated. 9 bytes per line, so the
    # register index is the dd block number.
    reg=$(dd if=$R bs=9 skip=4102 count=1 2>/dev/null | cut -d' ' -f2)
    printf '%s %s %s %s %s %s %s %s %s %s %s %s %s %s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(cut -d. -f1 /proc/uptime)" \
        "$(rd $B/capacity)" "$(rd $B/status)" "$(rd $B/charge_type)" \
        "$(rd $B/voltage_now)" "$(rd $B/current_now)" "$(rd $B/temp)" \
        "$(rd $U/online)" "$(rd $U/current_max)" "$(rd $U/voltage_now)" \
        "$(rd $U/real_type)" "$(rd $B/charge_done)" "${reg:-?}" >> "$OUT"
    sync
    sleep 60
done
