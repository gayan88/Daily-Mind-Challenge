#!/usr/bin/env python3
"""Achievement badge art -> site-ready PNGs (the workflow used for Quilt's and Pounce's badges).

For each source image (already renamed to its achievement id, e.g. pounce-daily-champion-7.png):
  1. Removes a baked-in white / light-grey / fake-checkerboard background: light, low-colour
     pixels connected to the image border (the mask is closed on a padded copy so the border stays
     one region), keeping the largest foreground piece and filling its holes, so white fur or text
     inside the badge is kept. Edges get a soft 2 px alpha ramp with the white fringe removed.
  2. Writes the transparent full-size PNG back in place (optional, --in-place) and
  3. a 240x240 contain-fit copy to the output folder (src/assets/images/achievements by default).

Check every result on a dark AND a light background before wiring CUSTOM_IMAGES (the --sheet
option writes such a contact sheet).

Usage (needs Pillow, numpy, scipy -- e.g. in a throwaway venv):
  python3 tools/process-badges.py docs/Images/pounce-*.png --in-place --sheet /tmp/badges.png
"""
import argparse
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

LIGHT_MIN = 215      # min(R, G, B) above this counts as "light"
GREY_SPREAD = 30     # max - min below this counts as "low colour"
SIZE = 240


def remove_background(img):
    a = np.asarray(img.convert('RGB')).astype(np.float32)
    mn, mx = a.min(2), a.max(2)
    light = (mn > LIGHT_MIN) & ((mx - mn) < GREY_SPREAD)
    pad = ndi.binary_closing(np.pad(light, 2, constant_values=True), iterations=1)
    lab, _ = ndi.label(pad)
    # [2, 2] (not [0, 0]): closing erodes the padded corner itself.
    bg = (lab == lab[2, 2])[2:-2, 2:-2] & light
    fg = ~bg
    lab, n = ndi.label(fg)
    if n > 1:
        sizes = ndi.sum(fg, lab, range(1, n + 1))
        fg = ndi.binary_fill_holes(lab == (np.argmax(sizes) + 1))
    alpha = np.where(fg, 255.0, 0.0)
    band = ndi.binary_dilation(fg, iterations=2) & ~fg
    alpha[band] = np.clip((255 - mn) / (255 - LIGHT_MIN) * 255, 0, 255)[band]
    af = np.maximum(alpha / 255, 1e-3)[..., None]
    soft = ((alpha > 0) & (alpha < 255))[..., None]
    rgb = np.where(soft, np.clip((a - 255 * (1 - af)) / af, 0, 255), a)
    return Image.fromarray(np.dstack([rgb, alpha]).astype(np.uint8)), (alpha == 0).mean()


def thumbnail(img):
    img = img.crop(img.getbbox())
    img.thumbnail((SIZE, SIZE), Image.LANCZOS)
    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(img, ((SIZE - img.width) // 2, (SIZE - img.height) // 2), img)
    return out


def contact_sheet(paths, dest):
    w = 120
    sheet = Image.new('RGB', (len(paths) * w, 2 * w))
    for i, p in enumerate(paths):
        im = Image.open(p).convert('RGBA').resize((w, w))
        for k, bg in enumerate(['#14161c', '#f3efe6']):
            tile = Image.new('RGB', (w, w), bg)
            tile.paste(im, (0, 0), im)
            sheet.paste(tile, (i * w, k * w))
    sheet.save(dest)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('sources', nargs='+', help='badge images named by achievement id')
    ap.add_argument('--out', default='src/assets/images/achievements', help='where the 240x240 copies go')
    ap.add_argument('--in-place', action='store_true', help='also overwrite each source with its transparent version')
    ap.add_argument('--keep-background', action='store_true', help='source is already transparent: only resize')
    ap.add_argument('--sheet', help='write a dark/light contact sheet of the 240px results here')
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    written = []
    for src in args.sources:
        img = Image.open(src).convert('RGBA')
        if not args.keep_background:
            img, removed = remove_background(img)
            if removed < 0.02:
                print(f'warning: {src}: almost no background found ({removed:.0%}) -- check it by eye', file=sys.stderr)
            if args.in_place:
                img.save(src, optimize=True)
        dest = os.path.join(args.out, os.path.basename(src))
        thumbnail(img).save(dest, optimize=True)
        written.append(dest)
        print(dest)
    if args.sheet:
        contact_sheet(written, args.sheet)
        print(f'contact sheet: {args.sheet}')


if __name__ == '__main__':
    main()
