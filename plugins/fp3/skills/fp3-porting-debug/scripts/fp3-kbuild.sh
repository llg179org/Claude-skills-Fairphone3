#!/bin/bash
# SPDX-License-Identifier: GPL-2.0-or-later
# fp3-kbuild.sh — incremental cross-builds of the FP3 kernel, without the
# thirty-minute package round trip.
#
# The package build starts from a fresh source tarball on every _commit bump,
# so nothing survives between builds and a six-file change costs as much as a
# clean tree: measured on this machine, 16 to 33 minutes. pmbootstrap's
# envkernel wraps `make` so it cross-compiles inside the chroot but keeps the
# objects out of tree in $TREE/.output, which does survive — so the second and
# every later build compiles only what changed.
#
# Usage, from anywhere:
#   fp3-kbuild.sh setup [tree]        # one time per tree: prepare .output/.config
#   fp3-kbuild.sh <make args...>      # e.g. drivers/media/platform/qcom/camss/
#   fp3-kbuild.sh Image modules       # first build on a fresh tree, see below
#   fp3-kbuild.sh modules             # everything loadable, incrementally
#   fp3-kbuild.sh ko <module-name>    # print the path of a freshly built .ko
#
# Builds run at -j$(nproc); override with FP3_KJOBS.
#
# ☠️ `modules` alone cannot work on a tree that has never built vmlinux.o:
# scripts/Makefile.modpost falls back to `modules-only.symvers` and runs modpost
# without it, so every symbol exported by built-in (=y) code comes back
# undefined - tens of thousands of them, naming things like kernel_neon_begin
# that are obviously not the fault of whatever you changed. The one-line tell is
# "WARNING: vmlinux.o is missing" just above. Build `Image modules` once per
# fresh .output; after that Module.symvers exists and `modules` is incremental.
#
# The tree defaults to the branch the package pins (debug-int), because that is
# what the phone runs; override with FP3_KTREE.
#
# ☠️ envkernel forces CCACHE_DISABLE=1, so the *first* full build here is not
# faster than the package one. The point is every build after it.
#
# ☠️ Never run this while `pmbootstrap build linux-fp3` is in flight. Both
# bind-mount the source at /mnt/linux inside the same native chroot, and the
# collision is invisible until the package build tears down: it dies with
# `Command failed (exit code 32): sudo umount .../chroot_native/mnt/linux`,
# minutes after the run that broke it, looking like a chroot bug. One at a time.

set -u

PMOS="${FP3_PMOS:-/mnt/1TB/pmos}"
TREE="${FP3_KTREE:-$PMOS/fp3-sensors-wt}"     # debug-int/<base>: what the phone runs
CONFIG="${FP3_KCONFIG:-$PMOS/pmaports/device/testing/linux-fp3/config-fp3.aarch64}"
APKBUILD="${FP3_KAPKBUILD:-$PMOS/pmaports/device/testing/linux-fp3/APKBUILD}"
ENVKERNEL="$PMOS/pmbootstrap/helpers/envkernel.sh"

# ☠️ envkernel builds its make command with no -j at all: it is written to be
# sourced into an interactive shell, where you type the -j yourself. Driven from
# a script the omission is invisible and costs hours - measured here, a from-
# scratch vmlinux ran one compiler at a time on a six-core machine and was still
# in lib/ after two hours nineteen. So pass one; the tell that it is missing is
# a single cc1/clang in `pgrep -c`, not anything in the log.
#
# Two cores are left free rather than filling the machine: this is a desktop
# somebody is using while the build runs, and a build that makes the session
# stutter gets killed, which costs more than the two cores ever save.
JOBS="${FP3_KJOBS:-$(( $(nproc) > 2 ? $(nproc) - 2 : 1 ))}"

die() { echo "fp3-kbuild: $*" >&2; exit 1; }

[ -r "$ENVKERNEL" ] || die "no envkernel helper at $ENVKERNEL (set FP3_PMOS)"
[ -d "$TREE" ] || die "no kernel tree at $TREE (set FP3_KTREE)"

# envkernel re-runs `pmbootstrap init` and dies if it cannot find the config
# where pmbootstrap looks for it, which is not where this project keeps it.
CFG="${XDG_CONFIG_HOME:-$HOME/.config}/pmbootstrap_v3.cfg"
[ -e "$CFG" ] || die "symlink $PMOS/pmbootstrap_v3.cfg to $CFG first"

cd "$TREE" || die "cannot enter $TREE"

# With O=.output the config belongs in .output and a stray one in the source
# tree makes the outputmakefile target fail.
[ -e .config ] && die "remove the stray .config in $TREE — with O=.output it lives in .output"

# ☠️ Do not treat envkernel's own exit status as failure. It returns non-zero
# in situations that have nothing to do with the setup succeeding - the
# "your chroots are older than two days" advisory is one, which means a script
# that gates on the status starts failing on a a calendar boundary, days after
# it last worked and with nothing having changed. What matters is whether it
# set $pmbootstrap, so test that instead.
#
# envkernel is written to be sourced into an INTERACTIVE shell, and it fights a
# script two ways. It exposes `pmbootstrap` and `make` as shell ALIASES, which a
# non-interactive script never expands ("pmbootstrap: command not found"); and
# sourcing it into the main shell terminates the script (it is meant to leave you
# *in* the env). Both are contained by sourcing it inside a subshell and then
# bypassing the aliases there: its own internals drive the chroot through the
# `$pmbootstrap` VARIABLE it also sets, so the mount and setup still happen, and
# `alias make=...` still populates `BASH_ALIASES[make]` even without expansion —
# so the build is that alias body with the nested `pmbootstrap` alias swapped for
# its path. `_envmake` assumes envkernel is already sourced in the current
# subshell.
_envmake() {
    [ -n "${pmbootstrap:-}" ] || { echo "envkernel did not set \$pmbootstrap" >&2; return 1; }
    local m="${BASH_ALIASES[make]:-}"
    [ -n "$m" ] || { echo "envkernel did not define its make alias" >&2; return 1; }
    # The alias body names `pmbootstrap` twice - once in a banner echo, once as
    # the real command - so substitute every occurrence, not just the first.
    eval "${m//pmbootstrap/$pmbootstrap} \"\$@\""
}

