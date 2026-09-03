# FP3 pmOS bring-up toolkit

> ⚠️ **AI-generated.** This page — and the code, device tree and tooling it
> describes — was written by Claude (Opus 5) working under the direction of
> Lajosházi, László Gergely, who reviewed every change and made or reviewed
> every measurement it rests on. Kernel commits carry `Co-authored-by: Claude`;
> anything prepared for the LKML carries `Assisted-by:` instead and never a
> `Signed-off-by` from the assistant, since only a human can certify the DCO.

> Full, English index of every script here: **[INDEX.md](INDEX.md)**.
> Single-use reverse-engineering artifacts now live in `archive/`.

Typical command sequences as scripts (do not retype them). Everything on `/mnt/1TB`.
Source knowledge: `../references/archive/pmos-bringup-log.md` and `../references/archive/hw-facts.md`.

| script | what it does | mode |
|---|---|---|
| `fp3-env.sh` | shared env (paths, serial, partitions, helpers) — the others source it | — |
| `slot.sh get\|set [a\|b]` | A/B retry-count / slot query and set | fastboot |
| `boot-watch.sh [from_fastboot\|from_recovery] [s]` | reboot + outcome (USB-net=booted / back-to-fastboot=failed); waits for a log marker | in background |
| `flash-pmos.sh [full\|vbmeta\|lk2nd\|rootfs]` | pmOS flash; **full = vbmeta(disable)+lk2nd+rootfs+reboot** | fastboot |
| `twrp.sh flash-b\|flash-a` | TWRP onto boot_b (recommended, preserves lk2nd) or onto boot_a | fastboot |
| `twrp-dd.sh <img> <part> [raw\|sparse]` | image onto a partition via TWRP-adb (fastboot boot is forbidden!) | TWRP |
| `diag.sh` | non-destructive diag: boot_a/b contents, pstore, userdata fs, vbmeta | TWRP |
| `sd-fsck.sh phone [mmcblk1p1]\|host /dev/sdX1` | SD debug-log dirty-bit clearing (umount+fsck) | TWRP/host |
| `to-twrp.sh` | **IDLE→CHARGING**: pmOS→bootloader→TWRP(boot_b)+set_active b+reboot; TWRP charges | pmOS/fastboot |
| `to-pmos.sh` | back: set_active a→lk2nd(boot_a)→pmOS | TWRP/fastboot |
| `discharge.sh [cap=65] [burst=25] [battMax=45] [cpuMax=86]` | **FAST DISCHARGE** for the charger test: sha256sum on every core in pmOS, battery-side thermal guard, TWRP measurement down to the target | in background |
| `charge-test.sh [cycles] [dwell] [abort]` | duty-cycle charger-test harness (pmOS burst → TWRP heat/SoC measurement) | in background |
| `fg-verify.sh` | **FUEL-GAUGE check**: `pmi632-battery` capacity/voltage/status + UPower over SSH | pmOS |

### Audio / SLIMbus diagnostics (see `../references/archive/slimbus-audio-context.md`)
These were moved here from the `scratchpad` — the complete toolset for measuring the SLIMbus-framer wall.

