#!/usr/bin/env python3
"""Ask the driver directly whether it will grant a padded stride.

libcamera reports "requested 2560, got 2400", which blames the driver - but
that report is only as good as what libcamera actually put in the ioctl. Doing
the ioctl by hand takes the middle layer out of the question: whatever comes
back here is the driver's own answer.
"""
import ctypes as C
import fcntl
import sys

VIDIOC_TRY_FMT = 0xC0D05640  # _IOWR('V', 64, struct v4l2_format)
V4L2_BUF_TYPE_VIDEO_CAPTURE_MPLANE = 9


def fourcc(s):
    return s[0] | (s[1] << 8) | (s[2] << 16) | (s[3] << 24)


class PlaneFmt(C.Structure):
    _fields_ = [("sizeimage", C.c_uint32), ("bytesperline", C.c_uint32),
                ("reserved", C.c_uint16 * 6)]


class PixMp(C.Structure):
    _fields_ = [("width", C.c_uint32), ("height", C.c_uint32),
                ("pixelformat", C.c_uint32), ("field", C.c_uint32),
                ("colorspace", C.c_uint32), ("plane_fmt", PlaneFmt * 8),
                ("num_planes", C.c_uint8), ("flags", C.c_uint8),
                ("ycbcr_enc", C.c_uint8), ("quantization", C.c_uint8),
                ("xfer_func", C.c_uint8), ("reserved", C.c_uint8 * 7)]


class Fmt(C.Structure):
    _fields_ = [("type", C.c_uint32), ("pad", C.c_uint32),
                ("pix_mp", PixMp), ("filler", C.c_uint8 * 100)]


dev, w, h, want = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
fd = open(dev, "rb+", buffering=0)
f = Fmt()
f.type = V4L2_BUF_TYPE_VIDEO_CAPTURE_MPLANE
f.pix_mp.width, f.pix_mp.height = w, h
f.pix_mp.pixelformat = fourcc(b"pRAA")   # SRGGB10P, what camss offers on RDI
f.pix_mp.num_planes = 1
f.pix_mp.plane_fmt[0].bytesperline = want
f.pix_mp.plane_fmt[0].sizeimage = want * h
fcntl.ioctl(fd, VIDIOC_TRY_FMT, f, True)
print("%s  %dx%d  asked bytesperline=%d -> got %d, sizeimage %d, planes %d" %
      (dev, f.pix_mp.width, f.pix_mp.height, want,
       f.pix_mp.plane_fmt[0].bytesperline, f.pix_mp.plane_fmt[0].sizeimage,
       f.pix_mp.num_planes))
