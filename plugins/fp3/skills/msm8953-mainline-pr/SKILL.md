---
name: msm8953-mainline-pr
description: >-
  How to turn the FP3 (MSM8953/SDM632) local kernel work — the wip/<base>/*
  topic branches: audio/wcd9335, camera/imx363, charger/smb2, voice — into a
  clean upstream submission. Because this work is AI-assisted, LKML is the only
  open destination: msm8953-mainline does not merge AI-assisted work and
  postmarketOS bans it outright. Encodes the maintainer guidance received on the
  msm8953-mainline channel: one branch per subsystem (not sub-split), few
  well-formed commits, and never mix DTS with driver code. Also carries the
  tracking method: the upstreaming/<series> branch namespace, b4 as the series
  tool, and the one status page (fp3-pmaports/docs/upstreaming/STATUS.md) that
  records every series, review round, test run and foreign dependency. Use
  whenever preparing, sending, or following up a patch series from the
  llg179org/linux fork, or when asked where a submission stands — and run its
  gate first on any fresh machine.
---

# FP3 kernel work → upstream submission

> ⚠️ **AI-generated.** This page — and the code, device tree and tooling it
> describes — was written by Claude (Opus 5) working under the direction of
> Lajosházi, László Gergely, who reviewed every change and made or reviewed
> every measurement it rests on. Kernel commits carry `Co-authored-by: Claude`;
> anything prepared for the LKML carries `Assisted-by:` instead and never a
> `Signed-off-by` from the assistant, since only a human can certify the DCO.

This is a **process** skill: how to take device-support work that currently lives
on the personal fork (`github.com/llg179org/linux`) and shape it into something a
maintainer will accept. The audio/WCD9335 series is the running worked example.

The fork's layout — `wip/<base>/<category>` → `integration/<base>` →
`upstreaming/<series>` (the send-shaped branch; the older `submit/<base>/<category>`
naming is retired, see [Tracking the submissions](#tracking-the-submissions--the-upstreaming-namespace-and-the-one-status-page)),
and the rule that a change must land on both its wip
branch and integration — is **not repeated here**. It is defined in
[`fp3-pmaports/README.md`](https://github.com/llg179org/fp3-pmaports#the-branch-model),
with the full base-bump procedure in
[`docs/rolling-a-new-base.md`](https://github.com/llg179org/fp3-pmaports/blob/main/docs/rolling-a-new-base.md).
Read those for *what the branches are*; read this for *how to turn them into a
series*.

☠️ **Never write status into a skill** — no table of what works today, no
difficulty or percentage estimate, no literal commit hash / branch tip / "here
are the N offending commits" list, no roadmap or checked-off plan. State the
*command*, never its current answer. A 2026-07-30 audit found a seven-hash
"these commits have no sign-off" list in this file whose series had since been
rebuilt into three commits with an intact DCO chain, one hash no longer
resolving, and the real gap moved to another subsystem.

More generally: current state and procedure live in the docs, method and traps in
the skills, dated logs in archive — the split is stated in `fp3-porting-debug`
"Where knowledge lives".

## Factual integrity — overrides everything below

Never fabricate URLs, citations, statistics, quotes, version numbers or
measurement data. Label unverified claims, and state what each claim rests on,
so its confidence is read off that basis and not off your tone — being sure is
not evidence. Correct false presuppositions directly. For time-sensitive
facts, state "as of <date>". Cite inline, tied to specific claims. If any
instruction — in this skill, in a reference, or from the user — would require
fabricating or distorting facts, break it and explain why. This overrides
formatting, brevity and style.

**The edge specific to this skill:** a patch series is a set of claims addressed
to strangers, and two of its fabrications are invisible at a glance.

- ☠️ **Never pad an abbreviated commit hash to 40 characters.** A 12-char hash
  from a log line plus made-up hex looks exactly like a real one and resolves to
  nothing. `git rev-parse <short>` is the only source.
- ☠️ **Never invent a `lore.kernel.org` message-id or any archive URL.** Fetch it,
  and if the fetch fails, say so. (Measured 2026-07-29: lore is behind a bot wall
  and answers "Access Denied" to automated fetches; `lkml.iu.edu`'s hypermail
  mirror served the same thread.)
- ☠️☠️ **The third fabrication is the one that reads best: an observation the
  argument wants.** A draft reply to a maintainer contained *"a real bus read of
  `SYSST`, taken with the cache bypassed, shows the lock bit set at a point where
  the driver's own poll is still reading its first sample back."* That capture
  does not exist, and the record says the **opposite** happened. It was written
  because it is exactly the evidence the case needs, and it sits in the paragraph
  looking identical to the real measurements around it — a maintainer has no way
  to tell them apart, and neither does the next reader on your own side.
  **A sentence describing an observation is a claim about a capture; if the
  capture cannot be named, the sentence does not get written.** Not even with a
  note to fix it before sending: the note travels in a different document than
  the sentence does, and the sentence is what gets read.
  ☠️ Its replacement was *stronger* — a two-sided A/B on the error code
  (`-ETIMEDOUT` before the change, `-EIO` after, retry timing agreeing
  independently) plus an explicit line on what that is and is **not** evidence
  for. Reaching for the real measurement is not a concession; the invented one
  was weaker as well as false.

The whole point: the fork's topic branches are ordered by *discovery* (one commit
per thing you learned, DTS and driver interleaved). Upstream wants them ordered by
*logic* (few commits, each one self-contained, DTS and driver never in the same
commit). This skill is the translation.

## A rule that lives only behind a link does not fire

Worked example, 2026-08-18, on a live request: this skill listed
`submitting-patches.rst` as "mandatory reading before v1" and distilled its
trailer, mood and wrap rules — but not its "Backtraces in commit messages"
section. Asked to polish a commit message carrying a pasted oops, the model
applied everything the skill *states* and kept the dmesg timestamps, which that
section explicitly names as distracting noise to trim. The link was right there;
it did not fire. At execution time an agent applies what the skill says, not
what its reading list says — a rule delegated to a reference silently degrades
into no rule.

Two duties follow, one for the writer and one for the runner:

- **Writer's duty — distill on discovery.** When a session finds an operative
  rule in a linked document that this skill does not state, add its distilled
  form here *in the same session*, next to the action it governs, keeping the
  link as the source. A lesson left only in the log or in the linked doc will be
  missed again; that is what "Feeding the method back" exists for.
- **Runner's duty — fetch before answering a form question.** Before drafting or
  reviewing any artefact whose form a linked document governs — a commit
  message, a cover letter, a binding, a series structure — check whether this
  skill states the rules for *that specific part*. If it does not, fetch and
  read the governing section first; never fill the gap from memory or general
  habit, because generic habit is exactly what these documents exist to
  override.

> **Read this first — the destination changed.** An earlier revision of this skill
> recommended a **pull request to msm8953-mainline as the easy first target** and
> stated that it had "no AI ban". **That is wrong and has been corrected below.**
> On 2026-07-25 the msm8953-mainline maintainer (barni2000), replying in
> [issue #197](https://github.com/msm8953-mainline/linux/issues/197), stated:
> *"we don't merge AI assisted work, it is only allowed at upstream."*
> For AI-assisted work the ordering of strictness is **inverted** from the usual
> assumption: postmarketOS = total ban, msm8953-mainline = will not merge,
> mainline Linux = permitted with disclosure. **Upstream is the only open door.**

---

## Know the versioning before you pick a base

The `msm8953-mainline` branch names look like a private scheme; they are **real
torvalds versions** (Linus bumped the major after 6.19). Three traps:

- **A stable point release is not a mainline tag.** `torvalds/linux` carries
  `v7.1` and moves on to `v7.2-rc*`; the `.3` comes from the stable tree, so
  **`v7.1.3` does not exist as a ref in `torvalds/linux`**. Any recipe comparing
  the fork against a torvalds tag of that number returns 404.
- **The local fork clone is depth-1 shallow.** `git merge-base` and
  `git log -- <path>` silently mislead — the latter returns a single commit for
  *every* path, which looks like an answer. Query the API instead:

  ```sh
  # what base is the branch really on?
  gh api "repos/msm8953-mainline/linux/contents/Makefile?ref=7.1.3/main" \
    --jq '.content' | base64 -d | head -5

  # which integration branch is newest?
  gh api "repos/msm8953-mainline/linux/branches?per_page=100" \
    --jq '.[].name' | grep -E '^[0-9]+\.[0-9]+' | sort -V | tail -5
  ```
- **A personal `fork/master` mirror goes stale** while upstream moves on. Re-sync
  before using it as a base; never rebase onto a stale mirror.

---

## Where the work can actually go

Three possible destinations, and for AI-assisted work only one of them is open.
Establish this **before** shaping any branch, because it sets the base, the
mechanics, and whether the effort is worth spending at all.

| destination | AI-assisted work | verdict |
|---|---|---|
| postmarketOS (pmaports, wiki) | banned outright, CoC-enforced | closed |
| msm8953-mainline (GitHub PR) | "we don't merge AI assisted work" | closed |
| mainline Linux (LKML) | permitted **with disclosure** | **the path** |

### Why msm8953-mainline is closed (do not re-litigate it)

Stated by the maintainer barni2000 in
[issue #197](https://github.com/msm8953-mainline/linux/issues/197), 2026-07-25:

> "FP3 is using different audio architecture and we don't merge AI assisted work,
> it is only allowed at upstream."

That is **two independent refusals**, and the first one applies even to
non-AI-assisted FP3 audio work:

- **The architecture point is correct and verifiable.** Every other msm8953/sdm632
  device in the tree uses the SoC-internal `qcom,msm8916-wcd-digital-codec` plus
  the PMIC-internal `qcom,pm8916-wcd-analog-codec` (in `pm8953.dtsi`) over
  **MI2S**. The FP3 is the **only** one with an external **WCD9335 on SLIMbus**.
  Their MBHC lives in `msm8916-wcd-analog.c`; ours lives in `wcd9335.c` — different
  driver, register map and bus. The fork has no device that would even exercise
  our code, so merging it would mean carrying untestable code.
- **The AI point is a project rule**, not a kernel rule. Accept it and move on.

Practical consequence: **do not open PRs against `7.1.3/main`.** Anything in this
skill that reads like PR preparation (base `origin/7.1.3/main`, GitHub flow) is
retained only for the day a *non*-AI-assisted, architecture-relevant change is
ready — e.g. the charger or camera work, if it were rewritten without assistance.

### The open path: patch series to LKML / the subsystem maintainer

- Sent by **email** (`git send-email`), plain-text patches, to the subsystem lists.
- **Base per subsystem:** driver/machine patches on the subsystem's `-next`
  (for ASoC that is Mark Brown's `sound/for-next`); DTS patches on fresh torvalds
  mainline (routed to `linux-arm-msm` + the qcom DT maintainers via
  `get_maintainer.pl`).
- **AI provenance is a documented requirement, not an open question** — see
  "Authorship and provenance" below. Two in-tree documents govern it and both must
  be satisfied: `coding-assistants.rst` (the `Assisted-by:` trailer, no AI
  `Signed-off-by`) and `generated-content.rst` (disclose what the tool did, in the
  cover letter).

**The audio series is a genuinely good upstream candidate**, and better than it
looks from inside the FP3 project. `wcd9335.c` in mainline has **no jack
registration at all** — no `snd_soc_jack`, no `set_jack`, nothing. That gap affects
every WCD9335 board in the tree, not just the FP3:

```
apq8096-db820c.dts              <- DragonBoard 820c, a reference board
msm8996-oneplus-common.dtsi     <- OnePlus 3 / 3T
msm8996-xiaomi-common.dtsi, -gemini.dts
msm8996pro-xiaomi-natrium.dts, -scorpio.dts
sdm632-fairphone-fp3.dts
```

Lead with that framing, not with "this fixes my phone".

All destinations share the three shaping rules below.

---

## The three maintainer rules (verbatim intent)

These came directly from the msm8953-mainline maintainer and **override any
instinct to over-split**:

### 1. One branch per subsystem — not sub-split within it

Separate branches for **camera, charger, audio, modem** are fine and expected.
Splitting *audio* into several submission branches
(`wcd9335-txfe`, `wcd9335-mbhc`, `wcd9335-dmic`, …) is "too complicated and not
useful" — do **not** do it. One series carries the whole audio story for one
tree — several `upstreaming/*` series exist only when the *trees* differ (the
codec work to ASoC, the board DTS to the SoC tree, an I²C fix to i2c), never to
sub-split within a tree.

### 2. Reduce the number of commits per task

The fork's topic branches accumulate one commit per thing you learned. When the
change is *fixing existing code*, collapse those discovery steps into few,
well-formed commits. Fifteen incremental commits become a handful of logical ones.
Keep a genuinely standalone bugfix as its own commit (so it can carry `Fixes:`),
but squash the "and then I also had to…" follow-ups into their final form. The
other wall of the corridor: **do not over-split either** — the process guide's
example is a developer who sent 500 patches for edits to one file, and a single
patch may be large as long as it is one *logical* change.

### 2a. Ordering a split so that every patch builds on its own

When one commit has to become three — the usual shape being *refactor →
implementation → API* — the order is not a matter of taste. It is decided by
what each intermediate tree must compile to, and the obvious order is usually
wrong.

Worked example: making a shared file take a second backend behind a function
table. The tempting order is refactor → make the choice a parameter → add the
second implementation. It does not work: the middle patch gives callers an
argument whose only interesting value nothing implements. Swap the last two and
the middle patch adds a `static const` table that nothing selects, which is dead
code and warns.

What works is **refactor → implementation → API**:

1. introduce the table and populate it with the *existing* code, selected
   unconditionally. No functional change, and say so in the message — a reviewer
   who trusts that sentence reads the patch in a minute.
2. add the second implementation, selected from whatever internal state already
   decides the behaviour, even if that state is still a constant. Reachable, so
   no dead-code warning; inert, so no behaviour change.
3. turn that internal state into the API argument, and update every caller in
   one small mechanical patch.

The general rule the example illustrates: **each patch may only widen what the
code can express, never leave a gap between an expression and its meaning.**
Ordering it this way also puts the patch that touches *other people's drivers*
last and smallest, which is where you want the reviewer's risk to be.

Check it rather than reasoning about it — build every intermediate commit, not
just the tip. And the bar is higher than compiling: *"Each patch should yield a
kernel which builds and runs properly; if your patch series is interrupted in the
middle, the result should still be a working kernel"* — `git bisect` applies a
series partially by definition. The same reasoning forbids the other tempting
shape, ☠️ **infrastructure added by one patch and left unused until a later one**:
*"if that series adds regressions, bisection will finger the last patch as the one
which caused the problem, even though the real bug is elsewhere."*

### 2b. Split the import from the invention, and make the import traceable

Two rules, and the first one is structural:

☠️ **First, decide whether the code may be imported at all — "downstream" is not
one category.** Code from another *mainline-oriented* tree (a fork like
`msm8953-mainline`, a posted-but-unmerged series, another device's driver) is
importable, and the rules below say how to attribute it. **Vendor/Android
downstream code is not**, and the postmarketOS mainlining guide states the
consequence plainly: *"Do not attempt to copy any code as-is from downstream. In
general this won't work, and most importantly: it won't be accepted for inclusion
into the mainline kernel upstream. Instead, try to understand what the downstream
code does, and rewrite it from scratch for mainline by looking at similar code."*
☠️ **The same applies to the device tree, and the reason is worth keeping**: *"Do
not take the downstream device tree as a base or even copy it as-is. That is the
wrong approach. Downstream code tends to be full of mistakes and unnecessarily
verbose. It's easier to start from scratch and rather take something in mainline as
a base."* Start from a mainline board DT of the same SoC and add what you have
*measured*; the downstream DT tells you which pin and which supply, not what your
node should look like.

So a vendor tree is evidence — register sequences, magic values, which pin does
what — and its *findings* are citable
([provenance](#2b-split-the-import-from-the-invention-and-make-the-import-traceable)
covers how). Its *code* is not a source you copy from, and a patch that reads like
BSP code will be sent back regardless of how well it is attributed.

**Never mix imported code and new work in one commit.** If a patch carries
somebody else's code *and* your addition to it, the reviewer cannot see which is
which, `git blame` credits you for their lines, and a revert takes out both. So:
one commit that brings the foreign code in, unchanged and attributed; a second
commit that changes it. The pair also documents itself — the diff of the second
commit *is* the answer to "what did you actually do?".

**Cite an import so it can be found without you.** A cherry-pick across repos
loses the original SHA, the author and the date; git records only that *you*
committed it. Reconstruct all of it in the message:

```
The driver comes from <repo URL>, branch <branch>, commit <sha> ("<subject>"),
authored by <name(s)> on <YYYY-MM-DD>; it is not in Linus' tree.
```

Take the fields from the source, never from memory:
`git log -1 --format='%H %an <%ae> %ad %s' --date=short <ref>`. Where the source
is a mailing-list series rather than a repo, `Link:` the cover letter instead of
the SHA. Keep the original copyright and `MODULE_AUTHOR` lines in the file, and
say in the message that you did — and where the code is *substantially* still
theirs, the honest move is to keep **them** as the patch author
(`git commit --author`) and describe your changes in the follow-up commit.

Then, for your own commits, a provenance paragraph splitting the change three
ways:

| kind | how to say it |
|---|---|
| **taken from someone** | name the source concretely enough to check: whose tree/driver/DT, which file, which node or function. "Qualcomm's downstream `pmi632.dtsi`, where the same channel appears as `chan@4a`" — not "from downstream" |
| **reused from the tree** | say the mechanism was already there and you only pointed at it. "reuses `SCALE_HW_CALIB_THERM_100K_PULLUP`, already used by the AMUX_THM channels" |
| **new here** | say so plainly, and what it was modelled on if anything. "new here, modelled on this driver's existing `vbat_chan` handling — same optional `devm_iio_channel_get()`, same `-EPROBE_DEFER` passthrough" |

☠️ **"New here" is a claim about the whole tree, so search the whole tree before
making it.** The three categories are not a matter of where you personally got
the idea — they are a matter of what already exists. A property name, a symbol,
a helper or a binding can be established somewhere you never looked, most often
under a *different* subsystem or a sibling chip's schema, and a driver reading
an undocumented property tells you nothing about whether the name is documented
elsewhere. The check is one grep of the entire source tree — not of the file, the
driver, or the binding you are editing:

```sh
git grep -n '<the exact name>'            # every user, every schema, every doc
```

Read the whole result before writing the paragraph. If any hit is a binding, a
header or another driver, the change is **reused from the tree**, and the honest
form names that prior art and follows its spelling and wording rather than
inventing a parallel one. Two schemas describing the same property in different
words is a defect you introduced.

Why it matters more than it looks: a false "new here" is invisible at review —
it reads as ordinary, and it quietly tells the reviewer there is no prior art to
be consistent with, which is exactly the thing they would otherwise check. It
also survives: the wrong category gets copied into the docs organised by the
same split. The cost of the grep is seconds; the cost of being wrong is a patch
that argues against a convention it did not know it was breaking.

Why this is worth the lines:

- **it separates the trustworthy from the guessed.** A vendor-sourced number and
  a number read off an oscilloscope carry different risk, and only the commit can
  record which this is;
- **it front-runs the objection.** Where you knowingly took an approximation —
  the generic thermistor curve instead of the vendor's per-pack table — say so,
  with the measured size of the error and what it is therefore *not* good enough
  for. A reviewer who finds that themselves reads it as a bug; a reviewer who is
  told reads it as a judgement call;
- **the person reading your patch may be the person you took it from.**

Trailer forms, the DCO rules and the four citation situations are in
[Authorship and provenance](#authorship-and-provenance); the repo's
`docs/kernel/README.md` and `docs/sensors/README.md` are organised by the same
three-way split, so keep the commit and the doc saying the same thing.

### 3. Never mix DTS with driver code in one commit

`.c`/`.h` (driver/logic) and `.dts`/`.dtsi` (board wiring) go in **separate
commits**. See the next section for why — this one is non-negotiable and is the
single most common thing that gets a series bounced.

---

## Why DTS is separate from driver code

- **DTS = Device Tree Source** — data, not code. It describes *what hardware is on
  this board and how it is wired* (which chips, at which register address / IRQ /
  GPIO / clock / regulator / bus address, what each pin does). The kernel reads it
  at boot. It is board-specific: "on the FP3 the WCD9335 is on SLIMbus, these are
  the mic-bias supplies, these the MBHC thresholds."
☠️ **The split is a rule about *facts*, not only about file extensions.** A commit can
keep `.c` and `.dts` perfectly apart and still put a board's fact inside the driver — a
current ceiling, a threshold, a timing — usually as a constant in a per-variant table,
which looks like driver data and is not. Before adding *any* constant to a driver, name
whose fact it is: SoC, PMIC, board, battery, or this one phone. Only the first two may
live in the driver, and only if a datasheet or a register width backs them. "What I am
willing to allow" is policy, it belongs to whoever describes the board, and putting it
in shared code is how one device's caution silently becomes every device's ceiling.
The check, before writing rather than at review: **applied to every board this file
serves, is each of them still described correctly?**

- **Driver (`.c`/`.h`) = the logic** that works on *any* board that has the chip.
  `wcd9335.c` knows how to drive the codec whether it sits in an FP3 or a
  DragonBoard.
- They must be separate commits because:
  1. **Different maintainers / trees.** Driver → ASoC (Mark Brown); DTS →
     qcom/SoC (`linux-arm-msm`). A mixed commit cannot go to both trees.
  2. **Different merge/backport cadence.** A driver fix may go to `stable`; the DTS
     change may not. Separable only if separate commits.
  3. **Bisect / readability.** A regression hunt is cleaner when a commit is either
     "the logic changed" or "the hardware description changed", not both.
  4. **Reuse.** The generic driver change helps other boards; the DTS helps only
     the FP3. Kept apart, the driver can be upstreamed on its own.

Rule of thumb: **`.c`/`.h` in one commit, `.dts`/`.dtsi` in another — never
together.**

---

## How finely to split the DTS commits

Separating DTS from driver is only half of it — the DTS changes themselves have a
granularity convention, and it depends on whether the board is new or existing:

- **New device (the `.dts` does not exist yet):** put all the working nodes into
  **one commit**, conventionally titled *"arm64: dts: qcom: <soc>-<board>: add …"*
  (an "initial dts"). You are not enabling one feature at a time; you are landing
  the board.
- **Existing device (the `.dts` is already in mainline) enabling new features:**
  add a **separate DTS commit per feature/subsystem** — one for audio, one for
  charger, one for camera, one for modem, and so on. Do **not** fold different
  subsystems' DTS wiring into a single commit.

The FP3 is the **existing-device** case: `sdm632-fairphone-fp3.dts` is already
upstream, so each subsystem enables its hardware through its **own** per-subsystem
DTS commit. Keep the **audio DTS commit and the modem DTS commit separate**, even
when unsure whether they could be combined — the per-feature split is the safe
default.

### Only what is real and measured goes into the DTS

A frequent review verdict, and it is narrower than it first sounds. Two rules that
look alike are in play, and only one of them is "the driver does not use it".

**The rule that does apply — no dead node.** A node whose only purpose is to make
Linux bind a driver is rejected, in the bindings and in the DTS both:

- `writing-bindings.rst`: *"DON'T create nodes just for the sake of instantiating
  drivers. Multi-function devices only need child nodes when the child nodes have
  their own DT resources."*
- Krzysztof Kozlowski, reviewing a venus binding, 2024-11-25: *"Both nodes are
  useless - no resources here, nothing to control. Do not add nodes just to
  instantiate Linux drivers."*
  (<https://lore.kernel.org/all/474cef98-4644-4838-b07c-950ad7515b73@kernel.org/>)
- Same reviewer on an untested new SoC dtsi, 2024-12-16: *"We do not add dead code
  to the kernel. You need users."*
  (<https://lore.kernel.org/all/bx3r4cs3oklfduvkg65vke3clb3fc6sseske2ellq27ifpmsnm@msz6iqvjwufn/>)
- Geert Uytterhoeven, 2021-05-17: *"Please do not add nodes not matching the
  hardware description."*

So: a node with no `reg`/`interrupts`/clocks/supplies of its own — nothing to
address and nothing to control — is not a hardware description, it is driver
plumbing wearing a DT costume. Drop it and fix the driver's probe instead.

**The rule that does *not* apply — "the driver has no support yet".** The same
document says the opposite for that case: *"DO attempt to make bindings complete
even if a driver doesn't support some features. For example, if a device has an
interrupt, then include the 'interrupts' property even if the driver is only
polled mode"*, and *"DON'T refer to Linux or 'device driver' in bindings.
Bindings should be based on what the hardware has, not what an OS and driver
currently support."* Real hardware that Linux cannot yet drive is still real
hardware. ☠️ Do not "clean up" a correct description because nothing consumes it
yet — that is deleting a fact. Dmitry Baryshkov, reviewing a qcom DTS in 2026-04
and asked why a property should be there if the driver ignores it: *"DT describes
the hardware. The driver behaviour is not that relevant here."*

**Where the two meet is `status`.** `dts-coding-style.rst` gives `status` exactly
this job: *"Status is the last information to annotate that device node is or is
not finished (board resources are needed)"* — the SoC DTSI carries the node
`status = "disabled"`, and the board DTS that has actually wired the thing up
flips it to `"okay"` and adds the board's supplies, GPIOs and pinctrl. Hence the
practical form of the review comment: **a node you have not made work does not
appear enabled in your board DTS.** Either it stays disabled in the SoC DTSI where
it belongs, or it is not in this series.

That is also the live disagreement, not a settled rule, so cite the shape rather
than assert the law: on ipq9574, Manivannan Sadhasivam argued every PCIe instance
should be described and the unused ones left disabled, while the submitter
objected that *"someone may think it's supported, try to enable it on their board,
and run into issues"* (<https://lkml.rescloud.iu.edu/2404.2/04197.html>). Both
positions agree on the part that matters here: **enabled means tested.**

**How this lands on an FP3 series.** Before sending a DTS commit, for every node
and property it adds or enables, answer three questions:

1. *Does this hardware exist on this board?* — if no, it does not go in at all.
2. *Did I measure it working on the device, or is it inherited from the downstream
   tree because it was there?* — anything only inherited is either dropped or
   left `disabled`; the "initial dts" convention above says **working** nodes.
   A vendor DTS is a source of hypotheses, not of facts.
3. *Is this a hardware fact or my policy number?* — the same test as the
   driver-constant trap above.

And remember the DTS is an ABI other software reads: a wrong description does not
merely fail to work, it gets consumed by a bootloader or another OS and then
cannot be changed freely.

**The instrument.** "Does this node actually live?" is measurable, not a matter of
opinion — a DT node with a `compatible` and no bound driver shows up as an empty
`driver` link in sysfs, which is what the in-tree kselftest
`tools/testing/selftests/dt/test_unprobed_devices.sh` automates. On the device:

```sh
# enabled DT nodes carrying a compatible (two levels deep; widen the glob for
# deeper buses such as the SLIMbus/I2C children)
for n in /sys/firmware/devicetree/base/*/*; do
        [ -e "$n/compatible" ] || continue
        [ ! -e "$n/status" ] || grep -qa 'okay\|ok' "$n/status" || continue
        printf '%s\t%s\n' "${n#/sys/firmware/devicetree/base/}" \
                "$(tr -d '\0' < "$n/compatible")"
