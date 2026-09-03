# FP3 — DATA INDEX (searchable by keywords)

> ⚠️ **AI-generated.** This page — and the code, device tree and tooling it
> describes — was written by Claude (Opus 5) working under the direction of
> Lajosházi, László Gergely, who reviewed every change and made or reviewed
> every measurement it rests on. Kernel commits carry `Co-authored-by: Claude`;
> anything prepared for the LKML carries `Assisted-by:` instead and never a
> `Signed-off-by` from the assistant, since only a human can certify the DCO.

> **Note:** paths under `archive/report-attachments/` are kept locally and are not part of
> this repository (personal outreach drafts and raw device captures). The entries
> below are retained as a record of what was collected.
# Purpose: quickly recognise whether a topic has ALREADY been examined, and in WHICH file it is.
# Usage: search for your topic (e.g. "bb_clk1", "proxy", "QMI", "PLL", "mem_setup") — the
# matching line tells you where to look before re-running it.
#
# LOCATION: this file (and most of the data packs listed below) lives under
# `fp3-porting-debug/references/` (co-located). The NON-migrated files in the project (`$FP3_ROOT/`):
# the journal (`FP3-slim-debug-journal.md`), the dated result/task logs, `scripts/`,
# and the kernel trees (`$FP3_PMOS/…`).
#
# ┌─ READING ORDER IN A NEW SESSION ─────────────────────────────────────────────┐
# │ 0. FP3-2026-Jul-13-startup-instructions.md  (SESSION STARTER: goal+skills+next;  │
# │    in the PROJECT: $FP3_ROOT/) ← THIS FIRST AFTER A RESTART                     │
# │ 1. fp3-pmaports/docs/  (CURRENT STATE: docs/kernel = whose code is which,         │
# │    docs/<subsystem>/bringup = how it came together)  ← THIS IS AUTHORITATIVE      │
# │ 2. slimbus-audio-red-herrings.md  (what we excluded and why; references/)         │
# │ 3. FP3-tierA-results-2026-Jul-10.md  (F1-UT + Tier A; stayed in the PROJECT)      │
# │ 4. fp3-porting-debug + fp3-kernel-test SKILLS (method, guardrails)                │
# └───────────────────────────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
  ★ CURRENT / AUTHORITATIVE (use these)
═══════════════════════════════════════════════════════════════════════════════

AUDIO (SLIMbus/WCD9335) → THE AUTHORITATIVE PLACE IS THE DOCUMENTATION, NOT THIS SKILL:
  github.com/llg179org/fp3-pmaports/tree/main/docs/audio          (how it works today)
  github.com/llg179org/fp3-pmaports/tree/main/docs/audio/bringup  (how it came together)
  Left here: slimbus-audio-red-herrings.md (dead-end catalogue — does not go stale).
  The dated investigation logs: references/archive/ (see archive/README.md);
  the component address map: archive/slimbus-audio-context.md §7.

FP3-tierA-results-2026-Jul-10.md
  Detailed results of Tier A + F0 + F1 + F10/F11 + firmware-disasm analysis. Keys:
  F1-UT, F6 fw byte-identical, HWL leaf trace, HalHwIo, PLL lock, bb_clk1, SCM ftrace.

FP3-tasks-v2-2026-Jul-10.md
  AUTHORITATIVE task list (red-teamed). Keys: T1-T7, marker 0x2c OPEN, Delta A dead,
  next steps. Supersedes the old task files.

FP3-guardrails.md
  EXECUTION (measurement-integrity) blocklist. Keys: soft-vs-hard evidence,
  confirmation-theater, static-vs-live, one-sided-diff, marker-vs-lever. (Device
  brick-safety is SEPARATE, in the skill.)

FP3-slim-debug-journal.md
  FULL JOURNAL (448 KB, cont. 1-103). Every hypothesis→test→verdict in chronological order.
  Grep here when the question is "have we already examined X". Keys: EVERYTHING.