| script | what it does | mode |
|---|---|---|
| `dump_lpass_regions.py` | **full `/dev/mem` dump of the framer(0xc140000/0x2c000) + LPASS clock-controller(0xc000000/0x14000)** — auto NGD force-resume (LPASS_AP alias clocked), both regions to file + key regs. The SAME script on UT and on pmOS → two-sided diff without flash/SSR (cont. 142) | UT **or** pmOS root |
| `diff_lpass_regions.py` | word-level diff of the two dumps above (UT vs pmOS) — identical config = that layer is NOT the differentiator; a lone differing STATUS word = marker (prove it with causality) | host |
| `frm_causality.py` | **marker-vs-lever test:** writes framer state bits (+0x804 bit23, +0x430 bit4) from the AP via /dev/mem + watches FRM_STAT — does it latch (lever) or not (HW-owned marker). Reversible | pmOS/UT root |
| `framer_mmio_dump.c` | **standalone external KERNEL MODULE** (not a full Image): framer+clock MMIO snapshot into debugfs, at ADSP SUBSYS_BEFORE_SHUTDOWN (survives SSR). `make -C <tree> M=<dir> modules` → hot-load onto the oracle. Recipe for adding an instrument when the Image build is a dead end | UT (build+insmod) |
| `regdump_pmos.py` | **NGD(0xc141000) + SLIMbus-BAM v1.7.0(0xc104000) register dump** via `/dev/mem` (P_CTRL/P_EVNT/P_DESC etc.) — decides whether the RX pipe is connected and whether the framer moves the pointer | pmOS root |
| `poll_pipes.py` | **fast register-transition sampler** (2ms) during a re-triggered power_up: every NGD/pipe3/pipe4 change logged | pmOS root |
| `poll2.py` | slim-ngd rebind + 8s pipe3-RX/NGD sampling with a 150ms heartbeat (does P_EVNT move = is the framer writing) | pmOS root |
| `regdump.py` / `rdmem.py` | generic `/dev/mem` word-reader helpers (busybox has no devmem) | pmOS root |
| `rdtlmm.py` | TLMM GPIO ctl-register dump (SLIMbus pin-mux check: gpio70/71/72 → lpass_slimbus) | pmOS root |
| `fdt_slim.py` | **downstream FDT parser**: extracts the reg/IRQ/props fields of the `slim@c140000` node from the stock `boot_a.img` | host |
| `pdr_trace.sh` | dynamic_debug `pdr_interface`+`qcom_pd_mapper`+`slim_qcom_ngd_ctrl` → adsp remoteproc stop/start → dmesg-grep (is PDR/servreg the framer trigger?) | pmOS root |
| `diag-adsp.sh` | ADSP state summary: remoteproc state, APR-svc, slimbus-devices, clk_summary (bb_clk1/bi_tcxo) | pmOS |
| `downstream-capture.sh` | working-trace collector (dmesg slim + clk_summary) for the downstream/UT reference | UT/downstream |
| `dapm-probe.sh` / `dapm-probe2.sh` | DAPM widget state + path probe (what switches on during call/earpiece routing) | pmOS |
| `ear-tone{,2,3}.sh` / `hph-test.sh` / `spk-tone.sh` / `voice-test.sh` | audio-path test tones (earpiece/HPH/speaker/voice) with UCM cset | pmOS |
| `ucm-look.sh` / `ucm-why.sh` / `fix-ucm.sh` | UCM-import diagnosis + fix (why there is no sink) | pmOS |
| `set-vol.sh` / `sink-check.sh` | pipewire/pulse sink + volume check/set | pmOS |
| `verify-spk.sh` / `verify-spk2.sh` | speaker-recovery verification (card0 registers, clean tone) | pmOS |
| `pmos-baseline.sh` / `post-reboot.sh` / `capture-dbg.sh` | post-reboot baseline state + DBG-dmesg collection | pmOS |
| `diag-pw.sh` | pipewire/wireplumber graph diag | pmOS |
| `build_fg.sh` / `gen_ocv.py` | fuel-gauge OCV-table generator + build (see 9.12) | host |
| `voicehold.py` | keeps the voice-call PCM open (for the call-audio path test) | pmOS |
| `thermprobe.sh` | thermal-zone probe (battery-side vs CPU-side sensor) | pmOS/TWRP |

### ADSP firmware offline RE + framing-START fw-cave family (cont. 135–154)
The tools for measuring the framing-START trigger. **Offline RE** (without the device, from the durable `scratchpad-durable-adsp.mbn` + `adsp-coredump.elf`):

| script | what it does | mode |
|---|---|---|
| `coredump_resolve.py` | ADSP VIRTUAL address (0xf0xxxxxx) → coredump offset (VA→PA from the static mbn phdr → PA→foff from the coredump phdr). Gives RUNTIME values (heap/BSS). Resting ctx fields can thus be read WITHOUT a cave (cont. 147) | host |
| `make_disasm_elf.py` | Hexagon raw blob → objdump-able ELF32 (`llvm-objdump-21 -d --mcpu=hexagonv60`). For disassembling one VA window | host |

**fw-cave family** (splice→cave→SMEM-stash→sign→SSR-reload pmOS/slot_b; the builder patches + signs with `qtestsign.py adsp -v 3`; the onboard script SSRs + reads + heals; SMEM stash from the AP side at 0x86300000+HDR):

