#!/usr/bin/env python3
"""生成扩展图标（PNG，无第三方依赖）：B 站粉圆角方块 + 白色斜向音符带。"""
import os
import struct
import zlib

PINK = (0xFB, 0x72, 0x99)
WHITE = (255, 255, 255)
OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'icons')


def make_pixel(size, x, y):
    r = max(2, int(size * 0.23))
    # 圆角判定
    def inside(cx, cy):
        if cx < r and cy < r:
            return (cx - r + 0.5) ** 2 + (cy - r + 0.5) ** 2 <= r * r
        if cx >= size - r and cy < r:
            return (cx - (size - r) - 0.5) ** 2 + (cy - r + 0.5) ** 2 <= r * r
        if cx < r and cy >= size - r:
            return (cx - r + 0.5) ** 2 + (cy - (size - r) - 0.5) ** 2 <= r * r
        if cx >= size - r and cy >= size - r:
            return (cx - (size - r) - 0.5) ** 2 + (cy - (size - r) - 0.5) ** 2 <= r * r
        return True

    if not inside(x, y):
        return (0, 0, 0, 0)
    # 白色斜向带宽（音乐符感），留边距
    dist = abs((x - y) - (size * 0.08))
    color = WHITE if dist <= size * 0.075 else PINK
    return (color[0], color[1], color[2], 255)


def encode_png(w, h, pixels):
    def chunk(tag, data):
        return (
            struct.pack('>I', len(data))
            + tag
            + data
            + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = b''
    for y in range(h):
        raw += b'\x00'
        for x in range(w):
            raw += bytes(pixels[y * w + x])
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', ihdr)
        + chunk(b'IDAT', zlib.compress(raw))
        + chunk(b'IEND', b'')
    )


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 48, 128):
        pixels = [make_pixel(size, x, y) for y in range(size) for x in range(size)]
        path = os.path.join(OUT_DIR, f'{size}.png')
        with open(path, 'wb') as f:
            f.write(encode_png(size, size, pixels))
        print(f'icons: {path}')


if __name__ == '__main__':
    main()