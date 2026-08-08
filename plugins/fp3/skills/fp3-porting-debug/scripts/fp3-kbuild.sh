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
#   fp3-kbuild.sh modules             # everything loadable, incrementally
#   fp3-kbuild.sh ko <module-name>    # print the path of a freshly built .ko
#
# The tree defaults to the branch the package pins (debug-int), because that is
# what the phone runs; override with FP3_KTREE.
#
# ☠️ envkernel forces CCACHE_DISABLE=1, so the *first* full build here is not
# faster than the package one. The point is every build after it.

set -u

PMOS="${FP3_PMOS:-/mnt/1TB/pmos}"
TREE="${FP3_KTREE:-$PMOS/fp3-sensors-wt}"     # debug-int/<base>: what the phone runs
CONFIG="${FP3_KCONFIG:-$PMOS/pmaports/device/testing/linux-fp3/config-fp3.aarch64}"
ENVKERNEL="$PMOS/pmbootstrap/helpers/envkernel.sh"

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
    ( set +u; set --  # envkernel is not set -u clean, and `.` passes our $@ ("setup") to it
      # shellcheck disable=SC1090
      . "$ENVKERNEL" >/dev/null 2>&1 || exit 1
      "$pmbootstrap" -q chroot --user -- cp /mnt/linux/fp3-kbuild.config \
                                            /mnt/linux/.output/.config ) \
        || die "could not place the config into .output through the chroot"
    rm -f ./fp3-kbuild.config
    ( set +u; set --  # envkernel is not set -u clean, and `.` passes our $@ ("setup") to it
      # shellcheck disable=SC1090
      . "$ENVKERNEL" >/dev/null 2>&1 || exit 1
      _envmake olddefconfig ) \
        || die "olddefconfig failed"
    echo "fp3-kbuild: $TREE is set up; .output/.config from $(basename "$CONFIG")"
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
      . "$ENVKERNEL" >/dev/null 2>&1 || exit 1
      _envmake "${_args[@]}" )
    ;;
esac