| script | what it does | mode |
|---|---|---|
| `build_snapFST1_patch.py` + `smem_snapFST1_read.py` + `fst1_pmos_onboard.sh` | **LIVE framing-START capability-wait TRACE:** splice AFTER the wait (0xf0174eb4) at 0xf04d15bc; catches the wait's return value + ctx fields. Proved the −2 (TIMEOUT) (cont. 149). Worked on the first try | pmOS root |
| `build_snapFSF1_patch.py` (+FST1 reader/onboard as the template) | **force-success experiment:** ctx+0xe54=0 → success branch; the framer FS stays 0 (weak negative, cont. 150) | pmOS root |
| `build_snapFWT1_patch.py` + `smem_snapFWT1_read.py` | **framer register-WRITE tracer:** hook at the HAL write-tail 0xf04bfe80, ring filtered to the framer aperture (0xee14xxxx). ⚠️ **HOT-HAL HOOK → stalled the ADSP SSR → reboot** (cont. 152); do not run it in this form, a rare/specific hook is needed | pmOS root (DANGEROUS) |

**Key RE facts (cont. 152, details: context §0):** framer register-HAL write=`0xf04bfe54` (`memw(base+table[id])=val`, tables @0xf0726400); **6 register groups** {0x200/0x400/0x600/0x800/0x1000/0x2000}; the `+0x600` frame-enable is ALREADY byte-identical → no unset SW bit. **block2 (0xc104000)=SLIMbus-BAM/DMA** (=`regdump_pmos.py` "BAM v1.7.0"), the DOWNSTREAM of framing → not a trigger. UT-side MMIO ONLY with a loadable module (the stock UT /dev/mem is restricted: MMIO=0x40 fill).

## Key facts
- `fastboot boot X.img` on the FP3 aboot **FAILED ('unknown reason')** → flash+reboot instead.
- A/B: boot_a=mmcblk0p27, boot_b=mmcblk0p28, userdata=mmcblk0p62. Active slot is currently `a`.
- `set_active` does NOT always zero the retry-count; the real reset is a SUCCESSFUL boot (qbootctl).
- pmOS password/SSH: user `fp3` / `$FP3_PW`, USB-net `$FP3_DEV_IP`.
- ✅ SOLVED (2026-06-28): the "Fairphone powered by android → fastboot, no lk2nd screen, pstore empty"
  symptom was caused by the **missing `dtbo` flash** (NOT AVB!). FIX: `fastboot flash dtbo dtbo.img`
  (z3ntu/dtbo-fp3 v1.0) BEFORE lk2nd+rootfs. pmOS edge / kernel 7.0.9-msm8953 mainline boots, phosh runs.
- Boot-watch lesson: a ≥90s window is needed (25s is short for kernel+phosh; it gave a false BACK_IN_FASTBOOT).
- ⚡ CHARGING SOLVED (2026-06-29): our own PMI632 charger driver in `qcom_smbx.c` CHARGES in pmOS
  (`/sys/class/power_supply/pmi632-charger` status=Charging, ~200mA from SDP, battery 37°C). See
  `../references/archive/hw-facts.md` (charger/PMI632 section). Installation: kernel package
  `apk add --allow-untrusted` (pmbootstrap `sideload` expects key-based SSH → manual scp+apk add is needed).
  Old workaround (if needed): TWRP charging `./to-twrp.sh` ⇄ `./to-pmos.sh`.
- ✅ health=Warm SOLVED (2026-06-29): the spurious `health=Warm` was 2 bugs — (1) on SMB5 the JEITA temp-status
  is not in STATUS_2 (0x07) but in STATUS_7 (0x0D) with a +2 bit shift; mainline decoded the wrong register;
  (2) `switch(stat)` expected a whole-register match. Fix in `qcom_smbx.c` (`smb_variant` + bit test).
  Verified on the device: `health=Good` even with STATUS_2=0x28 (BIT3 set). Register read:
  `sudo grep -E "^100[7d]:" /sys/kernel/debug/regmap/0-02/registers` (USID 0-02=PMI632). See dossier §11.
- ✅ WiFi WORKS (2026-06-29): scan/assoc/DHCP/internet/DNS OK (`wlan0`, wcn36xx). The blocker was the boot-time
  rfkill SOFT-BLOCK → `sudo rfkill unblock wifi` (systemd-rfkill preserves it across reboot). NM profile
  `HUAWEI-2.4G-V8qK`. Troubleshooting: `4way_handshake→disconnected`+`no-secrets` = WRONG PSK (not a driver bug).