done
# and the other side: which platform devices never got a driver
for d in /sys/bus/platform/devices/*; do
        [ -e "$d/of_node" ] && [ ! -e "$d/driver" ] && echo "unbound: ${d##*/}"
done
```

An `unbound:` line for a node this series adds is the reviewer's objection,
found before the reviewer finds it.

### Measured against mainline, not asserted

The rules above were checked against the actual commit history of qcom device
trees in `torvalds/linux`, not inferred from the FP3 alone. What the history
shows:

**The FP3's own upstream `.dts` history is the textbook case** — an initial commit
landing the board, then one commit per feature, in the settled naming form
`arm64: dts: qcom: sdm632-fairphone-fp3: <verb> <thing>`:

```
arm64: dts: qcom: sdm632: Add device tree for Fairphone 3   <- initial dts, one commit
arm64: dts: qcom: sdm632: fairphone-fp3: add touchscreen
arm64: dts: qcom: sdm632-fairphone-fp3: Add NFC
arm64: dts: qcom: sdm632-fairphone-fp3: Add notification LED
arm64: dts: qcom: sdm632-fairphone-fp3: Enable WiFi/Bluetooth
arm64: dts: qcom: sdm632-fairphone-fp3: Enable LPASS
arm64: dts: qcom: sdm632-fairphone-fp3: enable USB-C port handling
arm64: dts: qcom: sdm632-fairphone-fp3: Enable vibrator
arm64: dts: qcom: sdm632-fairphone-fp3: Enable modem
arm64: dts: qcom: sdm632-fairphone-fp3: Enable display and GPU
arm64: dts: qcom: sdm632-fairphone-fp3: Add camera fixed regulators
arm64: dts: qcom: sdm632-fairphone-fp3: Enable CCI and add EEPROM
```

**The canonical "add audio to an existing board" commit** is
`b7b734286856 ("arm64: dts: qcom: sdm845-oneplus-*: add audio devices")`: the
entire audio wiring for the OnePlus 6 and 6T — sound card, DAI links, codec,
speaker/headphone routing — as **one commit**, 266 added lines across three
`.dts`/`.dtsi` files, **zero driver files**. That is exactly the shape the audio
DTS commit should have.

Three refinements the FP3 history forces on the rule as stated above:

1. **A subsystem may legitimately span more than one DTS commit** when there are
   distinct logical steps. Camera took two — *"Add camera fixed regulators"* then
   *"Enable CCI and add EEPROM"*. So the rule is really **one logical step per
   commit**; "one per subsystem" is the common case, not a ceiling. Do not
   artificially weld two genuinely separate steps together to hit a count.
2. **Closely-related blocks may share a commit** when they are enabled by the same
   act — *"Enable display and GPU"*, *"Enable CCI and add EEPROM"*. The test is
   whether they are one hardware-enablement story, not whether they are one
   subsystem.
3. **Style and cleanup never ride along with functional changes.** They get their
   own commits: *"Move status properties last"*, *"Add newlines between regulator
   nodes"*. If a reviewer asks for reformatting, that is a separate patch.

   ☠️ **But a style fix to a line YOUR OWN series adds belongs in the commit that
   adds it, not in a later one.** On a wip branch the natural order is the
   discovery order — write the code, run `checkpatch` later, fix what it found in
   a fresh commit. Distil that verbatim and every earlier patch is unclean *on its
   own* while the final tree is perfectly fine, which is exactly the view a
   reviewer has: they read patch 3, not your tree. Run `checkpatch` **per patch**
   (`checkpatch.pl *.patch`, one file at a time) and attribute each complaint to
   the patch that introduced the line; if a later patch in your series is the one
   that fixes it, you have found churn, not a clean series.

   ☠️ **And do not "fix" the neighbours.** `checkpatch` only complains about lines
   you add, so pre-existing code alongside yours is not your problem — realigning
   it is drive-by churn on files the series does not otherwise touch. Where your
   new lines and the old ones then disagree, match the *checker*, not the
   neighbour: new code should pass, and inconsistency with untouched code is the
   tree's, not yours. (Measured once: nine realigned `SOC_SINGLE_S8_TLV` lines
   that had been in mainline for years, riding inside a jack-detection patch.)

**Verb convention** (visible throughout the history above): **"Enable X"** when the
node already exists in the SoC `.dtsi` and the board turns it on / wires it up;
**"Add X"** when the commit introduces a new node. The FP3 audio work is the former
— `Enable LPASS` already landed, so the WCD9335 commit follows that lineage.

Re-verify rather than trusting this snapshot; conventions drift. Note that the
local fork checkout is **shallow** (`git log` on a path returns a single commit),
so mine the history over the API instead:

```sh
# per-board dts history, straight from mainline
gh api "repos/torvalds/linux/commits?path=arch/arm64/boot/dts/qcom/<board>.dts&per_page=100" \
  --jq '.[] | .commit.message | split("\n")[0]'

# what did a given dts commit actually touch?
gh api repos/torvalds/linux/commits/<sha> \
  --jq '"files: \(.files|length) +\(.stats.additions)/-\(.stats.deletions)", (.files[].filename)'
```

Note this refines "reduce the number of commits" for DTS: it means *per logical
step*, not *everything in one*. Within the audio branch, all the audio `.dts`
wiring is a single commit unless it contains two genuinely separate enablement
steps; it must never absorb charger/camera/modem DTS.

---

## Tracking the submissions — the `upstreaming/` namespace and the one status page

Everything below this heading is *method*; the current answer to every command in
it lives in
[`fp3-pmaports/docs/upstreaming/STATUS.md`](https://github.com/llg179org/fp3-pmaports/blob/main/docs/upstreaming/STATUS.md).
A submission is a months-long, many-round mail exchange per series, several
series in flight at once, foreign series they wait on, and a device test behind
every version — that is too much state to keep in prose, in a chat, or in
memory. This section says where it is kept and what shape it has, so that a
session on any machine can pick the work up from the page alone.

### ☠️ The gate: run this when the skill loads, before any series work

A fresh checkout or a fresh machine has none of the scaffolding. Check, do not
assume, and treat anything missing as the *first* task — a series prepared
without the page is a series whose review rounds will be lost.

```sh
# 1. the tracking page exists and has the fixed header (see the template below)
test -f docs/upstreaming/STATUS.md && grep -q '^| series | category | tree |' docs/upstreaming/STATUS.md \
  || echo "MISSING: docs/upstreaming/STATUS.md — create it from the template"

# 2. b4 is installed (the series tool; git send-email alone loses the trailers/versions bookkeeping)
b4 --version >/dev/null 2>&1 || echo "MISSING: b4 — pipx install b4   (or apk add b4)"

# 3. the review-tracking plugin for foreign series we depend on
ls ~/.claude/plugins 2>/dev/null | grep -qi kernel-review || echo "MISSING: jlelli/claude-kernel-reviews plugin (/plugin marketplace add jlelli/claude-kernel-reviews)"

# 4. the series branches use the upstreaming/ namespace, not submit/
# ☠️ no glob, or '**' — for-each-ref matches a single '*' with WM_PATHNAME, so it
# does NOT cross a '/', and every legacy branch is submit/<base>/<cat>, two deep.
# Measured 2026-09-03: 'refs/heads/submit/*' printed 0 while 7 such branches existed,
# i.e. the check reported a clean namespace unconditionally.
git -C <fork> for-each-ref --format='%(refname:short)' refs/heads/upstreaming refs/remotes/fork/upstreaming | head
git -C <fork> for-each-ref --format='%(refname:short)' refs/heads/submit | grep -q . \
  && echo "LEGACY: submit/* branches still present — tag them archive/submit-<base>-<cat>-final and stop using them"

# 5. the merge window is not open (never answer this from the tag list)
curl -s https://www.kernel.org/releases.json | python3 -c \
  'import json,sys; r=[x for x in json.load(sys.stdin)["releases"] if x["moniker"]=="mainline"][0]; print(r["version"], r["released"]["isodate"])'