fp3-skill-feedback-log.md  (the skill creates it create-if-absent from the template)
  SKILL-FEEDBACK LOG. Transferable methodological lessons (safety class, measurement-integrity
  trap, better recipe, skill correction) — the raw material for the NEXT edit of the fp3-porting-debug /
  fp3-kernel-test skills and the references/ files. NOT the investigation journal. NEW/PROMOTED/DROPPED.
  Template: fp3-porting-debug/references/skill-feedback-log.template.md (the journal's template: journal.template.md).

hw-facts.md   (references/archive/ — the PERMANENT-FACTS half of Opus-fp3-facts.txt)
  PERMANENT HW FACTS. Keys: USB gadget IDs, partition map (mmcblk0p*), boot-header
  versions, boot-image parameters, VID:PID sequences.
archive/boot-debug-log.md   (ARCHIVE — dated log, not method)
  BOOT/RAMDISK BRING-UP LOG + architecture notes (chronology). Keys: pstore/SD/eMMC
  log channels, A/B retry, skip_initramfs, NCM ramdisk, COMPONENTS.

═══════════════════════════════════════════════════════════════════════════════
  FIRMWARE RE / DISASSEMBLY (ADSP adsp.mbn, Hexagon/QDSP6)
═══════════════════════════════════════════════════════════════════════════════

archive/report-attachments/adsp-firmware-framer-strings.txt
  ADSP fw ULOG strings. Keys: "Switching driver mode (master: %d)", framer-mode
  decision, device.cfg/ACDB, ADSP.VT.3.0-00161 build 2020-05-18, ELF32 unencrypted.

archive/report-attachments/adsp-framer-decision-disasm.txt
  Framer-MODE decision disasm. Keys: immext constant-extender xref, ctx+0x74
  satellite_hw_owner, ctx+0x78 framer_mode, ph4 0xf015f000.

archive/report-attachments/adsp-slimbus-clock-disasm.txt
  SLIMbus ref-clock enable path disasm. Keys: LPASS core clock, clock_manager,
  afe_lpass_core_clk, ctx struct, HalHwIo.

ai-rebuttal-afe-framer.md
  Rebuttal of an AI hypothesis. Keys: AFE clock/APR vector before the framer = NOT PRESENT in the
  downstream (refuted), msm-dai-slim, boot timing. (AFE-pre-framer = DEAD.)

MORNING-HANDOFF-m9.md
  m9 LPASS-core-clock finding. Keys: f0617928 clock_manager.cpp, AFEDeviceDriver
  boot-init, afe_lpass_core_clk, DAL proxy-creation failure. (cont. 46 line.)

═══════════════════════════════════════════════════════════════════════════════
  TRACES / REGISTER DUMPS / GOLDEN CAPTURE
═══════════════════════════════════════════════════════════════════════════════

pil_bringup.txt
  UT PIL ADSP bring-up ftrace (scm/rpm_smd/clock). Keys: rpm_smd_send, clk2,
  MARK-UNBIND, subsys-pil-tz. (cont. 100 capture.)

boot_trace.txt
  Boot-time ftrace (scm_call_start/end). Keys: func id 0x42000404, PAS SCM funcIds.

archive/report-attachments/downstream-golden-ipc-trace.txt
  GOLDEN: working UT framer bring-up ipc_logging. Keys: SELECT_INSTANCE + POWER_REQ
  SvcId 0x301, NO CHECK_FRAMER, master capability after ~2ms.

archive/report-attachments/pmos-slim-ctx-devmem.txt
  pmOS (FAILING) /dev/mem dump. Keys: NGD_STATUS=0x40c, NGD_CFG=0x0, INT_STAT=0x0.

archive/report-attachments/ut-slim-ctx-devmem.txt
  UT (WORKING) /dev/mem dump. Keys: uniform 0x70 (idle clock-gated block = tooling
  artifact, NOT a real 0), framer verified working.

archive/report-attachments/pmos-dmesg-full.txt
  Full pmOS boot dmesg (2026-07-02). Keys: qcom-ngd-ctrl DBG, bb_clk1 force,
  capability timeout, full bring-up.

scratchpad/ut-enabled-clocks.txt
  UT enabled_clocks debugfs snapshot. Keys: xo_clk_src, bimc, pcnoc, snoc, qdss.

═══════════════════════════════════════════════════════════════════════════════
  PIL vs PAS BOOT COMPARISON (source diff)
═══════════════════════════════════════════════════════════════════════════════

pas-launch-diff.md  (+ identical: archive/report-attachments/pas-launch-diff.txt)
  PAS(mainline,FAIL) vs PIL(downstream,WORK) source diff. Keys: qcom_q6v5_pas.c,
  msm8996_adsp_resource, pas-id=1, carveout 0x8d600000, mdt_loader, Delta A
  (conditional MEM_SETUP — later DEAD: mbn relocatable).

archive/report-attachments/pil-tz-vs-pas-boot-comparison.md
  subsys-pil-tz vs qcom_q6v5_pas step by step. Keys: TZ PAS SCM, proxy-reg
  vdd_cx TURBO, crypto clocks, identical carveout, "functionally equivalent".

═══════════════════════════════════════════════════════════════════════════════
  EXTERNAL COMMUNICATION (GitHub #255 / forum / Fairphone support / Matrix)
═══════════════════════════════════════════════════════════════════════════════

fairphone-slimbus-framer-report.md
  The main public report (framer-never-comes-up). Keys: SDM632, summary ask.

archive/report-attachments/issue-comment-firmware-analysis.md   fw-disasm comment #255
archive/report-attachments/issue-comment-register-level-v5.md   the FINAL version of the register-level comment
                                                                (v1-v4 deleted 2026-07-30: superseded, not referenced)
archive/report-attachments/issue-comment-runtime-tests.md       6 runtime datapoints, APR/AVS works
archive/report-attachments/issue-comment-draft.md               raw evidence attach list
archive/report-attachments/github-reply-to-z3ntu.md             reply to z3ntu: DT plumbing matches
archive/report-attachments/github-reply-to-z3ntu-2.md           Bjorn 1075549 series tested: no change
archive/report-attachments/fairphone-forum-post-draft-v2.md     forum draft v2 (LPASS core-clock)
archive/report-attachments/forum-reply-to-yvmuell.md            forum reply (ticket #1453513)
archive/report-attachments/fairphone-support-ticket.md          FP support ticket text
archive/report-attachments/fairphone-support-followup-1.md      support follow-up (Noah)
archive/report-attachments/pmos-matrix-message.md               pmOS Matrix message
archive/report-attachments/slimbus-false-success-consolidation.md  "false success" consolidated conclusion
archive/report-attachments/issue-comment-draft.md               (see above)

═══════════════════════════════════════════════════════════════════════════════
  PORTING (non-audio) — charger, audio DT, Sailfish/hybris build
═══════════════════════════════════════════════════════════════════════════════

charger-port/CHARGER-PORT-PMI632.md
  PMI632 charging mainline port. Keys: qcom_smbx.c, SMB5, fuel-gauge, Li-ion safety.

charger-port/UPSTREAMING.md
  Charger patch submission. Keys: DCO, Signed-off-by, git identity.

audio-port/README.md
  pmOS earpiece/in-call audio port PLAN. Keys: aw8898 MI2S, PM8953 WCD, DT dai-links,
  mixer_paths.xml, EAR_S/RX1/DEC1. (Initial — later it turned out: WCD9335 SLIMbus is the right one.)

audio-port/wcd9335-slimbus-bringup.md
  WCD9326 SLIMbus DT draft. Keys: slim-ngd, tasha_ifd, tlmm67/73/74, msm8996.dtsi ref.

sailfish-components.md
  Sailfish hybris port component provenance. Keys: hybris-22.2, /e/OS A15, provenance,
  soong/RAM build recipe.

sailfish-akcioterv.md
  Sailfish FP3 port action plan (HADK). Keys: droid-config-fp4 ref, MSM8953, hybris.

sailfish-customizations.md
  Sailfish build customizations. Keys: hybris-boot init, SD log, ramdisk, fail().

pmos-bringup.md
  pmOS mainline bring-up (88 KB). Keys: feature matrix, §9.x execution log, charger,
  fuel-gauge, modem, the SLIMbus wall. Display/GPU/WiFi/modem OK.

scripts/README.md
  Toolkit. Keys: fp3-env.sh, slot.sh, boot-watch.sh, flash-pmos.sh, test-slim-kernel.sh,
  qrtr_lookup.py, regdump_pmos.py, adsp-smem-log.py.

kcomp/lvm-config.txt / kcomp/twrp-config.txt
  Kernel .config fragments (configfs/gadget/RNDIS). Keys: USB_CONFIGFS, IKCONFIG.

═══════════════════════════════════════════════════════════════════════════════
  ☠️ OBSOLETE — do NOT use as a starting point (historical reference only)
═══════════════════════════════════════════════════════════════════════════════

FP3-slim-STATUS.md                     (2026-07-07 cont. 17; superseded by context+tracker)
FP3-slim-session-handoff-2026-07-04.md      (OBSOLETE; Option-2 ADSP fw instrumentation plan)
FP3-slim-session-handoff-2026-07-04#2.md    (OBSOLETE; M2 code injection + wedge recovery)
FP3-tasks-2026-Jul-10.md               (superseded: FP3-tasks-v2; §0.2 N-ladder obsolete)
FP3-tasks-v2-DRAFT-2026-Jul-10.md      (SUPERSEDED by v2-FINAL; premises refuted)
FP3-tasks-2026-Jul-10-executed-log#1.md     (cont. 91 execution log + red-team critique)
FP3-run-log-Jul-10.md                  (cont. 91 session log; the journal is the condensed version)
FP3-redteam-prompt.md                  (red-team session-starter template)
last.txt                               (just one claude --resume command)

═══════════════════════════════════════════════════════════════════════════════
  ★ QUICK "ALREADY EXCLUDED" REMINDER (where the evidence is)
═══════════════════════════════════════════════════════════════════════════════
  firmware is NOT the fault ........ cont. 99 (fw swap) → runtime-trigger-progress
  AP proxy resources equiv. ....... cont. 101/102 → runtime-trigger-progress
  AP proxy POWER (cx@max hold) .... cont. 103 LIVE experiment → runtime-trigger-progress
  QMI 301 = downstream ............ downstream-golden-ipc-trace + prior driver-note
  NGD setup / NGD_CFG = downstream  cont. 103 addendum
  QDSP6SS is NOT an AP interface .. cont. 102 (msm8953 = pure TZ-PAS)
  bb_clk1 force-enable ............ red herring (journal 17/928)
  Delta A (conditional MEM_SETUP) . DEAD (mbn relocatable) → tasks-v2 §0
  0x2c marker (QDSP6SS 0x10b) ..... ADSP-written OUTPUT, not an AP lever (E1c pre=0)
  Bjorn 1075549 NGD-race series ... tested, no change → github-reply-to-z3ntu-2
  AFE-pre-framer clock vector ..... refuted → ai-rebuttal-afe-framer
  MEM_SETUP fires on mainline ..... confirmed by live ftrace → tierA-results
  wcd-mclk force-ON .............. no-op (cont. 145; the codec enum requests the framer CLK, not MCLK)
  framing-START = 0xf04d14cc ...... LIVE wait-return −2 TIMEOUT confirmed (cont. 149 FST1 cave)
  force-success (ctx+0xe54=0) ..... does NOT frame, FS stays 0 (cont. 150 FSF1; weak negative)
  framer frame-enable (+0x600) .... byte-identical both-sides → no unset SW bit (cont. 152)
  block2/SLIMbus-BAM (0xc104000) .. data plane/DMA, framing-DOWNSTREAM → not a trigger (cont. 153-154)
  FWT1 write-tracer (hot-HAL) ..... stalls the ADSP SSR → reboot; do not run it (cont. 152)