case "${1:-}" in
setup)
    [ -r "$CONFIG" ] || die "no config at $CONFIG (set FP3_KCONFIG)"
    # The chroot's build user (pmos) writes .config and every object into
    # .output, so it must be writable by that user. A host-side `mkdir` makes it
    # host-owned and the chroot cp then fails with EPERM - and olddefconfig
    # silently falls back to the arch defconfig, which builds a kernel for a
    # different phone. So create it and make it writable to the chroot user; the
    # chmod is a no-op if it is already chroot-owned from a previous setup.
    mkdir -p .output
    chmod 0777 .output 2>/dev/null || true
    cp "$CONFIG" ./fp3-kbuild.config || die "cannot stage the config in the tree"

    # ☠️ Everything below happens inside ONE sourcing of envkernel, on purpose.
    # Each sourcing tries to umount /mnt/linux in the chroot and bind-mount it
    # again; when the umount fails as busy it mounts *on top* rather than
    # erroring, so every extra invocation leaves another layer behind. Over a
    # session of many small calls the mount namespace fills up, and what that
    # looks like is nothing to do with mounts: "No space left on device" with
    # hundreds of gigabytes free, a df that hangs, and a desktop that stutters
    # because every /proc read now walks a vast mount table.
    #
    # ☠️ The config file is NOT the device's config. The package copies it and
    # then turns a list of symbols on in prepare(), because the inherited
    # upstream config enables none of them - the charger, the codec, the
    # speaker amp, the camera sensors, the panel, SLIMbus. Build from the file
    # alone and every one of those is silently absent: the build is green, the
    # modules link, and the ones you came for were never in it. Nothing warns,
    # because not building a driver is a legitimate configuration.
    #
    # The list is replayed out of the APKBUILD rather than restated here, so it
    # cannot drift from the package - and the drift's symptom would again be an
    # absence. Comments are stripped first: prepare() explains a renamed symbol
    # by naming the old one, and taking that literally fails the gate below on a
    # symbol that is supposed to be absent.
    SYMS=$(sed -n '/^prepare()/,/^}/p' "$APKBUILD" 2>/dev/null |
               grep -v '^[[:space:]]*#' |
               grep -oE 'CONFIG_[A-Z0-9_]+' | sort -u)
    [ -n "$SYMS" ] || die "found no CONFIG_* to enable in $APKBUILD prepare()"

    CFGARGS=()
    for c in $SYMS; do CFGARGS+=(--module "$c"); done

    ( set +u; set --  # envkernel is not set -u clean, and `.` passes our $@ to it
      # shellcheck disable=SC1090
      . "$ENVKERNEL" >/dev/null 2>&1
      [ -n "${pmbootstrap:-}" ] || { echo "envkernel did not set \$pmbootstrap" >&2; exit 1; }

      "$pmbootstrap" -q chroot --user -- cp /mnt/linux/fp3-kbuild.config \
                                            /mnt/linux/.output/.config || exit 1
      _envmake olddefconfig || exit 1
      # One chroot call with every --module, not one per symbol: entering the
      # chroot is not free, and pmbootstrap passes argv straight through, so no
      # shell is involved - a `sh -c "cd X && Y"` here loses its quoting and
      # silently runs Y in the wrong directory.
      "$pmbootstrap" -q chroot --user -- /mnt/linux/scripts/config \
          --file /mnt/linux/.output/.config "${CFGARGS[@]}" || exit 1
      _envmake olddefconfig || exit 1 ) \
        || die "could not prepare .output/.config through the chroot"

    rm -f ./fp3-kbuild.config

    # And gate on the result, because --module is not a promise: a symbol whose
    # dependencies are unmet is dropped by olddefconfig without a word, which is
    # exactly how a renamed symbol disappears across a version bump.
    missing=
    for c in $SYMS; do
        grep -qE "^$c=(m|y)$" .output/.config || missing="$missing $c"
    done
    [ -z "$missing" ] || die "these did not survive olddefconfig:$missing"

    echo "fp3-kbuild: $TREE is set up; .output/.config from $(basename "$CONFIG")"
    echo "fp3-kbuild: $(echo "$SYMS" | wc -l) symbols enabled from $(basename "$(dirname "$APKBUILD")")/APKBUILD, all present"
    ;;
ko)
    [ $# -ge 2 ] || die "usage: fp3-kbuild.sh ko <module-name>"
    find .output -name "$2.ko" -print -quit
    ;;
"")
    die "usage: fp3-kbuild.sh setup | <make args> | ko <module>"
    ;;
*)
    [ -r .output/.config ] || die "run 'fp3-kbuild.sh setup' first"
    ( set +u                 # envkernel.sh is not set -u clean
      _args=( "$@" ); set -- # and `.` passes our positional params to what it sources,
                             # so save the make args, then clear $@ before sourcing
      # shellcheck disable=SC1090
      . "$ENVKERNEL" >/dev/null 2>&1
      [ -n "${pmbootstrap:-}" ] || exit 1
      _envmake -j"$JOBS" "${_args[@]}" )
    ;;
esac
