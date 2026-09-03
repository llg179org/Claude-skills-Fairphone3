# FP3 audio (SLIMbus) — DEAD ENDS / red herrings (archive)

> ⚠️ **AI-generated.** This page — and the code, device tree and tooling it
> describes — was written by Claude (Opus 5) working under the direction of
> Lajosházi, László Gergely, who reviewed every change and made or reviewed
> every measurement it rests on. Kernel commits carry `Co-authored-by: Claude`;
> anything prepared for the LKML carries `Assisted-by:` instead and never a
> `Signed-off-by` from the assistant, since only a human can certify the DCO.

> This file is the historical/excluded content extracted from `archive/slimbus-audio-context.md`.
> Its purpose is the REPETITION GUARD: before re-examining anything, look it up here — many leads are
> already closed, together with the location of the evidence (cont. X). The cont. X references point to the logs:
> `FP3-slim-debug-journal.md` (full journal) + `archive/slimbus-audio-tracker.md` (live tracker) + `data-index.md`.
>
> **★★★★★ SOLVED (cont. 196, 2026-07-23): the "consolidated verdict" below (the wall is PHYSICAL/ADSP-internal/PLL)
> WAS WRONG — SUPERSEDED.** The actual root: **QDSP6SS `0x0c20002c` bit3**, which mainline PAS leaves
> set (downstream PIL clears it). With it cleared, the framer frames up. The AP-side exoneration + the byte-identical measurements
> REMAIN TRUE, but the "boot-env-dependent physical wall" conclusion drawn from them was wrong: the difference is ONE
> AP-writable register bit, set by the load path (PIL vs PAS). See the first ★★★★★ section of `archive/slimbus-audio-context.md`.
> The list of excluded leads below (as a repetition guard) remains valid and useful.
>
> **[HISTORICAL verdict, SUPERSEDED] The consolidated verdict (why ALL of them are dead): identical fw + identical TZ + identical AP environment → the framer
> frames under PIL, is dead under PAS. The AP side is fully exonerated. The wall is PHYSICAL, ADSP-internal,
> boot-env-dependent (PIL vs PAS): the framer-branch clock enable is byte-identical working↔dead, yet it does not run on the dead
> side → the parent RCG root / source LPASS audio PLL does not feed under PAS.**

---

## 1. EXCLUDED LEADS (do not re-run — location of the evidence)

| topic | verdict | evidence (where) |
|---|---|---|
| **firmware** | NOT the difference (decisive swap: pmOS fw on UT/PIL FRAMES) | cont. 99 → tracker |
| **AP proxy resources** | equivalent (xo, cx, crypto) — from a genuine downstream source | cont. 101/102 → tracker |
| **AP proxy POWER** | excluded by LIVE experiment (cx@INT_MAX+xo held THROUGHOUT → framer dead) | cont. 103 → tracker |
| **QMI 301 traffic** | = downstream (SELECT_INSTANCE MASTER + POWER_REQ, acked) | cont. 103 + golden-ipc |
| **QMI payload / SELECT_INSTANCE "3rd TLV"** | DEAD LEAD — the "21B" = 7B QMI hdr + 14B TLV, the TLV is byte-identical to mainline; the QMI content is EXONERATED, "not the lever" | journal:134-136 + cont. 58c |
| **ACDB-as-framer-trigger (path A)** | DEAD LEAD (golden-trace timing) — details: §3 | journal:44-63 + cont. 58c/127 |
| **NGD setup / NGD_CFG** | = downstream (ENABLE\|RX\|TX write is present; CFG=0 = symptom) | cont. 103 addendum |
| **QDSP6SS AP poke** | not an AP-facing interface on msm8953 (ADSP = pure TZ-PAS) | cont. 102 |
| **AP RPM vote / bb_clk1** | excluded (bb_clk1 force = red herring; no AP-visible LPASS clock) | cont. 92 / journal 17/928 |
| **cx corner** | excluded (PAS INT_MAX ≥ PIL TURBO) | cont. 82/101 |
| **SMMU/mem permission, pinmux/reset/interconnect** | no delta (structural) | cont. 79/83 |
| **Delta A (conditional MEM_SETUP)** | dead (mbn relocatable → MEM_SETUP fires) | cont. 92 |
| **0x2c marker (QDSP6SS 0x10b)** | ADSP-written OUTPUT, not a lever; gate=0 on both sides | cont. 91/93/94 |
| **Bjorn 1075549 NGD race** | tested, no change | github-reply-to-z3ntu-2 |
| **q6_core_clk clock-fail (F3, ss=2 CVD)** | red herring — byte-identical fw static registry, `q6_core_clk` is not registered (Q6SS clocks under other names), wrong domain (voice) → boot-path-independent, not PAS≠PIL | cont. 117 (registry RE) |

---

## 2. EXHAUSTING THE AP SIDE — OVERNIGHT CAMPAIGN (cont. 104–113)