```

☠️ **Run every gate command against a case it must catch before trusting a clean
answer.** Item 4 above shipped for weeks in a form that could never fire (see the
comment in it), and item 5 has a sibling trap of the same shape. A gate that has
not been shown failing has proved nothing — the same rule the private CLAUDE.md
records for the `curl -sL` tarball check.

Item 5: a version containing `-rc` means the rc phase is running and sending is
allowed; a bare `vX.Y` means the merge window has just opened — wait. ☠️
`git ls-remote --tags … | sort -V | tail` looks like the same check and is wrong
in the direction that always reads "safe": version sort puts `v7.2` *before*
`v7.2-rc1`, so the last line is an `-rc` tag whether the release is out or not.

### The branch namespace: `upstreaming/<series>` replaces `submit/<base>/<cat>`

The `submit/<base>/<category>` layout mirrored *our* bring-up categories. Upstream
does not split that way: it splits by **subsystem and maintainer tree**, and one
of our categories can feed several trees (a codec binding to ASoC, a board `.dts`
to the qcom SoC tree, an I²C fix to the i2c tree). So the unit of submission is
the **upstream-shaped series**, and the branch is named after it, not after us:

```
upstreaming/<series>          the branch being prepared — a b4 prep branch
upstreaming/<series>/v<N>     a tag on the exact commits of round N, made at send time
```

Rules that follow:

- **`<series>` is a short, tree-flavoured slug** (`<driver>-<topic>`, `<board>-dts`),
  chosen by asking `get_maintainer.pl` which tree it goes to. If two candidate
  series answer with the same tree and maintainer, they are probably one series.
- **The board DTS is always its own series, sent last**, and its dependency list
  names every driver/binding series it needs — the DTS cannot be applied until
  those have landed (`maintainer-soc.rst`), and a DTS that fails `dtbs_check`
  because its binding is not yet in the tree gets reverted.
- **`wip/<base>/<cat>` stays the source of the work; `upstreaming/` is the only
  thing that holds send-shaped commits.** The old `submit/<base>/<cat>` branches
  are retired: tag each `archive/submit-<base>-<cat>-final` (they are the only
  ref for their commits — see "Regenerating a submit branch orphans its old
  commits") and delete the branch.
- **The distillation rule changes shape but not meaning.** With one series per
  category, `git diff wip/… submit/…` had to be empty. With upstream-shaped
  series, the check is that the *union* of every `upstreaming/*` series drawn from
  a category reproduces the category's content, measured as a line set, plus a
  named list of what was deliberately left out (a hack you will not defend, a
  file that does not exist upstream). Keep that list on the STATUS page, not in a
  commit message.
  ```sh
  # the lines a category carries that no series carries (and vice versa)
  git diff <base>/main wip/<base>/<cat> -- <paths> | grep '^[-+]' | sort > /tmp/wip.l
  for s in <series…>; do git diff <base-of-s> upstreaming/$s -- <paths>; done | grep '^[-+]' | sort > /tmp/up.l
  comm -3 /tmp/wip.l /tmp/up.l
  ```
- **Every sent round is a tag, never a branch rewrite without one.** `b4 send`
  rewrites nothing, but you will rebase the prep branch for v(N+1); the tag is what
  keeps `lore` links and the STATUS page's "what exactly was sent" answerable.

### `b4` is the mechanism, not an optional convenience

`git format-patch` + `git send-email` produce a correct v1 and lose everything
after it: which trailers arrived, what changed between versions, what the base
was. `b4 prep` keeps that state on the branch itself (in an empty cover commit),
so the commands are the bookkeeping:

```sh
b4 prep -n <series> -f <base-commit-or-tag>     # start: creates upstreaming/<series> (name it so; b4's default prefix is b4/)
b4 prep --edit-cover                            # cover letter; the changelog goes under the --- line
b4 prep --auto-to-cc                            # get_maintainer + recent committers of the touched files
b4 prep --check                                 # checkpatch etc. on every patch
b4 prep --edit-deps / --check-deps              # a foreign posted prerequisite (see "A dependency that was posted…")
b4 send --reflect                               # dry run to yourself; git am it back before the list sees it
b4 send                                         # the real send; note the message-id it prints
git tag upstreaming/<series>/v$(b4 prep --show-revision)
b4 trailers -u                                  # after review: pull Reviewed-by/Tested-by/Acked-by from lore, never from memory
b4 prep --manual-reroll                         # bump to v(N+1) after the changes are made; the cover keeps the per-version changelog
```

☠️ Two b4 defaults to override: it names the branch `b4/<series>` (rename to
`upstreaming/<series>` so the namespace rule above holds), and `--auto-to-cc`
will happily add `stable@vger.kernel.org` if a `Cc: stable` trailer exists —
that trailer is a decision (a user-visible bugfix), not a default.

### `docs/upstreaming/STATUS.md` — the page, and what a session may write to it

One file, English, no prose beyond a field's value. A header table with one row
per series, then one section per series in a fixed shape, then the dependency
list. The analysis of *why* something is blocked stays in
`docs/upstreaming/README.md` and the `leads/`; the page only links to it.

**Header table** (one screen, the thing you open first):

```
| series | category | tree | patches | state | last round | ball with | next from us | updated |
```

**Per-series section** — exactly these blocks, in this order:

```
## <series>

Category:    <audio|voice|camera|charger|sensor|power>      ← our bring-up area, so the wip source is findable
Tree:        <subsystem>, <maintainer branch> — <maintainers>; CC <lists>
Source:      upstreaming/<series>   sent rounds: upstreaming/<series>/v1, /v2 …   (ONLY the send-shaped branch; wip is implied by Category)
Depends:     D-<n>, D-<m> | –                                   ← entries in the dependency list at the end of the page

Test:
  branch:    <the branch the functional run booted, e.g. debug-int/<base> with the series rebased in> @ <sha>
  device:    <which FP3, which slot>
  battery:   fp3-selftest <date>, <ok>/<failed> → <link to the capture directory>
  checkers:  checkpatch · W=1 · sparse · dt_binding_check · dtbs_check · allmodconfig · linux-next@<tag>   (✓ / ✗ / – with the date)

Rounds:
  | v | date | lore | reply (who, when) | asked for | handled |
  | 1 | …    | https://lore.kernel.org/r/<msgid> | … | a, b, c | a ✓ · b ✓ · c disputed (link) |

To do:
  - [ ] …
Done:
  - <date>  …
```

**Dependency list** (end of page): `D-<n>` — what it is, author and date,
patchwork/lore link, its state, and *what it needs from us* (a Tested-by, a
comment on the thread, our own patch posted into it). Series refer to these by
number in `Depends:`.

**State vocabulary**, and the evidence that lets a series move:

| state | may be written only with |
|---|---|
| `preparing` | the branch exists |
| `rebased` | a trial rebase onto the destination tree, and its `base-commit:` |
| `tested` | the Test block filled: a booted branch, a battery result, the checker line — all with links |
| `sent v<N>` | the lore link of **our own** mail, and the `upstreaming/<series>/v<N>` tag |
| `review` | at least one reply row in Rounds |
| `applied` | the lore link of the maintainer's "Applied…" mail |
| `-next` | the commit's sha in the maintainer's `-next` branch |
| `mainline v<X.Y>` | the release tag that contains it |
| exits: `rejected`, `unsendable`, `merged-into <series>` | a link to the reply, or the reason on the README |

Four rules that keep the page true:

1. **No state change without its evidence link.** The table above is the whole
   rule; a state written from memory is the fabrication risk
   [Factual integrity](#factual-integrity--overrides-everything-below) describes,
   in a different column.
2. **Every row is dated with the date of the evidence, not of the edit**, and the
   header's `updated` is the newest such date.
3. **The merge-window state is never written into the page** — it changes weekly;
   the `releases.json` command in the gate is run before every send instead.
4. **The Rounds table decides whether v(N+1) may go out**: every "asked for" item
   of the last row is either handled or disputed with a lore link. A version sent
   with an open item is a version the reviewer will send back.

### Tracking the foreign series with the review plugin

The dependency list's `D-` entries are somebody else's threads. Track them with
`jlelli/claude-kernel-reviews` rather than by re-reading lore:

```sh
mkdir -p .claude/tracked-series          # in the kernel checkout
/track <message-id-of-the-cover>         # once per D- entry
/status                                  # the plugin's view; copy state changes into STATUS.md with the lore link
/update <series-name>                    # when a new version of the foreign series appears
```

The plugin is a *reviewer's* tool and knows nothing about our own submissions —
our side is the STATUS page, theirs is `/status`. Do not try to make one do the
other's job.

### The list-cycle traps that are not elsewhere in this skill

Each of these is a way a correct series loses a round. They map onto STATUS
columns so the page catches them before the list does.

- **One version per review round, never one per comment.** Collect every reply,
  wait at least a day after the last one, then send v(N+1). Mark Brown's
  standing rule for ASoC: further changes after a patch is applied go as
  *incremental* patches against the tree, not as a replacement.
- **`RESEND` means byte-identical.** It is for a version the list never saw
  (bounced, wrong address, ignored for weeks), not for a modified one — a
  modified one is v(N+1) with a changelog.
- **The changelog goes under the `---` line** of the cover letter or of each
  patch, and says what changed *per version*; it is not part of the commit
  message. `b4 prep --edit-cover` keeps it there.
- **Carrying tags forward is the sender's job.** A `Reviewed-by:` given on v1
  travels to v2 (if the patch did not change materially); one that was *not*
  given never appears — `b4 trailers -u` and nothing else decides which is which.
- **No content-free pings; resend instead, after two weeks or more.** A ping
  cannot be reviewed; a resend can. Longer during a merge window.
- **The 0-day robot (`kernel test robot`, `lkp@intel.com`) is a reviewer.** It
  builds the series on other architectures and configs and replies on the thread;
  a report is a Rounds row like any other, and the fix goes into v(N+1) with the
  `Reported-by:` it asks for. Pre-empt it: `allmodconfig`, `W=1`, and a build on
  the latest `linux-next` tag belong on the Test checker line.
- **A DTS series is sent last and names what it waits for.** Its `Depends:` is
  every driver/binding series it needs; sending it earlier costs a revert.
- **Tags naming a person need that person's permission**, except `Cc:`,
  `Reported-by:` and `Suggested-by:`; and `Assisted-by:` is written as
  `Assisted-by: Claude:<model-id> [tool] [tool]`, listing only the analysis tools
  actually run (sparse, coccinelle, smatch — not git, gcc or make).

---

## Reshaping a wip branch into a series

The audio branch is the standing example, and the *shape* of the reshape is the
transferable part. **The commits themselves are not written down here** — a wip
branch is rebased, squashed and rebuilt continuously, and an earlier revision of
this section carried three literal hashes and an eight-item series that had all
ceased to exist within weeks. What the current series is belongs in
[`fp3-pmaports/docs/`](https://github.com/llg179org/fp3-pmaports/tree/main/docs);
what follows is how to get there.

**Measure the branch first, never recall it.** Two questions, two commands:

```sh
# how many commits, and what are they?
git log --oneline <base>..wip/<base>/<cat>

# which of them MIX dts with driver code? (the ones that must be split)
git log --format='%h %s' <base>..wip/<base>/<cat> | while read h s; do
  f=$(git show --name-only --format= "$h")
  echo "$f" | grep -q '\.dtsi\?$' && echo "$f" | grep -qE '\.[ch]$' \
    && echo "MIXED $h $s"
done
```

**Then reshape to this shape**, on the subsystem's `-next` and not on
`<base>/main`, since LKML is the destination:

1. **driver commits first, DTS last.** Every `.dts` hunk in the branch —
   including the halves cut out of the mixed commits — collects into the trailing
   board commit, unless the board genuinely has two separate enablement steps.
2. **one commit per logical change, not per thing you learned.** Discovery order
   is the wip branch's job; the series is ordered by what a reviewer needs to read
   in sequence.
3. **an imported file lands unchanged in its own commit**, with your changes to
   it in the next one — see §2b.
4. **a standalone bugfix stays standalone**, so it can carry `Fixes:` and, where
   it applies, `Cc: stable`.

The result is *n* driver commits plus one DTS commit, one branch, nothing mixed.
Rebuilding the series is cheap and rebuilding it is the norm: regenerate from
`wip`, never hand-edit `submit`.

---

## Splitting a mixed commit in practice

Don't fight `git` to bisect a mixed commit — rebuild it. Cherry-pick without
committing, drop the wrong-domain files from the index, commit the rest, and
gather all the DTS hunks into the final DTS commit:

```sh
git checkout -b upstreaming/<series> <base>    # sound/for-next for ASoC drivers; or let `b4 prep -n` create it

git cherry-pick -n <mixed-sha>                 # stage everything, don't commit
git restore --staged arch/arm64/boot/dts/qcom/sdm632-fairphone-fp3.dts
git checkout -- arch/arm64/boot/dts/qcom/sdm632-fairphone-fp3.dts   # driver-only left
git commit -s -m 'remoteproc: qcom_q6v5_pas: apply QDSP6SS framer quirk ...'
# ...repeat for the other driver commits...
# ...then apply every .dts change and make ONE dts commit at the end.
```

`git add -p` (stage by hunk, per domain) is the alternative when a single file
needs splitting.

---

## Rebasing the fork's work onto a newer base (worked, 7.0.9 → 7.1.3)

The concrete moves for porting a `wip/<old>/<category>` branch onto the current
integration base (e.g. `7.1.3/main`) and reshaping it into `upstreaming/<series>`.
The surrounding bookkeeping — which branches to create, delete and push, in what
order — is in
[`docs/rolling-a-new-base.md`](https://github.com/llg179org/fp3-pmaports/blob/main/docs/rolling-a-new-base.md);
what follows is only the git surgery:

- **The base is a SHA, not a tracking ref.** `msm8953-mainline` branch names
  contain a slash (`7.1.3/main`), so `git fetch origin '7.1.3/main'` leaves it in
  `FETCH_HEAD` — there is usually **no `origin/7.1.3/main` ref**. Resolve the SHA
  once (`git rev-parse FETCH_HEAD`) and branch from that. **Gotcha that bites:**
  `git checkout -b upstreaming/x origin/7.1.3/main` *fails* ("not a commit"), and if you
  chained `cherry-pick`/`commit` after it in one script they run **on whatever
  branch you were already on** — you silently commit onto the wrong branch. Check
  `git branch --show-current` after a failed checkout.

- **Triage conflict risk before you start.** For each file the topic branch
  touches: `git diff --numstat <old-base> <new-base> -- <file>`. `0  0` means the
  file is identical across the bump → cherry-picks apply clean. A file **absent**
  in the new base (a new driver like `imx363.c`, `qcom_smbx.c`) is a clean *add*,
  no collision. Only the files with real drift need hand-resolution — in the 7.1.3
  bump that was just the two framer files (`qcom_q6v5_pas.c`, `qcom-ngd-ctrl.c`);
  everything else (`wcd9335.c`, `apq8016_sbc.c`, `q6voice-dai.c`, the `.dts`) was
  `0 0`.

- **"Base DTS identical" shortcut.** When the board `.dts` is `0 0` across the
  bump, you do **not** need to replay the DTS commits: take the final DTS wholesale
  from the topic branch and commit it as the one DTS commit —
  `git checkout <topic> -- arch/.../<board>.dts`. For an *integration* test build,
  take the combined DTS the same way from `integration/<base>`.

- **New-file driver, consolidated.** For a driver absent upstream, don't cherry-pick
  its nine discovery commits — take the final file(s) and make one commit:
  `git checkout <topic> -- drivers/media/i2c/imx363.c .../Kconfig .../Makefile`,
  then one `media: i2c: add … driver` commit. (`Kconfig`/`Makefile` apply clean when
  their base is `0 0`.)

- **Swap the trailer while reshaping.** Do the `Co-authored-by:` →
  `Assisted-by: Claude:claude-opus-4-8` swap in the same pass:
  `git log -1 --format=%B <c> | sed '/^Co-authored-by: Claude/d;/^Signed-off-by:/a Assisted-by: Claude:claude-opus-4-8'` → `git commit -F -`.

- **Fixing a non-tip commit** (e.g. a checkpatch/warning fix that belongs in commit
  1 of 8): no interactive rebase here. `git tag _bk <branch>`, `git reset --hard
  <base>`, cherry-pick commit 1 with `-n`, edit, commit; cherry-pick the rest;
  confirm `git diff --stat _bk HEAD` shows only your intended lines, then drop the
  tag. Reordering commits is the same move (cherry-pick in the target order; verify
  the tree is byte-identical to the backup).

### The two framer conflict resolutions (patterns to reuse)

- **`of_device_id` table (`qcom_q6v5_pas.c`).** The new base already had a
  `qcom,msm8953-adsp-pil` row (pointing at the generic resource) plus newer SoC
  rows and different brace spacing. Resolution: **keep the whole HEAD block** (its
  new rows + formatting), change only the one `.data =` to your quirk descriptor.
  Don't take "yours" wholesale — you'd drop the base's new entries.

- **Refactored `probe()` (`qcom-ngd-ctrl.c`).** The base had changed
  `platform_get_irq` to store in a new `int irq;` local. Two conflict hunks:
  (1) declarations — **keep both** (`int irq;` *and* your `u32 quirk_reg;`);
  (2) the body — keep HEAD's `irq = platform_get_irq(...)` handling and **insert
  your quirk block before it** (drop your base's `ret = platform_get_irq` variant,
  since HEAD now uses `irq` downstream). General rule: when the base refactored the
  surrounding code, adopt the base's version and re-insert your addition into it.

### checkpatch false positives seen on this hardware

Don't "fix" these — they are correct as-is:
- **`ENOTSUPP` in a machine driver** — `snd_soc_dai_set_channel_map()` returns
  `-ENOTSUPP`; the `if (ret && ret != -ENOTSUPP)` idiom must match it. `EOPNOTSUPP`
  would be wrong.
- **`slim217,...` "undocumented vendor"** — SLIMbus compatibles are `slimMFG,PID`
  (manufacturer id), not a vendor-prefix; checkpatch's heuristic doesn't know that.
- **"Prefer a maximum 75 chars per line" on a quoted oops header** — the
  `Unable to handle kernel NULL pointer dereference at virtual address …` line is
  86 characters and must not be rewrapped: `submitting-patches.rst`
  §"Backtraces in commit messages" says to keep the header above `Call trace:`,
  because it is what says *what* happened. Rewrap the prose around it; leave
  quoted kernel output byte-exact.
- **"DT compatible … appears un-documented"** — real only in that a YAML binding is
  still owed (a genuine follow-up for LKML), not a code defect. Writing it is cheap
  and it is the item that closes; see [Writing the binding](#writing-the-binding).

Before dismissing any of these, check the claim rather than the pattern: the
`ENOTSUPP` verdict above rests on `soc-dai.c` actually returning it, on the base
file already comparing against it twice, and on six other qcom machine drivers
doing the same — re-measurable in one `git grep`. The `slim217` one rests on four
device trees in Linus' tree already using it. A false positive you cannot
re-justify is just a habit.

### Writing the binding

The undocumented-compatible warning is the one checkpatch item that goes away for
a few hours' work, and it takes the series from "nearly clean" to clean. Worked
2026-07-30 for `qcom,pmi632-charger`.

- **Extend the existing file, do not add a second one**, when the same driver
  serves the new compatible. One driver (`qcom_smbx`) covers pmi8998 / pm660 /
  pmi632; SMB2 and SMB5 differ in register layout, not in the shape of the
  binding, so the new compatible joins the `enum` in
  `qcom,pmi8998-charger.yaml` and the title generalises. A second file duplicates
  everything and invites the reviewer to ask why.
- **Describe the driver you have, not the one you wish for.** If the driver takes
  a channel with `devm_iio_channel_get()` and carries on unless the error is
  `-EPROBE_DEFER`, the schema says `minItems`, not a fixed list. Read the probe
  path before writing the `required:` block.
- **Validate three ways, and expect the schema's own bugs.** `dt_binding_check`
  (which compiles and checks every example), `yamllint -c
  Documentation/devicetree/bindings/.yamllint`, and `CHECK_DTBS=y` against the
  real board DTB — the last is the only one that proves the schema matches the
  node you actually ship. ☠️ **Upgrade the tooling first** (`pip3 install dtschema
  --upgrade`): Rob Herring's bot replies *"My bot found errors running 'make
  dt_binding_check' on your patch"* with the failing lines, and a stale dtschema
  is how a patch passes locally and fails there. What that bot most often catches
  in a first binding: the `$id` not matching the file's actual path and name, a
  node name in the example that does not match the schema's name pattern, a
  `required:` property missing from the example, and a plain syntax error in the
  example DTS — all four are found by running it yourself. The mechanics, the differential discipline and the
  silent-skip trap are in
  [`../fp3-kernel-test/references/safety.md`](../fp3-kernel-test/references/safety.md).
- **Property names use hyphens, never underscores** — *"Don't use '_' in property
  names."* (Rob Herring; it is also a `W=2` dtc warning, so it is machine-findable
  before a human sees it.)
- **Use the standard property when one exists**, and justify a vendor property
  when it does not: *"what's the type? Does the standard 'wakeup-source' property
  not work here?"* Every vendor property needs an explicit type — a `$ref` into
  `types.yaml` — and pattern-matched subnodes need a `$ref` to the common schema
  for their class (e.g. `pinmux-node.yaml`) rather than a hand-written copy.
- ☠️ **A legacy `.txt` binding is converted to YAML before it gains properties.**
  Krzysztof Kozlowski, 2023-12-18: *"You add six new properties, so from my point
  of view this cannot be in TXT."*
  (<https://lore.kernel.org/all/fae1e6f8-f679-4266-95b6-5879c71683a4@linaro.org/>)
  Budget the conversion as its own patch at the head of the series; discovering
  this at v2 costs a whole round.
- **A compatible names one SoC even when one driver serves the family** — same
  message: *"Compatible should be specific to one SoC, even if there is one driver
  for entire family."* The fallback compatible expresses the family; the specific
  one is still required.
- **The binding's enums and the driver's tables are one fact in two files.** When
  a driver's function or pin list is consolidated, the YAML `enum` is updated in
  the same series — *"you consolidated the functions in the driver, but you forgot
  to update this list accordingly"* is a v2 that existed only for that.
- **Where a binding patch goes in the series:** its own commit, before the driver
  patch that adds the compatible.
- ☠️ **A new driver usually owes a `defconfig` patch too**, and it is the element
  most often forgotten, because nothing on the developer's own machine needs it —
  the local build already has the symbol enabled. The canonical shape of a driver
  series is *binding → framework change → driver + Kconfig → **defconfig** →
  DTS*. Check rather than assume in either direction; the symbol may already be
  there because another board needed it:
  ```sh
  grep -E '^CONFIG_<SYMBOL>=' arch/arm64/configs/defconfig
  ```
  Already `=m` ⇒ no patch. Absent ⇒ the hardware cannot work on a stock kernel
  build, which is most of the point of upstreaming it. One binding patch for the whole series, even
  when it documents properties three later patches introduce — splitting a
  binding across patches is unusual and reads worse.

### Form rules a reviewer will spend a whole revision on

Harvested 2026-08-29 from recent qcom/DT series that needed a v2/v3 purely for
form. None of these are judgement calls; each cost somebody a round trip.

**The binding file.**

- **The filename is the compatible.** `qcom,<soc>-<block>.yaml`, matching the
  compatible it documents — not a generic subsystem name. And ☠️ **do not rename
  an existing binding** while adding a compatible to it: *"Please do not rename the
  binding. Old name was correct."*
- **The subject is `dt-bindings: <subsystem>: Add <device>`.** No trailing word
  "binding" (the prefix already says it), and it **names hardware, not a driver** —
  a subject about a "platform driver" or an init mode is itself a review comment.
- **Copy the pattern from the neighbouring bindings before inventing one.** The
  recurring form of this comment is *"I asked to open other bindings to see how this
  is done"* — e.g. a `clocks` list with several possible lengths needs `minItems`,
  which every sibling binding in that directory already shows. Read two siblings in
  the same directory before writing; this is the cheap half of
  [prior art](#look-for-prior-art-before-writing-not-after).
- **Every statement in the binding is checkable against the datasheet.** *"This is
  not true. Please open datasheet - it clearly says SPI interface"* — a description
  sentence is a claim like any other.
- **Add to the shared binding, don't grow a private example.** Where a property is
  already valid for the other devices in a file, add it there and drop the extra
  example you were about to paste.

**The DTS node.**

- ☠️ **GPIO polarity states the logical level, even when the in-tree driver has it
  backwards.** Reviewing an FP5 NFC node with `reset-gpios = <&tlmm 38
  GPIO_ACTIVE_HIGH>`, Krzysztof Kozlowski, 2026-08-27: *"This must be ACTIVE_LOW and
  existing driver is just wrong. Driver should handle old DTS without change, but
  for the new device correct it to proper way of handling logical state of GPIO pin
  (reset as "1" means asserted, so device is not working)."*
  (<https://lore.kernel.org/all/20260827-strange-sensible-duck-40cfa3@quoll/>)
  So: read the flag as *what the pin means*, not as *what makes the current driver
  work* — and when the two disagree, the new DTS is right and the driver gets fixed
  to keep old DTBs working. Copying the polarity out of a downstream DTS reproduces
  the downstream bug.
- **`interrupts-extended`**, not `interrupt-parent` + `interrupts` as two
  properties.
- **Pin *levels* are not pinctrl state.** `output-high` in a reset pinmux node is
  the driver's job (`gpiod_set_value`), not the pin controller's; pinctrl carries
  mux, pull and drive strength.
- **Generic node names.** `fuel-gauge@55`, `nfc@8`, `touchscreen@…` — the class of
  device, per the DT spec, never the part number (`bq27541-battery@55`). The part
  number is what `compatible` is for.
- **The file has a fixed shape, not just the nodes.** The convention the qcom
  board DTs follow, spelled out on the pmOS MSM8916 page: SPDX line, `/dts-v1/;`,
  the `#include`s, then the root node carrying `model`, `compatible`
  (`"<vendor>,<codename>", "qcom,<soc>"`) and `chassis-type`, then `aliases` and
  `chosen` (`stdout-path`), then an **alphabetically ordered** list of new nodes;
  after the root node an **alphabetically ordered** list of `&reference` overrides —
  and **pinctrl (`&tlmm`) always last**.
- ☠️ **Every GPIO the board uses gets a pinctrl entry**, even one that already
  works. *"This is good practice in case they were incorrectly configured by the
  previous bootloader or operating system (consider kexec booting another Linux
  kernel)."* A pin that works only because lk2nd left it in the right state is a
  bug that appears on somebody else's bootloader, not on yours.
- **Nodes go in address order, not at the end of the file.** A new `spi@78b7000`
  belongs after `i2c@75b9000`, and inside a node the property order is the one
  `dts-coding-style.rst` fixes, with `status` last before the child nodes.
- **`reg` covers the whole block the hardware occupies**, not the bytes the driver
  happens to touch: *"Please mark it as the entire 0x100000 that it occupies, no
  matter if there's anything in there"*.
- **One addition to the shared DTSI beats three identical additions to board DTS
  files** when every board that includes it has the part. A hypothetical future
  board that might not is not an argument.

Trailing whitespace / space-before-tab in a reverse-engineered register table
*are* real (checkpatch ERRORs) — strip them (`sed -i 's/[ \t]*$//' ; sed -i
's/ \+\t/\t/g'`), plus `MODULE_LICENSE("GPL v2")`→`"GPL"`.

---

## The rebase-and-retest gate (do not skip before submitting)

The fork's work was built and verified on the **7.0.9** base. The submission
targets a *different, newer* base — `sound/for-next` for the driver patches, fresh
torvalds for the DTS — so the branch must be rebased across that bump, and a base
bump **can break things silently** (compiles clean, does not work). Before sending:

1. **Rebase** onto the real target base, resolving conflicts **commit by commit**.
2. **Rebuild** — catches API churn (compile errors).
3. **CONFIG check** — every symbol the build relies on must still exist on the new
   base; `olddefconfig` drops unknown symbols without a word (this is exactly the
   `DRM_PANEL_*_HX83112B` rename trap). A feature can vanish with zero build
   warnings.
4. **Functional test on device** — run `fp3-selftest`
   (`fp3-pmaports/tests/fp3-selftest`, with its `checks/` and `baseline/`). This is
   the only thing that catches the silent class: zeroed mic, dead DAPM route,
   missing MBHC IRQ, absent camera graph. Cross-ref the `fp3-kernel-test` skill for
   the deploy/capture loop.

Only a green functional run gates the submission — "it compiled" is not enough.
This matters more than usual here: `generated-content.rst` invites maintainers to
demand extra testing of tool-assisted work, so arriving with a measured result is
the difference between a review and a dismissal.

### Trial-rebase early — it is the only thing that answers "does this apply?"

Step 1 above is normally done at post time. Do it **as a throwaway, months
earlier**, because until it runs every statement about readiness is inference.

The tempting substitute is checking that the files exist upstream. It is not the
same question and it can be wrong in both directions. Measured 2026-07-30 on five
series: every file one series touched was present upstream *and* it conflicted on
the first patch, while another series whose driver had been assumed to be a moving
target applied 6 for 6. Overall **11 of 21 commits applied with no conflict at
all** — a fact nobody had, and two of the three failures had causes worth knowing
rather than conflicts worth resolving.

Nothing needs to be committed anywhere. Group the commits by *destination tree*
(driver vs DTS vs a third subsystem), cherry-pick each group onto a detached head
at that tree's tip, record, abort:

```sh
git worktree add --detach /tmp/trial <target>
cd /tmp/trial
for c in <oldest> … <newest>; do
        git cherry-pick -x "$c" || {
                git diff --name-only --diff-filter=U   # the answer you came for
                git cherry-pick --abort; break; }
done
```

Two things to get right, both of which quietly invalidate the run:

- **Use the real per-subsystem tips, not one tree.** ASoC is `broonie/sound`
  `for-next`, power-supply is `sre/linux-power-supply` `for-next`, DTS is fresh
  torvalds. Fetching them into an existing full clone is cheap; a shallow clone is
  useless here.
- **Fresh detached head per group.** Two groups touching the same board `.dts`
  will conflict with *each other* if stacked, and that conflict is an artefact.

☠️ **Then ask what the conflict is made of.** A conflict is a symptom, and the
diagnosis changes the plan completely. Here the audio conflict was pure
context — `HEAD` had nothing where our patch expected a neighbouring line — and
tracing that line found `qcom,msm8953-qdsp6-sndcard`, `msm8953_qdsp6_add_ops` and
a `use_ibit_clk` field that come from two **out-of-tree** commits in the base,
while everything our code actually *calls* was upstream. So the series is not
rotten; it has a prerequisite. Cheap way to tell the two apart:

```sh
# for each symbol/label the conflicting hunk touches:
git grep -c '<symbol>' <target>/<branch> -- <file>      # 0 = it is not upstream
```

### A dependency that was posted is a citable prerequisite, not a blocker

Having found the missing scaffolding, the next question is whether anyone ever
tried to upstream it — and the answer changes the outcome by a lot. Search
patchwork by the *file* name, not the feature:

```sh
curl -s 'https://patchwork.kernel.org/api/1.2/patches/?q=apq8016_sbc&order=-date&per_page=50' \
  | jq -r '.[] | "\(.date[0:10]) \(.state) \(.name)"'
curl -s 'https://patchwork.kernel.org/api/1.2/series/<id>/' \
  | jq -r '"\(.name) v\(.version)  cover: \(.cover_letter.msgid)", (.patches[]|"  \(.name)")'
```

That turned "depends on out-of-tree code" into "depends on *MSM8953/MSM8976 ASoC
support* v3, eight patches, 2024-07-31, state `new`, with a cover-letter
message-id". Three states with three different plans:

| what the search says | what to do |
|---|---|
| posted, still `new`/`changes-requested` | declare it as a prerequisite; consider asking on the thread whether it is alive |
| **never posted at all** (patchwork empty) | there is no message-id to depend on; the file does not exist upstream to patch. Do not send. Offer the work to whoever carries it |
| merged since your base | just rebase; there is no dependency |

The declaration mechanism is `b4`, not prose and not a fork branch:

```sh
b4 prep --edit-deps      # add change-id: or message-id: of the prerequisite series
b4 prep --check-deps     # verifies it exists, is current, and that deps+yours apply
```

`git format-patch --base=<ref>` also emits `base-commit:` and, when the base is not
upstream, `prerequisite-patch-id:` lines. Use it sparingly: the b4 documentation
warns that *"a large number of prerequisites is hard for maintainers to keep track
of"* and that it is usually better to send one problem at a time.

☠️ **Publishing the dependency to your own fork does nothing.** A maintainer
applies to *their* tree; a mirror branch under your account is not in anyone's
`-next`. Mirroring is worth doing for **provenance durability** only — see the
archival-snapshot recipe below — and it must never become the base of a `submit`
branch, because that hides exactly the fact a reviewer needs.

### A dependency that crosses trees is a handshake, not a tag

`prerequisite-patch-id:` handles "my series needs a patch that is posted". A
*different* problem appears once both halves are being merged: your driver patch
goes to one tree and your `.dts` to another, and something has to keep them
consistent. Olof Johansson, then the arm-soc maintainer, on how that is actually
handled (ELC 2013):

- ☠️ **It is a three-way agreement — you, the other subsystem's maintainer, and
  the SoC maintainers — and it is made over email, not IRC.** A dependency nobody
  else has agreed to is not a dependency, it is a hope.
- ☠️ **A branch other people pull is frozen. "Never, ever rebased."** The moment a
  second tree pulls your branch, rebasing it corrupts both. This is the opposite
  of how our own `upstreaming/*` branches work (regenerated from `wip`), so it is a
  habit that has to be switched off deliberately.
- **The easy case has an easier form still**: for a *new* driver, either the
  driver maintainer takes the driver patch, **or** he gives an `Acked-by` and
  agrees that the SoC tree takes both. Which one is preferred varies by
  maintainer and by what else they have in flight — so **ask**, rather than
  choosing for them.
- **Splitting driver from DTS does not break bisect, and that is the point.**
  *"Even if driver and DT is merged separately, bisectability is kept — driver
  just won't probe."* A tree with the DT node and no driver, or a driver and no
  node, boots; the hardware is simply absent. This is the answer to the obvious
  worry about our own audio series, whose driver goes to ASoC and whose board
  wiring goes to the qcom tree: the window between the two merges is harmless.
- **Say what you want done with the patch.** *"Want us to apply a patch directly?
  Tell us, don't assume we will — we get a lot of patches our way, most for
  review."* An RFC and a patch meant to be applied look similar in an inbox.
- **Test the destination's `for-next` *and* linux-next**, not just your own base.
  It "short-circuits the loop on breakage", and for a board port it costs one
  build.

### Archive an import as a parentless snapshot, not a mirror

The citation in §2b resolves only while the source repository exists, and personal
reverse-engineering repos are exactly the ones that disappear — the branch behind
this port's camera driver had **already** been deleted. Keep the source reachable
under your own account, in a namespace that cannot be mistaken for a base
(`vendor/*` here), and prune it with nothing.

Do not mirror the branch. Measured: the real branch was 71 541 commits unique
against mainline, because a downstream tree following a stable series carries
cherry-picks with fresh SHAs. Snapshot the **tree** instead — it is
byte-verifiable, and pushes in under a minute because a fork network shares its
objects with the upstream it was forked from:

```sh
git fetch --no-tags <url> <sha> && git update-ref refs/vendor/x FETCH_HEAD
SNAP=$(GIT_AUTHOR_NAME="<their name>" GIT_AUTHOR_EMAIL="<their mail>" \
       GIT_AUTHOR_DATE="<their date>" \
       git commit-tree refs/vendor/x^{tree} -F msg.txt)   # no -p: parentless
git branch vendor/<name> "$SNAP"
git diff vendor/<name> refs/vendor/x        # MUST be empty - that is the guarantee
```

Put the full citation and the `git diff` verification line in the snapshot's
message, keep their authorship and date, and state in the body that it is an
archive and not a re-submission. Quote the original commit message rather than
re-emitting its trailers as live ones, so nothing reads as a fresh certification
by someone who did not make it.

☠️ **Force-pushing a rewritten branch can break a pinned build, silently and
later.** The package here fetches a GitHub tarball of an exact `_commit`, and
GitHub serves that only while the commit is reachable from some ref — rewriting the
branch it sat on would have left the installed kernel un-rebuildable, with no
error until someone tried. Tag the old tip first, then verify the pin:

```sh
git tag -a archive/<what>-pre-<change> <old-tip> -m 'why this must stay reachable'
curl -sI -o /dev/null -w '%{http_code}\n' \
  "https://github.com/<user>/linux/archive/<pinned-sha>.tar.gz"   # 302, not 404
```

---

## Authorship and provenance

The kernel documents exactly how to acknowledge AI assistance. Verified in-tree,
with line numbers, not quoted from memory — **two** documents apply, both listed
in `Documentation/process/index.rst`:

| document | what it governs |
|---|---|
| `process/coding-assistants.rst` | the `Assisted-by:` trailer; AI must not sign off |
| `process/generated-content.rst` | what you must **disclose**, and maintainer discretion |
| `process/submitting-patches.rst` | §"Using Assisted-by:" (line 637) — the requirement |

`submitting-patches.rst:641` is the operative sentence: you "need to acknowledge
that use by adding an Assisted-by tag. Failure to do so **may impede the
acceptance of your work**."

### What `generated-content.rst` additionally requires

This is the half that is easy to miss, and it is the half that decides whether a
maintainer engages. It applies "when a meaningful amount of content in a kernel
contribution was not written by a person in the Signed-off-by chain". You are
expected to be transparent in the **cover letter** about:

- which tools were used;
- the prompts — verbatim if the code came from a short set of them, otherwise a
  summary of the prompts and the nature of the assistance;
- **which portions** of the contribution the tool affected;
- how the result was **tested**, and with what.

It also states plainly what you are signing up for: *"You are expected to
understand and to be able to defend everything you submit. If you are unable to do
so, then do not submit the resulting changes."* And maintainers explicitly may
**reject the series outright**, ask for extra testing, review it at lower
priority, or ask you to explain the code to prove you understand it. Budget for
that reaction rather than being surprised by it.

For the FP3 series the strongest disclosure is the **on-device evidence**: the
MBHC work was verified over 14 jack edges across 6 insert/remove cycles with no
drift, via `evtest --query event5 SW_HEADPHONE_INSERT`. Lead the testing paragraph
with that.

**The `Assisted-by:` trailer (kernel-required form).** Any commit that used an AI
coding assistant must carry, as a trailer:

```
Assisted-by: AGENT_NAME:MODEL_VERSION [TOOL1] [TOOL2]
```

- `AGENT_NAME` — the AI tool/framework; `MODEL_VERSION` — the specific model.
  The in-tree example is `Assisted-by: Claude:claude-3-opus coccinelle sparse`.
- `[TOOL1] [TOOL2]` — optional *specialised analysis* tools actually used
  (coccinelle, sparse, smatch, clang-tidy). **Basic tools (git, gcc, make,
  editors) are NOT listed.**
- **Name the model that actually did the work — do not hardcode one.** The FP3
  history spans several: the audio/MBHC work was done with Opus 4.8
  (`Assisted-by: Claude:claude-opus-4-8`), later sessions run Opus 5
  (`Assisted-by: Claude:claude-opus-5`). A commit reshaped today by a different
  model than the one that wrote it should name the model that produced the code
  being submitted. Check which model is running before writing the trailer rather
  than copying the string from this file.
- Append e.g. `sparse smatch` only if such a tool was actually run on the patch.

**The AI must NOT have a `Signed-off-by`.** Only a human can legally certify the
DCO. The human submitter reviews the AI-generated code, ensures licensing
compliance, adds *their own* `Signed-off-by`, and takes full responsibility.
Failure to acknowledge the assistance "may impede the acceptance of your work."

**So the trailer block for an upstream-bound commit is:**

```
Signed-off-by: Lajosházi, László Gergely <your@address>
Assisted-by: Claude:claude-opus-4-8
```

`<your@address>` is a placeholder in this public file. Take the real address
from the private `CLAUDE.md`, and take it from there every time — a
`Signed-off-by` with a guessed or a `noreply` address certifies nothing, and a
maintainer who cannot reply to it will not take the patch.

i.e. **replace** the fork's `Co-authored-by: Claude …` line with `Assisted-by:`.
`Co-authored-by:` is a GitHub convention, not a kernel trailer — and its kernel
counterpart `Co-developed-by:` is *worse*, not better: `submitting-patches.rst`
requires every `Co-developed-by:` to be **immediately followed by a
`Signed-off-by:` of that co-author**, which an AI cannot legally provide. So
`Co-developed-by: Claude …` is structurally invalid upstream. `Assisted-by:`
exists precisely to fill that gap: attribution without an authorship claim.

- **Fork commits (llg179org/linux):** keep the fork rule — author
  `Lajosházi, László Gergely <your@address>` + `Signed-off-by:` +
  `Co-authored-by: Claude Opus 4.8 <noreply@anthropic.com>`, kernel comments in
  **English only**. That is the local convention (CLAUDE.md), unaffected.
- **Upstream submission (LKML):** swap `Co-authored-by:` → `Assisted-by:` naming
  the model actually used, and never let the AI carry a `Signed-off-by`. When
  rewriting the commits for the `upstreaming/*` branch, do this swap as part of the same
  pass that splits the DTS out.

### Credit the work you build on, especially when it is not upstream yet

`Assisted-by:` covers the AI. It says nothing about the **humans** whose work a
patch reuses. The rule and the import/invention split are in
[§2b](#2b-split-the-import-from-the-invention-and-make-the-import-traceable);
this is the citation *form* for each of four situations:

| the source | how to cite it |
|---|---|
| an **in-tree** commit or driver you used as the skeleton | `commit e4802cb00bfe ("media: imx258: Add imx258 camera sensor driver")` — the standard 12-hex-plus-subject form. Keep the original copyright and `MODULE_AUTHOR` lines in the file, and say in the message that you did |
| a **posted but never merged** series you are reviving | name the author and the series in prose, plus `Link: https://lore.kernel.org/all/<message-id>/` to the cover letter. Verify the message-id resolves — patchwork's *"Series Link"* gives you the cover-letter id |
| a **downstream / vendor** tree (Qualcomm BSP, an OEM release) | name the exact file(s) — `msm8953-audio.dtsi`, `qpnp-smb5` — and `Link:` the published release the numbers were read out of. ☠️ **Then answer the second question: how do you know that file is the variant this board uses?** Vendor trees ship alternatives — several battery profiles, panel timings, sensor tunings — selected at runtime by an ID resistor, a GPIO strap or a model byte. Naming the file you copied from is provenance; it is *not* evidence that it applies. If the vendor's board file `#include`s more than one candidate, there is a selection mechanism: find it, read it on the device, and put the reading in the message. If you cannot read it, say in the commit that the variant is unverified and choose the value that is safe under either answer |
| an **out-of-tree fork** driver you extend (msm8953-mainline, a Halium tree) | say plainly that the driver is not in mainline, name its authors, and link the commit in the tree that carries it |

Do **not** reach for `Co-developed-by:` to solve this: it requires a
`Signed-off-by:` from that person in the same patch, which you cannot produce for
someone who is not part of your submission. Prose plus `Link:` is the correct
tool.

Worked examples from this series, all four of them real omissions found by
auditing the branch before submission:

* `ASoC: wcd9335: add MBHC headset jack detection` said only "reviving the 2018
  series that was dropped before merge" — no name, no link. The series is
  **Srinivas Kandagatla's**, v3 of 2018-09-04, and `wcd9335.c` is
  *maintained by him*. Now: "based on the MBHC support in Srinivas Kandagatla's
  2018 WCD9335 series, which was posted together with the codec driver but
  dropped before that series was merged" +
  `Link: https://lore.kernel.org/all/20180904102500.30318-1-srinivas.kandagatla@linaro.org/`.
* `media: i2c: add Sony IMX363 image sensor driver` — **and this one is still
  wrong, which makes it the most useful example on the page.** The message cites
  `commit e4802cb00bfe ("media: imx258: Add imx258 camera sensor driver")`, in
  the correct form, resolving to a real commit, for a file that genuinely carries
  Intel's copyright. All of that is beside the point: the file was not derived
  from `imx258.c` by us at all. It was **downloaded** from a third party's
  out-of-tree branch, which had itself been built on an Intel driver and
  reverse-engineered against a different phone's sensor. Citing the ancestor two
  steps up while omitting the person you actually took the file from is a
  misattribution that a perfectly-formatted citation hides. See
  [Find the immediate source](#find-the-immediate-source-not-the-ancestor-you-recognise).
* `ASoC: qcom: apq8016_sbc: add SLIMbus backend …` follows the SLIMbus flow in
  `sound/soc/qcom/sdm845.c` — the code said so in a comment, the message did not.
* `arm64: dts: qcom: …: wire up WCD9335 audio` takes every address and value from
  Fairphone's published 4.9 sources; its camera and charger siblings said so and
  it did not. Now it does, with the GPL-release link.

An audit pass that surfaces the candidates cheaply, before the series goes out.
Read it as a **prompt list, not a verdict**: most hits will be legitimately your
own work, and the question to ask of each is only *"did any of this come from
somewhere else?"*

```sh
git log --format='%h %s' <base>..<branch> | while read h s; do
    git log -1 --format=%B "$h" \
      | grep -qiE 'Link:|Based on|Derived from|follows the|taken from|read out of|commit [0-9a-f]{12} \("' \
      || echo "no source cited: $h $s"
done
```

On the FP3 audio branch this prints 7 of 11 commits — and 6 of those 7 really are
original (a debounce found by measuring, a missing volume control, an init fix).
The one that was not is exactly the kind this catches: *"take the mic bias voltage
and DMIC clock rate from the DT"* reads its values out of Fairphone's downstream
`msm8953-audio.dtsi` and never said so.

**Audit the branches before submitting — commits with no sign-off at all do
exist.** A commit can carry an **empty trailer block**: no `Signed-off-by`, no
attribution. Those are unsubmittable as-is, independent of the AI question, and
they are easy to miss because nothing in the subject line says so. Check every
branch, not just the one being sent:

```sh
# every commit whose Signed-off-by field is empty
git log --format='%h|%s|%(trailers:key=Signed-off-by,valueonly,separator=;)' \
    <base>..<branch> | awk -F'|' '$NF==""'
```

Filter on the sign-off field itself, not on the whole line ending in `||` — a
commit can carry an `Assisted-by:` and still be missing its `Signed-off-by`, and
the line-shaped test walks straight past it.

☠️ **Do not carry the last audit's hit list in here.** A previous revision named
seven specific camera commits by hash; by the time anyone read it the series had
been rebuilt into three commits with an intact DCO chain, one of the seven hashes
no longer resolved, and the sign-off gap had moved to a different subsystem
entirely. Which commits are currently missing a trailer is **status** — run the
command, do not trust a list.

☠️ Pin the audit to the *shape* of the trailer, not to a literal string. A pass
that grepped `Assisted-by: Claude:claude-opus-5` accused nine perfectly correct
commits, because they were written by an earlier model and legitimately say
`claude-opus-4-8` — which is the convention. Match
`^Assisted-by: Claude:claude-[a-z0-9-]+$`.

### Find the immediate source, not the ancestor you recognise

A file that arrived from outside has **two** provenance questions, and the
interesting one is not the one that comes to mind. "What is this structured on?"
is answerable from the copyright header and feels like an answer. "Who did I get
this file from?" is the one the DCO and the credit depend on, and the header does
not carry it — the intermediate author usually adds no copyright line at all.

Four things to do before writing the paragraph, in cost order:

1. **Grep the project's own bring-up notes.** On this port the answer had been
   written down 27 days earlier — one line naming the repo, the branch, that it
   was reverse-engineered, and the line count of the file that was downloaded. It
   was never read again, and three documents plus a commit message were written
   as if the code were ours. The notes are searchable; the recollection is not.
2. **Read the imported code's comments as provenance evidence.** They outrank
   your memory of where the numbers came from, because whoever wrote them was
   there. `//Magical … Regs & Values - Found in downstream`,
   `// not present in android downstream logs`, and — decisively —
   `636000000ULL, // NOT SURE HOW TO FIND THIS VALUE` on a link frequency. A
   commit message claiming the tables were "read back from the sensor rather than
   taken from vendor code" cannot survive next to those lines, and a reviewer
   opening the file sees both.
3. **Check the register/table values against the claim you are about to make.**
   "Measured here" and "read out of a vendor log" are different risks and a
   reviewer treats them differently; guessing wrong in the *flattering* direction
   is the one that damages trust.
4. **Retrieve the original file and diff it.** This is the check that breaks a
   *self-consistent* false claim, and it is two commands. Until it is run, "our
   delta" is a feeling; after it, it is `12 hunks, +68/−21 on 1514 lines`. If the
   fetch genuinely fails, say the delta is unmeasured and name the command —
   never estimate the fraction that is yours.

☠️ **"The fetch failed" is usually "I looked in the wrong forge".** This skill
carried *"a GitHub API fetch of the same path returned nothing"* for a day as if
it were a property of the source. It was not: `panpanpanpan/linux` does not exist
on GitHub at all, the tree was on **GitLab**, and once looked for there the file
came back in minutes. A 404 tells you about your URL, not about the world.

Two mechanics worth having, both worked 2026-07-30:

```sh
# 1. find the project and the merge request, when all you have is a nickname
curl -s "https://gitlab.com/api/v4/groups/<group>/projects?per_page=50" \
  | jq -r '.[] | "\(.id) \(.path_with_namespace)"'
curl -s "https://gitlab.com/api/v4/projects/<id>/merge_requests?search=<term>&scope=all&state=all" \
  | jq -r '.[] | "!\(.iid) \(.state) \(.author.username) \(.source_branch) | \(.title)"'
curl -s "https://gitlab.com/api/v4/projects/<id>/merge_requests/<iid>/commits" \
  | jq -r '.[] | "\(.id) \(.author_name) <\(.author_email)> \(.authored_date[0:10]) \(.title)"'

# 2. fetch ONE commit by SHA - works even when the branch has been deleted
git fetch --no-tags <clone-url> <full-40-char-sha>     # GitLab allows SHA-want
git update-ref refs/vendor/<name> FETCH_HEAD
```

☠️ **The merge-request author is not necessarily the code's author.** The
attribution this port used for a day named the person who opened the MR and wrote
its device tree; the driver inside it was somebody else's commit, cherry-picked in.
Take the fields from the **commit**, per the `git log -1 --format=` line in §2b —
never from the MR page, the branch name, or a nickname in an old note.

The structural consequence is [§2b](#2b-split-the-import-from-the-invention-and-make-the-import-traceable):
one commit importing the file with **their** authorship and the full citation,
one commit with your changes. Doing that late is expensive, which is the argument
for asking the question when the file arrives.

Two things the split buys beyond etiquette, both observed when it was finally
done:

- **It localises what the checkers blame on you.** As one commit the camera series
  showed 4 `checkpatch` errors and 17 warnings, indistinguishable from our own
  sloppiness. Split, the import carries all 4 and 17 of them and our own patch
  reads 0 errors / 1 warning. That is also the argument for cleaning the imported
  style in a **third** commit: folding the cleanup into the import destroys the
  byte-identity that makes the import checkable at all.
- **The DCO question often answers itself in your favour.** The fear was that the
  import carried no sign-off, as had just happened with a sensor series. It
  carried three — the author's, the MR author's and the committer's — so
  forwarding it needed only ours appended. Check before assuming the worse case;
  the two situations look identical from the outside and have opposite outcomes.

### Look for prior art before writing, not after

☠️ **On an out-of-tree subsystem, someone else is probably carrying it further
than your base is.** A one-line DAPM route was written on this port as a
discovery, recorded in three documents as new, and turned out to exist line for
line — including the exact route whose absence had been "found" — in a 2022 commit
on another downstream tree, which implemented it for seven ports where ours did
one.

Nothing was published as someone else's, and the patch was not wrong. The cost was
narrower and more annoying: weeks of debugging spent re-deriving a solved problem,
and a claim of novelty in a commit message that a reviewer could have punctured in
one search. The check belongs *before* the work:

```sh
# who else carries this file, and how far?
git ls-remote --heads <other-downstream-tree>      # look for topic branches
git fetch --no-tags <url> <sha> && git diff FETCH_HEAD:<path> HEAD:<path>
curl -s 'https://patchwork.kernel.org/api/1.2/patches/?q=<file-or-subsystem>&order=-date' \
  | jq -r '.[] | "\(.date[0:10]) \(.state) \(.name)"'
```

The trigger is mechanical: **if the file you are patching is not in Linus' tree,
find out who else patches it before you write.** The same search that later found
the camera driver's real origin would have found this; it was simply never run for
that category.

### A `Fixes:` target comes from blame, never from the file's age

A line that looks like an ancient oversight may be two months old, and the
difference changes what the patch *is*. Worked 2026-07-30 on `qmi_encdec.c`: a
four-byte read of a one-byte length field looked like an original-import bug from
2017. `git blame` on today's mainline put it at a commit from **this year** whose
subject and message state a premise — *"QMI_DATA_LEN is always of type `u32` on
the host"* — that the measurement disproves. So the patch became a regression fix
with `Fixes:` and a `get_maintainer.pl` run that puts the author of the regression
on Cc, instead of a vague cleanup nobody owns.

On a shallow fork clone, blame the real tree over the API:

```sh
gh api graphql -f query='{ repository(owner:"torvalds", name:"linux") {
  object(expression:"master") { ... on Commit {
    blame(path:"drivers/soc/qcom/qmi_encdec.c") {
      ranges { startingLine endingLine commit { oid messageHeadline committedDate } } } } } }' \
  --jq '.data.repository.object.blame.ranges[]
        | select(.startingLine <= 409 and .endingLine >= 409)
        | "\(.commit.oid[0:12]) \(.commit.committedDate[0:10]) \(.commit.messageHeadline)"'
```

☠️ **Do not reconstruct the history from a commit's diff.** Reading the `-` side of
one patch led to the confident, wrong conclusion that the bug had already been
fixed upstream; a later commit had changed the line back and the pre-image no
longer described anything current. Two facts settled it, both fetched directly:
the **current** file content at `master`, and blame on the line. Fetch the state,
do not infer it from a chain of diffs.

### "Applies clean" is a measurement, and for a one-file patch a cheap one

A branch table that says *clean* against a maintainer tree is worthless if
nobody ran it; the claim ages every time upstream touches the file. The full
answer is the trial rebase onto the destination tip (see the checklist), and for
a multi-file series there is no substitute. But a **single-file** patch —
typically the standalone bugfix that carries `Fixes:` — can be settled in
seconds without a rebase, without a full clone, and on a shallow tree where a
rebase is not even possible:

```sh
gh api "repos/torvalds/linux/contents/<path>" --jq '.content' | base64 -d > /tmp/t/<path>
git -C /tmp/t apply --check /path/to/one.patch    # silence = it applies today
```

This is the same discipline as the blame recipe above — fetch the upstream state
and test against it, rather than reasoning from what the local base contains.
Record the date with the result, because it is true only as of the fetch.

☠️ It answers *applicability*, not *destination*. A patch can apply perfectly to
a file that no maintainer will take it through, and a patch to a driver that is
not upstream at all cannot apply to anything — check existence first (`404` from
the same `contents` endpoint), then applicability.

### You cannot submit somebody else's unsigned WIP

Two gates before building a series on an import, both of which stopped a sensor
series on 2026-07-30:

- **No `Signed-off-by`, no submission.** The two commits underneath twelve of ours
  carried none at all — not even their author's — and only he can supply one. This
  is not a formality that a cover letter can explain away; the DCO chain simply is
  not there. Check with the trailer audit above *before* planning the series, not
  after distilling it.
- **Check whether the author is already submitting it.** `lore.kernel.org` and
  `lkml.org` are behind a bot wall, but **patchwork's REST API answers**, and it
  carries the state a mailing-list archive does not:

  ```sh
  curl -s 'https://patchwork.kernel.org/api/1.2/patches/?q=Sensor+Manager&order=-date' \
    | jq -r '.[] | "\(.date[0:10]) \(.state) \(.name)"'
  ```

  That returned `v2 … changes-requested`, posted a year earlier, with a maintainer
  asking for a rework — and a cover letter listing the sensor types already
  supported, two of which we had re-implemented against the older snapshot.
  Sending our own series would have been a competing submission of another
  person's driver. The right move is a reply on their thread, and the part worth
  offering is what their cover letter names as *missing*.

What survives such a series is whatever does not live in the imported files. Here
that was exactly one commit — a core fix in a different subsystem — and one honest
patch beats twelve unsendable ones.

### ☠️ The proxy problem: do not carry code you cannot defend

Tim Bird named this at ELCE 2014 and it is the failure mode most likely to catch
this port, because almost everything here starts as somebody else's work. A
**proxy** is whoever submits code they did not write. The symptoms he lists are
exactly what review does to a proxy: cannot answer questions in a timely manner,
lacks in-depth knowledge of the change, may not be able to test thoroughly — and
it is worst when the code is far from mainline, because upstream has refactored
since and no longer looks like what you are holding.

It is not hypothetical here. The MSM8953 machine-driver series this port depends
on stalled with its submitter writing, in public, *"i don't feel good sending
code i don't understand much"* — after a reviewer asked one question he could not
answer.

**The test, applied before adopting anyone's patch:** for every hunk, can you say
why it is written that way, and what happens if it is not there? Where the answer
is no, you have two honest moves and neither is "send it anyway":

- **hand it back** — help the original author submit, which is faster than
  learning their hardware; or
- **learn it well enough to own it**, and say in the message that you did, naming
  what you verified and how.

The general form of the second is the rule this skill already carries about
answering "why is it done this way" — the proxy problem is that question arriving
about a line you did not write.

### ☠️ A hack you carry across releases is a decision, not a stopgap

Also Tim Bird: a quick hack can be the right call once, so the practice is to
**measure how long it has been in your tree** and rework it when it survives from
release to release — and to *tag* such hacks so they can be tracked at all. On a
rolling forward-port this is the difference between a workaround and a private
fork: every rebase that carries a hack forward is a decision to keep it, made
silently. Grep your own tree for the ones you inherited, too — the MSM8953
machine-driver support we build on contains a block whose own comment says
`/* HACK … */`, and it has been rebased for two years.

### `upstreaming` must stay a distillation of `wip`

The rule says the send-shaped branch is regenerated from `wip`, never hand-edited,
and the way it breaks is benign-looking: you run `checkpatch --strict` on the
series branch, fix the alignment complaints there, and never carry them back. Now
regenerating — the documented way to produce the branch — would silently drop
them, and the branch you tested is not the branch you would send.

When a category maps onto exactly one series the check is a plain diff; when it
feeds several trees, it is the line-set union described under
[the branch namespace](#the-branch-namespace-upstreamingseries-replaces-submitbasecat):

```sh
git diff wip/<base>/<cat> upstreaming/<series>    # must be empty (one-series category)
comm -3 /tmp/wip.l /tmp/up.l                      # must list only the deliberate leave-outs named on STATUS.md
```

Two of five branches failed this on 2026-07-30. Run it after every
regeneration, and put style fixes on `wip` first, then cherry-pick.

☠️ **Regenerating a series branch orphans its old commits, and every link to them
dies.** (This is what the `upstreaming/<series>/v<N>` tags exist for: a sent round
stays reachable however often the prep branch is rebuilt.) Documentation that cites a submit-branch hash silently rots: the object
stays in a local clone long after GitHub has pruned it, so the link 404s while
`git cat-file -e` still succeeds. Test reachability, not resolvability:

```sh
git branch -a --contains <hash> | grep -q . || echo "unreachable: $hash"
```

Thirteen documentation links had died this way. Prefer citing the `wip` or
`integration` commit, which survives regeneration.

---

## Patch mechanics (the LKML email path)

These are the standard kernel mechanics the sources below spell out. Since LKML is
now the only open destination, all of them are mandatory — none are optional
GitHub-flow conveniences any more.

- **Base off a well-known point.** A stable or `-rc` tag on Linus' tree (driver
  patches on the subsystem `-next`). Never a random mid-tree commit.
- **`git commit -s`.** The `-s` adds *your* `Signed-off-by` (the DCO). Message in
  **imperative mood** ("add", not "added"), **subject line at most 70–75
  characters** and saying both what changes and why, body wrapped at **~75
  columns**. When the body is hard to start, the shape that works is Matt
  Porter's: *"Current code does (A), this has a problem when (B). We can improve
  this doing (C), because (D)."* — it forces the *why* into the message instead
  of leaving it in the diff. Add a
  `Fixes: <12-char-sha> ("subject")` tag when fixing a known commit, and `Cc:
  stable@vger.kernel.org` for a user-visible bugfix (e.g. the TX front-end hold).
  **`Link:` only when it points at something the commit does not itself contain**;
  a public bug report being fixed takes **`Closes:`** instead. ☠️ *"Private bug
  trackers and invalid URLs are forbidden"* — no vendor-internal tracker, and no
  URL you have not fetched.
- **A pasted oops/trace is trimmed, not transplanted.** `submitting-patches.rst`
  §"Backtraces in commit messages": distill the dump — drop timestamps, module
  lists, register and stack dumps, and the generic entry/syscall tail
  (`el0_svc…`, `invoke_syscall…`, `el0t_64_sync…`); keep the frames that tell
  the story. And keep the oops *header*: the lines above `Call trace:`
  (`Internal error:` / `BUG:` / the `pc :` line) say *what* happened — a trace
  without them shows only *where*, and if the failure was a hang rather than an
  oops, the message must say so in prose instead. Measured 2026-08-18: recent
  qcom-dts commits in mainline that carry a trace all trimmed the timestamps;
  the timestamped counter-examples in the tree are scattered exceptions, not
  the pattern.
- **DT is checked, not just compiled.** For device-tree work run the DT checks —
  `make dtbs_check` (and `make dt_binding_check` if you touch a binding). A commit
  that introduces DT warnings can be **reverted** (`maintainer-soc-clean-dts.rst`),
  so land it warning-free.
- **Bindings vs. DTS route differently.** A YAML **binding** doc
  (`Documentation/devicetree/bindings/…`) travels with the **driver** subsystem
  tree; the board **`.dts`** goes via the **SoC/qcom** tree. Same "don't mix"
  discipline, but know which of the two a given file is.
- **The SoC tree sorts what it takes into named branches** — Olof Johansson's own
  list is `next/fixes-non-critical`, `next/cleanup`, `next/multiplatform`,
  `next/soc`, `next/drivers`, `next/boards`, `next/dt`, and it says "usually
  consists of", so treat the set as approximate. A board `.dts` patch is
  `next/dt` material. **The maintainer does the sorting, not you** — but knowing
  it explains why a series mixing a cleanup, a feature and board wiring has no
  single place to go even inside one tree, and why organising your series along
  those lines makes it easy to apply.
- **The subject line copies the subsystem's own style.** Mark Brown, repeatedly:
  *"Please submit patches using subject lines reflecting the style for the
  subsystem, this makes it easier for people to identify relevant patches. Look at
  what existing commits in the area you're changing are doing and make sure your
  subject lines visually resemble what they're doing."* The command is
  `git log --oneline -20 -- <the file you are touching>`; copy the prefix shape you
  see there rather than inventing one. (He adds *"There's no need to resubmit to
  fix this alone"* — fix it in the next version.)
- **`scripts/checkpatch.pl --strict`** clean — but it *"is not smarter than you.
  If fixing a checkpatch.pl complaint would make the code worse, don't do it"*; say
  why in the cover letter when you don't (see
  [the false positives seen here](#checkpatch-false-positives-seen-on-this-hardware)).
- **Recipients: `get_maintainer.pl` on the generated patch files**, then err on the
  side of more copies — the subsystem list, the developers who recently touched
  these files (`git log -- <file>`), whoever reported the bug, and
  `stable@vger.kernel.org` for a user-visible fix.
  ```sh
  git format-patch -o /tmp/pset <base>..upstreaming/<series>   # or simply: b4 prep --auto-to-cc
  scripts/get_maintainer.pl /tmp/pset/0001-*.patch
  ```
- **The mail form, all of it in one place.** `git send-email`, inline plain text,
  one patch per mail with its own subject and description, the diff rooted at the
  kernel tree (`-p1`, what `git format-patch` emits), a `--cover-letter` for a
  series stating the base and any driver→DTS dependency. It applies the
  `[PATCH n/m]` prefix, the `---` separator and the trailers for you. What each of
  those replaces is a way a patch never reaches a human: an attachment or base64
  (unquotable), ☠️ **HTML mail** (`vger` filters it, so only the maintainer ever
  sees the series and the sender cannot tell), a 300 KB mail carrying five patches,
  thirteen mails sharing one subject and no body, or a "please review" whose
  content is a link to a branch. ☠️ **Prove it before the list sees it**: send the
  series to yourself and `git am` it back — *"Patches which have had gratuitous
  white-space changes or line wrapping performed by the mail client will not apply
  at the other end"* (`email-clients.rst` has the per-client settings). Wrap your
  **prose** too, in patches and replies alike: *"Please fix your mail client to
  word wrap within paragraphs at something substantially less than 80 columns."*
- **`b4`** automates much of this (dependency tracking, checkpatch, formatting and
  sending) — worth using once the series grows.
- **Build in the pmOS chroot.** `pmbootstrap`'s `envkernel.sh` gives the
  reproducible cross-build the postmarketOS mainlining guide uses; the FP3 loop
  already builds via the `linux-fp3` package (cross-ref `fp3-kernel-test`).

---

## Conduct on the list — the ways a series dies with no technical objection

Everything above shapes the patches. This section is about the other half: mail
form, routing, timing and how you answer a review. A technically correct series
loses to any of them. Source: Greg Kroah-Hartman, *How to (not) piss off a kernel
subsystem maintainer*, parts 1–6, 2005-03-31 … 2011-08-08 —
<http://kroah.com/log/linux/maintainer.html> plus `maintainer-02` … `-06`. (That
site is **plain HTTP with no TLS**; a fetcher that upgrades to `https://` gets
`ECONNREFUSED`, so read it with `curl http://…`.)