- ✅ AUDIO (speaker) WORKS (2026-06-29): the user confirmed the 440Hz test tone. ALSA card0 "Fairphone 3"
  (`c051000.sound-card`), UCM `Fairphone_3` HiFi, `aw8898` amp OK. Test: `XDG_RUNTIME_DIR=/run/user/$(id -u)`
  + `pactl set-sink-mute ...HiFi__Speaker__sink 0` + `set-sink-volume 70%` + `paplay tone.wav`. Oddity:
  real PulseAudio 17.0 + PipeWire in parallel (Pulse drove the ALSA card). Modem: `mmcli -m 0` =
  `sim-missing` (stack up, SIM needed).
- 🔋 FUEL-GAUGE SOLVED (2026-06-29): pmOS HAS a battery % (`pmi632-battery` node + UPower → phosh icon).
  NOT a full port of the downstream qpnp-qg: the QG is voltage-based, the mainline `power_supply_batinfo_ocv2cap`
  is a ready OCV→SoC interpolator. 56-point `ocv-capacity-table-0` from the 25°C column of the downstream Kayo profile +
  `vbat`=ADC5_VBAT_SNS channel + new `pmi632-battery` (type=BATTERY) psy in `qcom_smbx.c`. Check:
  `./fg-verify.sh`. Limitation: reads slightly high while charging (elevated VBAT; IR-drop comp = future).
- ⚠️ pmOS→fastboot FLAKY: `reboot bootloader` sometimes boots back into pmOS → `to-twrp.sh` is now MULTI-TRY
  (get_fastboot 4×/90s). TWRP→fastboot (adb) is reliable. ALWAYS check `adb get-state` before a slot operation.
- Charger port: see `../references/archive/hw-facts.md` (charger/PMI632 section) + `charge-test.sh` (duty-cycle harness).
- 🌡️ THERMAL (measured, 2026-06-29, pmOS full 8-core `sha256sum` load): the CPU zones
  PLATEAU at ~76°C (HW throttle, A53 junction is safe up to ~95-105°C). The `pmi632-thermal`
  (BATTERY-SIDE sensor = the real fire-risk indicator) stays at **37°C** THROUGHOUT, does not budge. Therefore the
  `discharge.sh` guard goes on the BATTERY side (abort 45°C), not on the CPU max → continuous load,
  maximum discharge, zero battery risk. (Lesson: a `max-of-all-zones` guard false-trips on the fast
  CPU-die sensor; the battery-relevant zone must be watched.) pmOS has NO battery node → the SoC
  is only read by TWRP (`/sys/class/power_supply/battery/{capacity,temp,status}`).
- pmOS load-start GOTCHA: a fire-and-forget `setsid nohup yes &` over SSH does NOT stay alive;
  the reliable pattern is an SSH backgrounded on the host side and kept open with `'...; wait'` (as long as the
  host process lives, so does the remote load). Stopping: host `kill` + remote `pkill`.

## Installer-free OS switching (pmOS ↔ dev-enabled UT)
`$FP3_PMOS/ut-backup-20260630/` contains the complete **developer-enabled UT 24.04**
partition images (boot_a/dtbo_a/vbmeta_a/vendor_a/system_a/userdata, gz-compressed, slot a).
With these one can switch **without the GUI installer and without manual intervention** — e.g. the working-framer
capture needs UT, the experiments need pmOS:
```bash
cd $(dirname "$0")
# from fastboot:
./swap-to-ut.sh         # restore UT (TWRP boot + dd; handles the 48G userdata)
./swap-to-ut.sh quick   # quick: only boot/dtbo/vbmeta/userdata (system+vendor survive pmOS)
./swap-to-pmos.sh       # back to pmOS (z3ntu dtbo + flash-pmos full = the fresh build)
```
The two sides only overwrite each other's `userdata`; `system_a`/`vendor_a` remain untouched
during a pmOS session. New UT backup: `ut-backup.sh` (from a booted UT, adb+sudo).

## Typical flows
```bash
cd $(dirname "$0")
./diag.sh                      # from TWRP: what is on boot_a, why does it not boot
sudo adb reboot bootloader     # TWRP -> fastboot
./flash-pmos.sh vbmeta         # AVB off
./flash-pmos.sh lk2nd          # lk2nd onto boot (if needed again)
./boot-watch.sh from_fastboot 120 &   # reboot+watch (run_in_background)
./slot.sh get                  # retry-count check
```
