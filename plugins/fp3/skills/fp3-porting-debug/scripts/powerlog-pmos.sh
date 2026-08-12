#!/bin/sh
# Log the power state on postmarketOS, in the same fields and the same order as
# the Ubuntu Touch logger, so the two files can be compared directly.
#
# ☠️ Percent is NOT comparable between the two: they run different fuel gauges.
# What compares is the integrated current and the terminal voltage, which is why
# both are logged at full precision.
OUT=/home/fp3/pmos-powerlog.txt
B=/sys/class/power_supply/pmi632-battery
U=/sys/class/power_supply/pmi632-charger
R=/sys/kernel/debug/regmap/0-02/registers

rd() { cat "$1" 2>/dev/null | tr -d '\n' | tr ' ' '_'; [ -r "$1" ] || printf '?'; }

[ -f "$OUT" ] || printf '# iso_time uptime_s capacity status charge_type vbat_uV ibat_uA temp_dC usb_online usb_imax_uA usb_vbus_uV usb_real_type charge_done chgr_status_reg\n' > "$OUT"

while : ; do
    reg=$(dd if=$R bs=9 skip=4102 count=1 2>/dev/null | cut -d' ' -f2)
    # No charge_done or real_type on this side; the columns are kept so the two
    # files line up, with '-' where the quantity does not exist here.
    printf '%s %s %s %s %s %s %s %s %s %s %s %s %s %s\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(cut -d. -f1 /proc/uptime)" \
        "$(rd $B/capacity)" "$(rd $B/status)" "$(rd $B/charge_type)" \
        "$(rd $B/voltage_now)" "$(rd $B/current_now)" "$(rd $B/temp)" \
        "$(rd $U/online)" "$(rd $U/current_max)" "$(rd $U/voltage_now)" \
        "-" "-" "${reg:-?}" >> "$OUT"
    sync
    sleep 60
done