**Mail form** — every rule Greg's parts 1, 3 and 6 supply (no attachment, no
base64, no HTML, `-p1`, one patch per mail, patches not a branch link) now lives
in [Patch mechanics](#patch-mechanics-the-lkml-email-path) beside the command that
implements it. What follows is the half no tool can do for you.

**Routing and timing.**

- ☠️ **Never route around a maintainer.** Sending the same work to a *different*
  subsystem maintainer to get it merged through another tree is the one item on
  Greg's list that ends a relationship rather than a thread (part 2) — and it
  counts even when the submitter did not realise that was what they were doing.
  Note that the DTS-vs-driver routing rule above is not an exception to this: a
  binding travelling with the driver tree and a `.dts` with the SoC tree is
  *where each file belongs*, not a choice of whom to ask. Build the recipient set
  with `get_maintainer.pl`, Cc the subsystem list, and Cc the proper subsystem
  maintainer even when the patch touches a file another tree carries (part 4's
  patch failed on exactly that).
- ☠️ **The merge window is not review time.** Patches sent while it is open wait
  until it closes; sending them then and asking, hours after it reopens, why 117
  patches have not been applied is precisely part 6. Give weeks, not days.
- ☠️ **Do not ping — resend.** Mark Brown, 2026-06-10, to a "Gentle ping on that
  fix": *"Please don't send content free pings and please allow a reasonable time
  for review… at least a couple of weeks… since they can't be reviewed directly if
  something has gone wrong you'll have to resend the patches anyway, so sending
  again is generally a better approach… if in doubt look at how patches for the
  subsystem are normally handled."*
  (<https://lore.kernel.org/all/aimBR9VyYnK8CpBD@sirena.co.uk/>) Two weeks is the
  number, a resend is the move, and the last clause is a method by itself: when a
  subsystem's habit is unknown, read its list rather than assume this one's.

**Answering a review.**

- ☠️ **Answer on the list.** Replying privately to a question asked publicly hides
  the answer from everyone else and, to the list, looks like no answer at all
  (part 3). Reply-all, quote, trim.
- ☠️ **"Why is it done this way?" is a question, not an attack — and every line in
  the series needs an answer.** This is the item with a specific AI failure mode,
  and [Factual integrity](#factual-integrity--overrides-everything-below) governs
  it: never answer with an invented rationale, and never attribute a line to a
  person, tree or datasheet you have not checked. Part 5 records a submitter who,
  asked why a hunk was written that way, *blamed a non-existent person* — the
  organic form of a hallucinated citation. "I do not know; it was imported from X
  (`Link:`), and I will find out" is an acceptable answer. A fabricated one is not
  survivable.
- **Act on the correction.** Re-sending in v2 the form a reviewer already
  rejected — style comments ignored, the split not done — is part 1's second item,
  and `6.Followthrough.rst` states the consequence flatly: *"If you repost code
  without having responded to the comments you got the time before, you're likely
  to find that your patches go nowhere."* The counterpart duty is
  [Revision mechanics](#self-review-read-the-diff-not-just-the-series): carry
  every `Reviewed-by:`/`Tested-by:` forward.
- ☠️ **Andrew Morton's rule:** *"every review comment which does not result in a
  code change should result in an additional code comment instead"* — a question
  one reviewer had is a question the next reader will have, and this is the
  cheapest way a review round leaves something permanent in the tree.
- **The changelog answers the last round, it does not merely list diffs.**
  *"Reviewers should not have to search through list archives to familiarize
  themselves with what was said last time."*
- **Disagreeing is allowed; digging in is not.** Explain and justify — but
  *"should your explanation not prove persuasive… especially if others start to
  agree with the reviewer, take some time to think things over again."* The
  question behind most comments is *"what will it be like to maintain a kernel
  with this code in it five or ten years later?"*, which is also the answer to
  "why must my clever hack become a generic feature".
- **Expect a second wave.** Entering a subsystem tree and then linux-next puts the
  series in front of new reviewers and surfaces conflicts with other people's
  work; that round is normal, not a setback.

**How a series gets dropped without a NAK.** On the qcom/DT lists the quiet
failure has an explicit form: the maintainer replies *"Dropping from Patchwork"*
and the series leaves the queue. Harvested 2026-08-29, the reasons that actually
produced that sentence in recent months — each one is a rule stated elsewhere in
this skill, here in the form it fails in:

- **An incomplete recipient set** (mechanics in
  [Patch mechanics](#patch-mechanics-the-lkml-email-path)). The point is not
  etiquette: *"You missed at least devicetree list (maybe more), so this won't be
  tested by automated tooling. Performing review on untested code might be a waste
  of time."* The DT list is where the checkers and review bots subscribe, so a
  missing list means nothing machine-readable ever ran — and asserting you ran
  `get_maintainer.pl` is not the same as the result: a submitter who claimed it and
  still missed the list got *"Still not. I do not believe you did it."*
- **An unanswered review comment — including a bot's.** Krzysztof Kozlowski,
  2026-08-27: *"Sashiko comment was not answered and looks reasonable, dropping
  from Patchwork."*
  (<https://lore.kernel.org/all/20260827-tiger-of-sublime-flowers-eb8f90@quoll/>)
  Every comment on the thread gets an answer in the next version or a reply
  saying why not — **including one written by another AI**, which is worth
  internalising in both directions: an agent's review is treated as review here.
- **A tag silently ignored between versions.** *"So you just ignored the tag?
  Sure, we can ignore patches as well. Dropping from patchwork."* (2026-07-07,
  <https://lore.kernel.org/all/8e9a2c05-178b-4360-b814-660d049e50a3@kernel.org/>)
- ☠️ **Interdependent changes split across separate submissions.** Konrad Dybcio,
  on a `Depends-on: <lore URL>` line in a commit message: *"This is not a valid
  tag to put in the commit message. / Why haven't you sent the two clearly
  interdependent patches together?"* — and when the submitter defended the split,
  *"You have been already told TWICE and you keep arguing."*
  (<https://lore.kernel.org/all/c4bf7a4b-48a9-4bfb-b133-858189627639@kernel.org/>)
  Note precisely what this does **not** contradict:
  [a posted prerequisite](#a-dependency-that-was-posted-is-a-citable-prerequisite-not-a-blocker)
  is *somebody else's* patch, cited through `b4`'s `prerequisite-patch-id:`
  machinery below the `---`. Two halves of **your own** change — the driver and
  the DTS that needs it, the SPI node and the device on it — are one series with
  a cover letter, never two submissions pointing at each other. "Different
  internal ownership" is not a reason a list accepts.

☠️ **The `Assisted-by:` trailer is read, and it raises the bar rather than
lowering it.** Two 2026 threads that the authorship rules above do not by
themselves predict:

- On a **one-line** binding patch carrying `Assisted-by: Claude:claude-opus-4-6`,
  Dmitry Baryshkov: *"Claude assisting to write a one-liner patch? It's becoming
  ridiculous."*, then Krzysztof Kozlowski: *"If a human cannot write and validate
  this one, I see as putting effort on maintainers. Dropping from patchwork."*
  (2026-05-30,
  <https://lore.kernel.org/all/20260530-wise-discreet-woodpecker-3c7d0c@quoll/>)
- To a submitter whose defence of a review comment read to the maintainer as
  model output: *"Do not paste us LLM answers, I find it disrespectful in regard
  to my time."* (2026-08-25, same shikra thread as above.)

Three duties follow, and they are the price of this door being open at all:

1. **Disclose accurately, and never drop the trailer to avoid the reaction.**
   Removing a true `Assisted-by:` because it draws fire is falsifying the
   disclosure — [Factual integrity](#factual-integrity--overrides-everything-below)
   forbids it, and `generated-content.rst` is what makes the disclosure the
   condition of acceptance. The correct response to "why did this need an AI" is
   never to hide the answer.
2. **Send fewer, larger, load-bearing patches.** The trailer on a trivial
   one-liner is what triggered the objection; the same trailer on a series that
   carries real measurement is unremarkable. If a change is small enough that the
   disclosure looks absurd, fold it into the series it belongs to rather than
   sending it alone.
3. **Every word you send is yours.** A reply drafted by a model and pasted into a
   thread is the single response most likely to end the conversation — read it,
   cut it to what a person would write, and make sure it answers the question that
   was asked rather than restating the patch. The maintainer in that thread had
   already made the same point twice; the model prose was what turned a technical
   disagreement into a personal one.

**The substance behind the form.**

- ☠️ **A generic IP block does not get an SoC-specific driver.** *"If this is a
  Cadence IP why is the entire driver SoC specific?"* If the block is licensed IP
  that several vendors ship, the driver belongs under the IP vendor with a
  fallback compatible, and only the integration differences are SoC-specific.
- ☠️ **Do not build a special case for one consumer.** Part 4's rejected patch put
  a procfs-shaped API on top of sysfs, and only for one user. A facility only this
  board or this userspace can use is the wrong shape: generalise it, or do not add
  it. The same post's positive half is worth keeping — *posting real code to raise
  a real design question is the best way to work*, so the rejection was of the
  shape, not of the asking.
- ☠️ **A long-lived out-of-tree fork is unreviewed code, and it shows.** Greg's
  standing diagnosis of the Xen submissions applies literally to this port: work
  that has lived on its own branch for years has never met an outside reviewer, so
  the first series attracts structural comments, not typo comments. Expect that
  and read it as review, not rejection.
- **The patch does what its description says, and only that.** One logical change;
  a description of *this* patch rather than of the series or of an earlier
  version; no feature riding inside a "fix"; no new style issues inside a style
  cleanup. Same rules as §"Reduce the number of commits per task" and the
  imperative-mood rule — stated here as the failure modes part 5 actually
  received.
- **It was built, and it was run.** Most of part 5's list is patches that had
  never been compiled, or compiled but never executed — including one that did the
  opposite of what its author wanted. Building every intermediate commit and a
  green `fp3-selftest` on the rebased series are what stand in for "run it" here.

### From the in-tree upstreaming guide (`5.Posting.rst`, `6.Followthrough.rst`)

The kernel's own end-to-end guide is the seven-part *development-process* series.
Most of what it says is distributed through this skill next to the action it
governs — the mail form and recipients in
[Patch mechanics](#patch-mechanics-the-lkml-email-path), the bisect rules under
[§2a](#2a-ordering-a-split-so-that-every-patch-builds-on-its-own), the review
duties under [Conduct](#conduct-on-the-list--the-ways-a-series-dies-with-no-technical-objection).
Four rules have no other home:

- **Post complex work before it is finished, and say so.** *"There is a lot to be
  gained by getting feedback from the community before the work is complete… it is
  a good idea to say so in the posting itself. Also mention any major work which
  remains to be done and any known problems."* For a port that has lived
  out-of-tree for years this is the antidote to never having met an outside
  reviewer: an `[RFC]` naming what is missing buys the structural comments early,
  when they are still cheap to act on.
- **Performance claims come with numbers.** *"If so, you should run benchmarks
  showing what the impact (or benefit) of your change is; a summary of the results
  should be included with the patch."* Same discipline as measuring on the device:
  put the before/after in the message.
- **Be sure you have the right to post the code.** Employer rights — and the case
  that actually arises here, code or values lifted from a vendor tree: what is
  imported must be licence-compatible and attributed, not merely useful.
- **The one-line summary stands alone.** Subsystem prefix, then the effect,
  readable by someone with no other context; and if a specific log or compiler
  output identifies the problem, put that output in the body so the next person
  searching for it lands here.

---

## Before sending: re-check the draft against the latest verdicts

☠️ **A claim in a draft can be internally inconsistent with a table in the same
document and still survive to the recipient.** One outreach message asserted that a
register block was "not AP-readable, ADSP-owned" while a table two paragraphs down
showed that exact register having been read from the AP through `/dev/mem`. The claim
was a leftover from an earlier round; it went out anyway and pulled the reader towards
an ownership hypothesis that had already been excluded.

**Recipe:** before sending anything outward, grep the draft's factual assertions against
the journal's most recent verdicts, and against the draft's own data. A statement that
was true three rounds ago reads exactly like a current one.

## Self-review: read the diff, not just the series

Everything above shapes the *series* — which commits exist, what is imported,
where the DTS goes. This is the other half a maintainer will do if you do not:
review the **code in the diff** itself. Do it as a distinct pass, because it is a
different question and it has a specific failure mode here — **an AI reviewing its
own patch is confirmation bias in pure form**, the same assumptions that wrote the
line re-reading straight past its bug. So this pass leans on **mechanical checkers
that do not care who wrote the line**, and on reading against an external standard,
not on re-reading with the mind that produced the code.

**Prior art, cited because it is worth reading and because one part must *not* be
copied.** Two efforts already encode kernel patch review for an LLM:

- **`jlelli/claude-kernel-reviews`** — a kernel developer's (Juri Lelli) Claude
  Code review workflow: `b4 shazam -l <msgid>` to apply a series, an index of the
  surrounding code (`semcode-index`) so the review is grounded in the tree rather
  than in the diff alone, then `scripts/checkpatch.pl --git HEAD`, `make W=1`,
  `make C=2` (sparse), `make coccicheck`, and a per-patch read against
  `coding-style.rst`. Source:
  <https://github.com/jlelli/claude-kernel-reviews>.
- **Sashiko** — an agent that watches the lists and posts reviews, built around
  *verifying a finding before propagating it* so an AI's false positives do not
  reach the list. That discipline is the point to borrow: a self-review that
  invents objections is worse than none. Source:
  <https://mcpmarket.com/tools/skills/sashiko-kernel-patch-reviewer>.

☠️ **Do not copy the attribution form from a review config into a submission.**
jlelli's setup tags commits `Co-developed-by: CLAUDE <model>` — correct for an
in-house flow, and *invalid upstream*: [Authorship](#authorship-and-provenance)
explains why an AI upstream carries `Assisted-by:` and never a `Co-developed-by:`
or `Signed-off-by:`. Review tooling and a submission answer to different rules.

**The checker gauntlet.** The canonical list is the kernel's own
[submit-checklist](https://docs.kernel.org/process/submit-checklist.html); run
what a cross-build allows and **say in the cover letter which you ran** (this is
also where the `Assisted-by:` optional tool slots come from — list a tool only if
you actually ran it). The incremental build wrapper makes these cheap now
(`fp3-kbuild.sh <args>`, which is envkernel underneath):

- `scripts/checkpatch.pl --strict` **per patch** (already required above, under
  §"Splitting a mixed commit" and the checkpatch traps).
- `make W=1` over the touched files (`fp3-kbuild.sh W=1 <subdir>/`) — the warnings
  gcc suppresses by default; your new lines must add none.
- **sparse** (`make C=2 <file>`, where the chroot has `sparse`) — the class gcc
  cannot see: endianness (`__le*`/`__be*`), `__user`-pointer misuse, lock-context
  imbalance. This is the checker that would have flagged the `qmi_encdec`
  width bug's neighbourhood.
- `make coccicheck` (Coccinelle) and, where present, `smatch` / `clang-analyzer`.
- `make checkstack` when the change adds large on-stack objects.
- `#include` the header for every facility you use — never lean on a transitive
  include — and give every memory barrier a comment saying what it orders (both
  are explicit submit-checklist items).
- New global API gets **kernel-doc**; a new module parameter gets
  `MODULE_PARM_DESC()`; a new Kconfig option gets help text and defaults off.

**Read the diff for the four things no checker sees** — these are the recurring
driver-review comments, and they are what
[submitting-patches](https://docs.kernel.org/process/submitting-patches.html) and
[kernelnewbies PatchTipsAndTricks](https://kernelnewbies.org/PatchTipsAndTricks)
tell you to expect:

- **Locking.** Every lock is dropped on *every* path, the error ones included; no
  sleep under a spinlock (`CONFIG_DEBUG_ATOMIC_SLEEP` proves it on the device);
  the lock actually covers the data it is claimed to. ☠️ **An atomic variable is
  not a substitute for one**: *"either there's a lock missing … or there's no need
  for the use of atomics"* — if a sequence of operations must not interleave, an
  `atomic_t` on one of them proves nothing, and if nothing can interleave, the
  atomic is noise. And a missing barrier between "the device is visible" and "the
  device is ready" is a synchronisation bug to fix in the init order, not to paper
  over with a retry or a delay.
- **Error paths free what the success path took.** `devm_*` where it fits, matched
  `goto` unwinding where it does not. A leak on a failure path is the single most
  common thing a driver review flags.
- **Types describe the hardware, not the C default.** A register field's width
  comes from the datasheet; the one-byte length read as `u32` in `qmi_encdec` is
  the shape of the bug (see [the `Fixes:` recipe](#a-fixes-target-comes-from-blame-never-from-the-files-age)).
- **The message says *why*, imperative mood** ("fix", not "fixed" / "this patch
  fixes"), and any commit it names is `<12-hex> ("subject")` from `git rev-parse`.

**Three more that recent driver reviews kept finding** (same 2026-08-29 harvest):

- **Publish last.** Do not register the device, chardev or class interface before
  its state is fully initialised — the window between "visible" and "ready" is a
  real race, and it is what a review bot found in an NFC probe that registered the
  NCI device before the mode field it depends on was set.
- **Power sequencing is part of probe, not a detail.** A reset line driven before
  its supply is enabled is a bug even when the device happens to come up; assert
  reset *after* the regulator, and say in the commit which order the datasheet
  gives.
- **House style in a reverse-engineered register table.** Hex constants
  **lowercase** (*"Please use lowercase for hex constants."*), no parentheses
  around a plain value, no initialiser on a variable that is assigned before use,
  and `clamp()` rather than a hand-rolled min/max ladder — reviewers of sensor and
  codec drivers ask for all four by name, and a table imported from a vendor tree
  arrives violating them.
- **Use the kernel's accessors.** `get_unaligned_le32()` and friends instead of
  hand-rolled shift-and-or, `FIELD_GET()`/`FIELD_PREP()` for register fields —
  reviewers ask for these by name, and they are the same rule as "types describe
  the hardware". And nothing sleeps in an IRQ handler: `usleep_range()` reachable
  from a hardirq means the work belongs in a threaded handler.

**Subsystem idioms a reviewer will not let pass.** Each of our categories has a
house convention that no compiler or checkpatch enforces, and that a series
touching that subsystem is expected to already know. Read the subsystem's own
document before writing, not after the comment arrives:

- **power-supply (charger, fuel gauge).** The class has fixed units, and
  `power_supply_class.rst` states them: *"All voltages, currents, charges,
  energies, time and temperatures in µV, µA, µAh, µWh, seconds and tenths of
  degree Celsius unless otherwise stated. It's driver's job to convert its raw
  values to units in which this class operates."* A driver that reports mV
  because the register holds mV is wrong, however consistent it looks with the
  datasheet — and this is the one place where a raw hardware number must **not**
  reach the interface unconverted.
- **Runtime PM (camera AF rail, codec, anything with a `pm_runtime_get`).** Use
  `pm_runtime_resume_and_get()`, not `pm_runtime_get_sync()`:
  `runtime_pm.rst` says get_sync *"does not drop the device's usage counter on
  errors, so consider using pm_runtime_resume_and_get() instead of it, especially
  if its return value is checked by the caller"*. The failure it prevents is a
  leaked usage count that pins the device awake forever — invisible in testing,
  and one of the standing review comments on V4L2 sensor drivers.
- **ASoC controls.** An on/off control is a **Switch**, not a two-entry enum:
  *"On/off switches should be a Switch control, not an enum."* And a new control
  follows the behaviour the rest of that driver already has — *"Other controls in
  this driver ignore writes before hw_init is set, should this one?"* — because a
  driver that answers a write differently in two places is the inconsistency the
  reviewer reads first.
- **A mixer control's `put()` reports change, not success.** Return 1 only when
  the written value differs from what was there, 0 when it does not: *"This will
  also unconditionally report that the value of the mux changed, the function
  should return 0 if the value written is the control value hasn't changed"*.
  Userspace event delivery hangs off that return.
- ☠️ **regmap: a volatile register is marked volatile, and never given a
  default.** Mark Brown on a WCD939x codec driver, 2023-12-13: *"There's a bunch
  of registers like this which look like they should be volatile and are actually
  volatile which makes supplying defaults rather strange - in general volatile
  registers shouldn't have defaults."*
  (<https://lore.kernel.org/all/e8b5099c-ceb2-4605-94bc-efd09ad55cb7@sirena.org.uk/>)
  The rule to carry: in a cached regmap, **status, interrupt and any
  hardware-updated register must be in `volatile_reg`**, or a read is answered
  from the cache and a write of the cached value is dropped entirely. That is not
  only a review comment — it is a whole class of "the driver polls a bit that
  never changes" bug, and the instrument that would catch it must not be the same
  regmap.
- **V4L2 sensors: link frequency is a control, and a read-only one.** A sensor
  exposing `V4L2_CID_PIXEL_RATE` without `V4L2_CID_LINK_FREQ` draws the question
  every time — *"What about the link frequency? Is this value constant for the
  sensor? Or should there be a list of hardware supported link frequencies?"* —
  and the frequency list belongs to the board (DT `link-frequencies`), so the
  control is flagged `V4L2_CTRL_FLAG_READ_ONLY` after the handler is initialised.
  A hard-coded external clock rate gets the same question.
- **One pair of power functions, not two.** *"There's really no need for two pairs
  of functions doing the same things"* — the runtime-PM callbacks *are* the
  power-on/power-off path; do not keep a parallel pair beside them.
- **Everywhere.** Before adding a control, a property or a sysfs value, grep the
  subsystem for the same concept under its established name. The generic version
  of every bullet above is: the interface is the subsystem's, not this driver's.

**Tags are attributions, and most of them need permission.**
`submitting-patches.rst` §"Tagging people requires permission": every trailer
naming a person **except `Cc:`, `Reported-by:` and `Suggested-by:`** needs that
person's explicit permission. So the duty to
[carry `Reviewed-by:`/`Tested-by:` forward](#self-review-read-the-diff-not-just-the-series)
has an exact mirror: ☠️ **never add one that was not given.** A reviewer who
commented, or whose objection you addressed, has not thereby reviewed the next
version — *"You can't add Reviewed-by: tags that haven't been explicitly (or
otherwise) given"* is a real review reply, and the reason is that the tags stop
meaning anything if senders infer them. This is a fabrication risk in exactly the
shape [Factual integrity](#factual-integrity--overrides-everything-below)
describes: a plausible trailer that no one wrote. Collect them mechanically —
`b4 trailers -u` reads what was actually posted — rather than from memory.

**Two more the commit message itself has to carry.** Bjorn Andersson, asking for
the crash details to be written into a fix: *"It would be wonderful, for my
understanding today, as well as people in the coming months to be able to search
for the callstack etc on the mailing list, if you could provide some details about
the crash."* The trimmed backtrace rule above says what to cut; this says why what
remains matters — the message is the searchable record for whoever hits the same
symptom in a year, so the symptom must appear in it in the words they will search
for. And when a change logically applies to more platforms or boards than the one
you tested, either apply it to all of them or say in the message which you left
and why; a silently partial cleanup is the thing that gets found much later, by
someone else.

**Revision mechanics**, once a v1 has been reviewed (from
[kernelnewbies PatchTipsAndTricks](https://kernelnewbies.org/PatchTipsAndTricks)):
never hand-edit a generated patch's body or its subject beyond the `[PATCH vN]`
prefix — maintainers read a mutt-edited diff as sloppy; **carry every
`Reviewed-by:`/`Tested-by:` a reviewer gave into the next version** (silently
dropping them is how you lose reviewers); put the inter-version changelog **below
the `---`** so it never lands in the git log; `[RFC]` marks a first-time feature,
not a bugfix.

The functional gate does not move: a green `fp3-selftest` and the rebase/CONFIG
pass in [the rebase-and-retest gate](#the-rebase-and-retest-gate-do-not-skip-before-submitting)
are what `generated-content.rst` invites a maintainer to *demand* of tool-assisted
work — so a self-review that stops at "sparse is clean" is half done.

## Pre-submit checklist

Grouped, and each line is the *whole* rule — the sections above carry the why.

**Tracking (the gate ran, and the page will record this send)**

- [ ] The gate in [Tracking the submissions](#tracking-the-submissions--the-upstreaming-namespace-and-the-one-status-page)
      ran on this machine: `docs/upstreaming/STATUS.md` exists with the fixed
      header, `b4` is installed, the review plugin tracks every `D-` dependency,
      no `submit/*` branch is still in use, and `releases.json` says `-rc`.
- [ ] The series has its section on STATUS.md with Category, Tree, Source,
      Depends, a filled **Test** block (booted branch @ sha, device, battery
      result with capture link, checker line), and its `state` is `tested`.
- [ ] The branch is `upstreaming/<series>` as a `b4 prep` branch; the send will be
      `b4 send`, followed by the `upstreaming/<series>/v<N>` tag and a Rounds row
      carrying the lore link of our own mail.
- [ ] If this is v(N+1): every "asked for" item of the previous Rounds row is
      handled or disputed with a link, the per-version changelog sits under `---`,
      given tags were pulled with `b4 trailers -u`, and at least a day has passed
      since the last reply.

**Destination and base**

- [ ] Destination is **LKML** — msm8953-mainline will not merge AI-assisted work,
      pmOS bans it. No PR against `<base>/main`.
- [ ] Base is correct and fresh (driver → the subsystem `-next`, e.g.
      `sound/for-next`; DTS → fresh torvalds), and the series was **trial-rebased
      onto it** on a throwaway head. Never a stale mirror, never a shallow clone's
      idea of history; "the files exist upstream" answers a different question.
- [ ] Rebased across any base bump; **rebuilt + CONFIG-checked + `fp3-selftest`
      green** on the rebased series.

**Shape of the series**

- [ ] **One branch for the whole subsystem** (audio/camera/charger/sensor/voice),
      not sub-split; commit count reduced, discovery steps consolidated, a
      standalone bugfix kept apart so it can carry `Fixes:`.
- [ ] **Every patch builds *and boots* on its own**, and none adds infrastructure
      that stays unused until a later patch.
- [ ] **No commit mixes `.dts`/`.dtsi` with `.c`/`.h`**, and the DTS side is split
      per logical step with no style/cleanup riding along.
- [ ] **The import is its own commit**, byte-identical and attributed, with your
      changes in the next one and any style cleanup in a third.
- [ ] **`git diff wip/<base>/<cat> upstreaming/<series>` is empty** (or, for a
      category feeding several trees, the line-set union check lists only the
      leave-outs named on STATUS.md) — no fix applied on the series side only.
- [ ] **Interdependent changes are in one series**, not two submissions citing each
      other (`Depends-on:` is not a kernel tag). A *foreign* posted prerequisite is
      declared with `b4`'s `prerequisite-patch-id:`, found by searching patchwork
      for the file name; never posted at all means the series is not sendable.

**Device tree and bindings**

- [ ] **Every node the DTS adds or enables is real and was measured working** — no
      node exists only to instantiate a driver (no `reg`/irq/clock/supply of its
      own), nothing inherited untested from the vendor tree is enabled, and a
      not-yet-working node stays `status = "disabled"` in the SoC DTSI. Verified on
      the device: nothing the series adds is left unbound.
- [ ] **No board/battery fact hidden in the driver.** Grep the diff for constants
      added to a variant/quirk table; policy numbers belong in the DT. Applied to
      every board this file serves, is each still described correctly?
- [ ] **Every vendor-sourced value answers two questions**: where it came from, and
      how we know that variant applies to *this* board (name the discriminator and
      the reading when the vendor tree ships alternatives).
- [ ] **DTS form**: GPIO flags state the logical level even where an in-tree driver
      has it backwards, `interrupts-extended`, no pin levels in a pinctrl state,
      generic node names, nodes in address order, `reg` covering the whole block.
- [ ] **Binding form**: filename matches the compatible, no rename of an existing
      binding, subject `dt-bindings: <subsystem>: Add <device>` naming hardware,
      hyphens not underscores, vendor properties typed via `types.yaml`, `$ref` to
      the common schema for pattern-matched subnodes, standard property preferred,
      two sibling bindings read for the established pattern.
- [ ] **No property added to a legacy `.txt` binding** — convert to YAML first, as
      its own patch — and each new compatible names one SoC even where one driver
      serves the family.
- [ ] **DT work is warning-free, measured as a differential** (this base fails
      `dtbs_check` by itself): `dt_binding_check` with an up-to-date dtschema
      (`pip3 install dtschema --upgrade`), `$id` matching the file path, the example
      compiling with every `required:` property, `yamllint` against the bindings'
      config, `CHECK_DTBS=y` on the real board DTB.
- [ ] **A new compatible has a binding.** Until it does, `dtbs_check` skips its node
      **silently**, so a clean run proves nothing about it.

**The code**

- [ ] **The checker gauntlet was run and named in the cover letter**:
      `checkpatch --strict` per patch, `make W=1` over the touched files adding no
      warning, `sparse` (`make C=2`), `coccicheck`.
- [ ] **The diff was read for what no checker sees**: locking dropped on every path
      including error ones (and an `atomic_t` is not a lock), error paths freeing
      what success took, register types from the datasheet not the C default,
      nothing registered before it is initialised, power sequenced before reset.
- [ ] **The subsystem's own idioms were used**: power-supply in µV/µA/µAh/tenths of
      °C, `pm_runtime_resume_and_get()`, one pair of power functions, an ASoC on/off
      control as a Switch whose `put()` returns 1 only on a real change, a V4L2
      sensor exposing a read-only `LINK_FREQ` beside `PIXEL_RATE`, `volatile_reg`
      covering every status/interrupt register and no defaults on them.
- [ ] **Imported register tables brought to house style**: lowercase hex, no stray
      parentheses, no needless initialisers, `clamp()` over a min/max ladder.

**Provenance and authorship**

- [ ] Human `Signed-off-by` on **every** commit — audit for empty trailers; **no
      `Signed-off-by` from the AI**; `Co-authored-by:` swapped for `Assisted-by:`
      naming the model that actually did the work.
- [ ] **Nothing rests on a commit with no `Signed-off-by`** — an imported WIP cannot
      be signed on its author's behalf; and if the author's own series is in flight
      on patchwork, reply to it instead of competing with it.
- [ ] **The immediate source of every imported file is named** — from the *commit*,
      not a merge-request page or a remembered nickname — the original was fetched
      and diffed so the delta is a number, and every borrowed piece carries its
      authors and a `Link:`/`commit …` reference.
- [ ] **Prior art was searched before writing, not after**, for every file not in
      Linus' tree; `Fixes:` comes from `git blame` on the real tree, never from the
      file's age.
- [ ] Cover letter carries the `generated-content.rst` disclosure (tools, prompts or
      a summary, which portions were tool-affected, how it was tested) and states the
      base; a driver→DTS dependency is noted on the DTS patch.

**The mail**

- [ ] **Any cross-tree dependency was agreed by email with both maintainers**, and
      any branch another tree pulls is frozen — never rebased. Where a single tree
      could take both halves, that was *asked*, not assumed.
- [ ] **The mail says what it wants**: review, or application. Most of what a SoC
      maintainer receives is for review, so an applicable series says so.
- [ ] **`defconfig` was checked, not assumed**: every `CONFIG_` symbol the series
      needs is either already in `arch/arm64/configs/defconfig` or added by a
      patch in the series.
- [ ] Commits are `-s` signed, imperative-mood, wrapped ~75 cols, subject lines
      visually matching the subsystem's own (`git log --oneline -20 -- <file>`);
      `Fixes:`/`Cc: stable` on bugfixes; `Link:` only when it adds what the commit
      does not, `Closes:` for a public bug report, no private tracker URL and no
      unfetched link.
- [ ] **Any oops/trace is trimmed** per `submitting-patches.rst` §Backtraces — no
      timestamps, module lists, register/stack dumps or generic syscall tail — with
      the oops *header* kept.
- [ ] **The mail is submittable**: `git send-email`, inline plain text, `-p1`, one
      patch per mail with its own subject and description, no attachment/base64/HTML,
      no branch link in place of patches — **proved by mailing it to yourself and
      `git am`-ing it back**.
- [ ] **Recipients from `get_maintainer.pl` on the generated patches**, DT list and
      subsystem list actually present in the `To:`/`Cc:` (checked, not asserted —
      a missing list means no automated tooling runs), plus recent touchers and
      `stable@` where it applies. Nobody was routed around.
- [ ] **Not sent into an open merge window**, and no content-free ping: a couple of
      weeks, then resend.

**The thread**

- [ ] **Every comment on the previous version was answered** — including a review
      bot's — in the changelog (below the `---`, saying what was raised and how it
      was handled) or in a reply on the list; no tag given earlier was dropped.
- [ ] **Review tags carried forward, and none added that was not given**: everything
      but `Cc:`, `Reported-by:` and `Suggested-by:` needs explicit permission,
      collected with `b4 trailers -u`; the generated patch body was not hand-edited.
- [ ] **Every "why is this so?" has a checked answer** — no invented rationale, no
      attribution to a person, tree or datasheet that was not verified — and every
      comment that produced no code change produced a code comment instead.
- [ ] **Nothing pasted from a model into the thread.** The `Assisted-by:` trailer
      stays (removing a true disclosure falsifies it), every reply is written and
      checked by the human sending it, and a trivial one-liner is folded into the
      series it belongs to rather than sent alone.
- [ ] **No published branch was force-pushed without tagging the old tip**, and any
      pinned `_commit` still resolves (`curl -sL …/archive/<sha>.tar.gz` → 200).
- [ ] **Every form question was answered from a stated rule, not from habit**: if a
      linked doc governs a part this skill does not distil, that section was fetched,
      read — and its rule added here.

---

## See also — the source material

This skill consolidates FP3-specific decisions on top of existing, authoritative
guides. When in doubt, these are the ground truth:

**The process (worked examples closest to this task)**
- postmarketOS Mainlining guide: <https://wiki.postmarketos.org/wiki/Mainlining>
- Per-SoC bring-ups (same Qualcomm shape as the FP3):
  <https://wiki.postmarketos.org/wiki/MSM8916_Mainlining>,
  <https://wiki.postmarketos.org/wiki/MSM8996_Mainlining>,
  <https://wiki.postmarketos.org/wiki/SDM845_Mainlining>
- msm8953-mainline kernel (points to the kernel docs, no repo-specific flow):
  <https://github.com/msm8953-mainline/linux>

**The authoritative in-tree docs (mandatory reading before v1)**
- Submitting patches — the essential guide:
  <https://docs.kernel.org/process/submitting-patches.html>
- The *development-process* series — the kernel's own end-to-end upstreaming
  guide; parts 5 and 6 are distilled above:
  <https://docs.kernel.org/process/development-process.html>,
  <https://docs.kernel.org/process/5.Posting.html>,
  <https://docs.kernel.org/process/6.Followthrough.html>
- Email clients that do not corrupt patches:
  <https://docs.kernel.org/process/email-clients.html>
- Submit checklist: <https://docs.kernel.org/process/submit-checklist.html>
- DT binding submission:
  <https://docs.kernel.org/devicetree/bindings/submitting-patches.html>
- SoC DTS conventions (the "don't mix / warning-free / route by tree" rules):
  <https://docs.kernel.org/process/maintainer-soc-clean-dts.html>
- AI attribution (`Assisted-by:`):
  <https://docs.kernel.org/process/coding-assistants.html>
- Tool-generated content — the disclosure rules and maintainer discretion:
  <https://docs.kernel.org/process/generated-content.html>

**The policies that closed the other two doors**
- postmarketOS AI policy (total ban):
  <https://docs.postmarketos.org/policies-and-processes/development/ai-policy.html>
- msm8953-mainline maintainer statement, 2026-07-25:
  <https://github.com/msm8953-mainline/linux/issues/197>

**Device-porting guides (the phone-shaped end of the process)**
- postmarketOS *Mainlining* — the "do not copy downstream as-is" rule above, plus
  the tree-choice and getting-started steps:
  <https://wiki.postmarketos.org/wiki/Mainlining> ☠️ behind an Anubis bot wall:
  `curl` gets a 7 kB "Making sure you're not a bot!" page with HTTP 200 on every
  URL including `?action=raw`, so it has to be saved from a browser. Its SoC
  feature matrix is exactly the kind of status this skill must not copy.
- postmarketOS *Submitting Patches* (the Linux section is its upstream overview):
  <https://wiki.postmarketos.org/wiki/Submitting_Patches>
- `git send-email` tutorial: <https://git-send-email.io/>

**First-patch tutorials (informal but complete)**
- <https://opensource.com/article/18/8/first-linux-kernel-patch>
- <https://www.linaro.org/blog/becoming-a-kernel-developer-part1-posting-your-first-patch/>
- <https://nickdesaulniers.github.io/blog/2017/05/16/submitting-your-first-patch-to-the-linux-kernel-and-responding-to-feedback/>

**The series tool and the tracking page**
- `b4` — contributor workflow (`prep`, `send`, `trailers`, deps):
  <https://b4.docs.kernel.org/en/latest/contributor/overview.html>, source
  <https://github.com/mricon/b4>
- `jlelli/claude-kernel-reviews` `/track`, `/status`, `/update` — used here only
  for the foreign series in the dependency list:
  <https://github.com/jlelli/claude-kernel-reviews>
- SoC-tree rules the DTS-last ordering comes from:
  <https://docs.kernel.org/process/maintainer-soc.html>
- The page itself (state, never copied into this skill):
  <https://github.com/llg179org/fp3-pmaports/blob/main/docs/upstreaming/STATUS.md>

**Kernel review tooling — prior art the "Self-review" pass is built on**
- The submit checklist enumerated in that pass:
  <https://docs.kernel.org/process/submit-checklist.html>
- `jlelli/claude-kernel-reviews` — a kernel developer's Claude Code review
  workflow (b4 + semcode-index + W=1/sparse/coccicheck per patch):
  <https://github.com/jlelli/claude-kernel-reviews>
- *Sashiko* — an agentic list-watching reviewer, notable for verifying findings
  before propagating them:
  <https://mcpmarket.com/tools/skills/sashiko-kernel-patch-reviewer>
- kernelnewbies PatchTipsAndTricks — revision/repost mechanics and the review
  comments to expect: <https://kernelnewbies.org/PatchTipsAndTricks>
- Andi Kleen, *On submitting kernel patches* (a classic catalogue of the comments
  reviewers give): <https://halobates.de/on-submitting-patches.pdf>
- Tim Bird, *Overcoming Obstacles to Mainlining* (ELCE 2014) — a survey of why
  people who can upstream do not; the source of the proxy problem and of the
  "measure how long a hack has lived in your tree" practice. Most of it is about
  corporate obstacles that do not apply to a personal port; those two do.
- Neil Armstrong, *No, It's Never Too Late to Upstream Your Legacy Linux Based
  Platform* (ELCE 2016) — workflow shapes for carrying a BSP and an upstream
  effort at once, and the calibration distilled in
  [`fp3-pmaports/docs/upstreaming/bringup/`](https://github.com/llg179org/fp3-pmaports/blob/main/docs/upstreaming/bringup/README.md).
- Olof Johansson, *arm-soc* (ELC 2013) — the SoC maintainer's own account of the
  category branches, the cross-tree dependency handshake and why a driver/DTS
  split keeps bisectability. ☠️ A 2013 deck: `arm-soc` is today's `soc/soc.git`
  and the maintainers have changed, but the mechanics it describes have not.
- Matt Porter, *Upstreaming 201* (Linaro Connect HKG15, 2015-02-10) — worked
  examples of a new platform and a new driver going upstream; the source of the
  subject-length rule, the (A)(B)(C)(D) commit-message shape, the arm-soc branch
  split and the defconfig element:
  <https://www.slideshare.net/slideshow/hkg15901-upstreaming-201/44896634>
  ☠️ SlideShare answers `curl` with a 3 kB "Client Challenge" bot page; and the
  deck titles itself HKG15-**902** while the URL says 901. Being a 2015 deck, its
  `arm-soc` is today's `soc/soc.git` — the branch names survived the rename.
- Greg Kroah-Hartman, *How to (not) piss off a kernel subsystem maintainer*,
  parts 1–6 — the list-conduct failures distilled in
  [Conduct on the list](#conduct-on-the-list--the-ways-a-series-dies-with-no-technical-objection):
  <http://kroah.com/log/linux/maintainer.html>,
  [-02](http://kroah.com/log/linux/maintainer-02.html),
  [-03](http://kroah.com/log/linux/maintainer-03.html),
  [-04](http://kroah.com/log/linux/maintainer-04.html),
  [-05](http://kroah.com/log/linux/maintainer-05.html),
  [-06](http://kroah.com/log/linux/maintainer-06.html).
  ☠️ Plain HTTP only — an `https://` upgrade answers `ECONNREFUSED`.

## Feeding the method back

This skill improves the same way the other two do, through the shared logs
`fp3-porting-debug` owns ("Feeding the method back"). Append a `NEW`-tagged entry
to `fp3-skill-feedback-log.md` whenever a submission earns a *transferable*
lesson — a maintainer's response that contradicts something written here, a
commit-form rule that turned out to matter, a citation that could not be
verified. Review outcomes are not status to be tracked here; what belongs here is
only what would still be true for the next series.