ALL THREE AP-adjacent branches of the fork after cont. 103 are closed
(1: TZ SCM metadata diff, 2: global boot state, 3: ADSP PLL leaf):

| task | branch | verdict | cont. |
|---|---|---|---|
| **T1** SSR discriminator (live) | boot order/timing | fresh PAS `auth_and_reset` AFTER EVERY other subsystem → framer still DEAD → timing branch EXCLUDED | 104 |
| **T5** TZ-input checklist (offline) | (a) TZ SCM metadata | metadata alloc (dma_alloc_coherent 4K/non-cache) + SCM arg semantics (SCM_RW) + call order EQUIVALENT, no intermediate hyp_assign, the PAS auth SUCCEEDS → (a) NOT supported (the divergence is AFTER the successful auth) | 107 |
| **T2** warm chain (live) | (b) global-state inheritance | UT (framer alive, PIL) → warm reboot into pmOS WITHOUT power-off → framer DEAD; the warm reboot preserves the RPM/PMIC always-on state, yet dead → (b) EXCLUDED (T1+T2 together knock it out) | 110 |
| **T3** TZ-log two-sided (live) | TZ runtime | `tzlog.py` on both sides (pointer @0x08600720 → diag PA 0x866fb000, valid tzdbg_t); 15 shared TZ msg codes (RPM/SPM/clock), no error/fault/xpu. Structural limit: the TZ ring logs TZ/RPM/SPM/PSCI, NOT the ADSP framer → (c) invisible, no TZ-RE seed opens up. Dumps: `report-attachments/tzlog-night/` | 110 |
| **T6** icc/RPM bw vote (live) | last AP vote | `interconnects=<&pcnoc MAS_CRYPTO &bimc SLV_EBI>` added to the mainline `scm` node → `qcom_scm_bw_enable()` votes UINT_MAX on crypto→EBI under PAS (proven: `firmware:scm` icc client) → framer still DEAD → last AP-visible divergence EXCLUDED | 105/113 |
| **T4** ADSP F3 DIAG tap | DSP-internal log | REPETITION GUARD: the CNTL bind is FATAL (SoC freeze→reboot), the DATA channel without a mask gives 0 frames at framer failure → NOT run | 106 |
| **T12** web | upstream | zero new movement (#255 + forum unresolved); new (c) idea from #255: "LPASS xPU access gate" in front of the physical framer clock (TZ/PIL-programmed, not AP) | 109 |

**Consolidated overnight verdict:** AP + fw + TZ input (T5) + boot order (T1) + global-state inheritance (T2) +
TZ runtime (T3) + last bw vote (T6) — ALL excluded/equivalent. The wall is purely (c): an ADSP-INTERNAL framer/PLL precondition,
AFTER the successful PAS auth, in the ADSP fw.

---

## 3. DEPRECATED CAPTURE SITES / FW-CAVE DEAD ENDS

### `f019abb0` / HWL4 static CGC leaf (cont. 111)
The snapHWL4 fixed-VA leaf cave (`f019abb0` = `halHwIo_EnableCgcClock` return, fixed `r14=0xe1302ab0`,
disasm-verify PASSED) → **capture ABSENT** on pmOS. The chain was validated (snapVA: `0xe1302ab0` is writable+persistent
from the config-group phase) → NOT a broken measurement. Verdict: the leaf writes in the EARLY phase (or it is not on the framer-clock
path, or the late SMEM item-469 alloc zeroes it BEFORE the config-group phase) → **DEPRECATED as a capture site.**

### config-group dynamic capture — the software dispatch is IDENTICAL (cont. 114–118)
The `f04bfba0` splice cave FIRED (magic 'CGP1'). Live dispatch: handle=`memw(ctx+0xe18)`,
`memw(handle+0x48)=0xf019eb40` resolver thunk →…→ `memw(memw(handle+0x3c)+0)` driver node.
- **UT positive control (cont. 116):** the level-1 dispatch state is IDENTICAL working↔dead (the "unresolved thunk" is
  present on the WORKING UT too) → the thunk is NOT a lever.
- **snapCGP2/CGP2b (cont. 118):** `0xf04df244` disasm: `r17=memw(handle+#0)` = RCGR/CBCR MMIO base (a data field, NOT an
  immediate) → no hard-coded register, the base is runtime. snapCGP2 UT (framer ALIVE): `handle+0x3c=NULL` on the WORKING
  side too, `+0x38=0`, `+0x40=0xf098cab0` → the deeper hop is a dead branch. snapCGP2b pmOS (dead): `handle+0x38/+0x3c(NULL)/
  +0x40/+0x44/+0x48(0xf019eb40)/rc` ALL BYTE-IDENTICAL working↔dead.
- **Verdict:** the config-group dispatch object and pointer graph are completely identical on both sides; the software does NOT diverge.
  The config-group PATH is CLOSED — the wall is purely physical realisation.

### `0xee00d01c` as the framer-branch CBCR — MISIDENTIFIED (cont. 122 → 127b)
snapCKB3 handle+0x1c = CBCR address `0xee00d01c` (= 0xee000000+0xd01c) → we first took this for the framer branch.
**CKB7 UT golden (cont. 127b) refuted it:** the `0xf04df0c8` enable primitive in the framer block enables the `0xee012014`+`0xee012018`
registers; `0xee00d01c` is NEVER enabled on the working side. ⇒ `0xee00d01c` is **a different clock,
misidentified** — which is why CKB3 led nowhere, and why the CKB6 force hung.

### snapCKB4 / CKB5 (post-enable + discovery) — false negative (cont. 119–126)
The cave spliced into `0xf04df0b4` only intercepted one of the CBCR-enable branches (the two paths of the SET merge
at the `0xf04df0c8` store) → **false negative** ("the HW-desc accessor vtable never runs"). The correct splice point is `0xf04df0c8`.

### snapCKB6 (force-CBCR write lever) — DETERMINISTIC NO-BOOT (cont. 126)
Brute-forcing the CBCR bit HANGS the ADSP boot → the branch requires the regular enable sequence,
it can NOT be fixed by forcing.

### q6afe / APR untested lead — EXHAUSTED (cont. 125–126)
1. **AFE-clock branch DEAD** — 0/54 SLIMbus clock IDs in the Q6AFE enum (the framer clock is not AFE-exposed).
2. **AFE-port branch REFUTED** (cont. 9.30).
3. **AFE-config(SLAVE)** = `afe_set_config(AFE_SLIMBUS_SLAVE_CONFIG)` = param `AFE_PARAM_ID_CDC_SLIMBUS_SLAVE_CFG
   0x00010235` — mainline q6afe.c DEFINES it + there is `q6afe_set_param()` plumbing, BUT there is no caller, and mainline
   wcd9335 does not generate the blob. Scoping: this happens AFTER codec PROBE (post-framer port config), NOT the framer trigger.

### ACDB as framer trigger — REFUTED (cont. 127 correction)
The cont. 126 claim "framer trigger = ACDB bring-up" was WRONG (soft regression). The golden trace (journal:44-63,
HARD live timeline): the framer frames at t=22.262 — purely from the slim QMI (SvcId 0x301) SELECT_INSTANCE+POWER_REQ
handshake —, BEFORE ALL ACDB/audio-QMI traffic (t=25+). ACDB is post-framer. Confirms cont. 58c:
the entire AP→ADSP QMI content (including the SELECT_INSTANCE "3rd TLV") is EXONERATED — "not the lever".

---

## 4. CLOSED MEASUREMENTS THAT LED TO THE CURRENT FRONTIER (cont. 119–127c)

These are NOT dead ends but the steps that narrowed the wall down to its physical realisation — archived here because
their details were removed from `summary.md` §0:

- **cont. 119 (pmOS, HIT):** the framer clock's (0x12014) enable method RUNS on the dead side, RCGR BASE=`0xee012000`
  (domain 0x12000→runtime map). → the code does NOT skip, real MMIO base.
- **cont. 120–121:** post-enable RCGR `CMD_RCGR=0x80000000, CFG_RCGR=0x00000509 (src=5,div=9)` — **BYTE-IDENTICAL**
  UT↔pmOS. The poll-time ROOT_OFF=1 does NOT discriminate (it is 1 on the working UT too); the RCGR only sets the rate. ⇒ the gate is not
  at the root but at the BRANCH clock (CBCR) level.
- **cont. 127b–c (CKB7/CKB7b) — DECISIVE:** the correct framer branch = `0xee012014`+`0xee012018`; the enable is BYTE-IDENTICAL
  to the UT gold (both ENABLED, caller `0xf01d41ec`, value `0x1`). ⇒ the branch enable happens on the dead side
  too, identically → the wall is PHYSICAL (the parent RCG root `0xee012000` / source LPASS audio PLL does not feed under PAS).
- **Method win:** dead-side measurement with SSR-reload deploy (`cp mbn; echo stop/start > remoteproc2/state`, ~8s,
  WITHOUT reboot) — bypasses the cold-boot/fastboot flakiness.

**→ The current OPEN frontier (TO BE TESTED, see summary.md §0): CKB8 — measuring whether the parent clock is fed.**

---

## 5. INCIDENTS / LESSONS (not leads, but a source of guardrails)

- **Journal disk-full reboot loop (cont. 119):** during many cold reboots the systemd journal grew to 289M → the 2.4G
  loop rootfs FILLED UP → reboot loop. FIX: journal cap `/etc/systemd/journald.conf.d/cap.conf` (SystemMaxUse=40M) +
  vacuum. Guardrail: journal vacuum + df gate before a cold-boot deploy.
- **CKB3-wedge "incident" (cont. 121):** it was a MISUNDERSTANDING — transient retry-fastboot, the cave is harmless (pmOS booted
  with CKB3, remoteproc=running).
