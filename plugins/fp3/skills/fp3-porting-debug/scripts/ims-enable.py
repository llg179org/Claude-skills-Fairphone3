#!/usr/bin/env python3
"""Send QMI IMS 0x008f (Set IMS Services Enabled Setting) through libqmi's
GObject introspection, because no qmicli exposes a CLI option for it.

    ims-enable.py show        read the current setting, change nothing
    ims-enable.py on          enable IMS voice over LTE (and the master switch)
    ims-enable.py off         put both back off - the restore

☠️ The device MUST be opened with PROXY. Without qmi-proxy the IMS service
answers QMI error 70 InvalidOperation, which reads like a modem with no IMS and
is only a client that does not outlive its process.

Every run prints the setting before and after, so a change is never inferred.
"""
import sys
import gi
gi.require_version("Qmi", "1.0")
from gi.repository import Qmi, Gio, GLib

MODE = sys.argv[1] if len(sys.argv) > 1 else "show"
if MODE not in ("show", "on", "off"):
    sys.exit("usage: ims-enable.py show|on|off")

loop = GLib.MainLoop()
state = {"rc": 1}


def fail(msg):
    print("FATAL:", msg)
    state["rc"] = 1
    loop.quit()


def dump(out, label):
    print(f"--- IMS services enabled setting ({label}) ---")
    # ☠️ The input and output names are NOT symmetric: the setter is
    # set_ims_voice_over_lte_enable, the getter is get_ims_voice_service_enabled.
    # Guessing one from the other gives AttributeError on every field, which
    # prints as "(unavailable)" and reads exactly like a firmware that omits
    # the TLVs. These names were read off the introspection data, not inferred.
    for name, getter in (
        ("voice",           "get_ims_voice_service_enabled"),
        ("registration",    "get_ims_registration_service_enabled"),
        ("video telephony", "get_ims_video_telephony_service_enabled"),
        ("voice over WiFi", "get_ims_voice_wifi_service_enabled"),
        ("UE to TAS",       "get_ims_ut_service_enabled"),
        ("SMS",             "get_ims_sms_service_enabled"),
        ("USSD",            "get_ims_ussd_service_enabled"),
    ):
        # ☠️ These map as `value = get_x()` and raise, NOT as `(ok, value)`.
        # Unpacking a plain bool raises TypeError, which prints as "unavailable"
        # for every field at once - indistinguishable from a firmware that
        # reports nothing. If every row says unavailable, suspect the binding
        # before the modem.
        try:
            val = getattr(out, getter)()
            print(f"    {name:>16}: {'yes' if val else 'no'}")
        except GLib.Error:                          # a TLV this firmware omits
            print(f"    {name:>16}: (not in the response)")
        except Exception as e:
            print(f"    {name:>16}: (BINDING PROBLEM: {e.__class__.__name__}: {e})")


def read_setting(client, label, then):
    def cb(c, res, _):
        try:
            out = c.get_ims_services_enabled_setting_finish(res)
            out.get_result()
            dump(out, label)
        except GLib.Error as e:
            print(f"    read failed ({label}): {e.message}")
        then()
    client.get_ims_services_enabled_setting(None, 10, None, cb, None)


def do_set(client, done):
    want = (MODE == "on")
    inp = Qmi.MessageImsSetImsServicesEnabledSettingInput()
    inp.set_ims_voice_over_lte_enable(want)
    inp.set_ims_service_enabled(want)

    def cb(c, res, _):
        try:
            out = c.set_ims_services_enabled_setting_finish(res)
            out.get_result()
            print(f"=== set voice-over-LTE and the master switch to {'ON' if want else 'OFF'}: accepted")
            state["rc"] = 0
        except GLib.Error as e:
            print(f"=== set REFUSED by the modem: {e.message}")
            state["rc"] = 2
        done()
    client.set_ims_services_enabled_setting(inp, 10, None, cb, None)


def with_client(dev, client):
    def after_bind():
        def phase2():
            if MODE == "show":
                state["rc"] = 0
                return finish()
            do_set(client, lambda: read_setting(client, "after", finish))
        read_setting(client, "before", phase2)

    def finish():
        dev.release_client(client, Qmi.DeviceReleaseClientFlags.RELEASE_CID, 10, None,
                           lambda d, r, _: loop.quit(), None)

    binp = Qmi.MessageImsBindInput()
    binp.set_binding(0)

    def bcb(c, res, _):
        try:
            c.bind_finish(res).get_result()
            print("=== IMS Settings bind ok (binding 0)")
        except GLib.Error as e:
            print(f"=== bind failed: {e.message}")
        after_bind()
    client.bind(binp, 10, None, bcb, None)


def on_client(dev, res, _):
    try:
        client = dev.allocate_client_finish(res)
    except GLib.Error as e:
        return fail(f"allocate IMS client: {e.message}")
    with_client(dev, client)


def on_open(dev, res, _):
    try:
        dev.open_finish(res)
    except GLib.Error as e:
        return fail(f"open: {e.message}")
    dev.allocate_client(Qmi.Service.IMS, Qmi.CID_NONE, 10, None, on_client, None)


def on_new(_o, res, __):
    try:
        dev = Qmi.Device.new_finish(res)
    except GLib.Error as e:
        return fail(f"new: {e.message}")
    # ☠️ PROXY is not optional here - see the module docstring.
    dev.open(Qmi.DeviceOpenFlags.PROXY, 15, None, on_open, None)


Qmi.Device.new(Gio.File.new_for_commandline_arg("qrtr://0"), None, on_new, None)
loop.run()
sys.exit(state["rc"])
