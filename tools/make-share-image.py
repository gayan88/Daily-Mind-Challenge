#!/usr/bin/env python3
"""Link-preview (og:image) share image for a game: 1200x630, brand purple, the game's logo on a
white card, "FREE DAILY PUZZLE", a one-line tagline, and the game's link.

Usage (needs Pillow + numpy; macOS fonts):
  python3 tools/make-share-image.py <game> "<tagline>" src/assets/images/fb-share-<game>.png

<game> is both the logo name in the OneDrive reference folder (logos/<game>.png) and the URL path
(dailymindchallenge.com/<game>). Set DMC_REF to the reference folder if it is not in the default place.
Taglines used 2026-11-13:
  wordle       Guess the hidden word in six tries.
  sudoku       Fill the grid. Every row, column and box.
  wordsearch   Find every hidden word on the board.        (saved as fb-share-word-search.png)
  connections  Sort sixteen words into four secret groups.
  quilt        Solve the board, reveal the picture.
  pounce       Find every cat its own spot.
Then set og:image / twitter:image (width 1200, height 630) in src/html/<game>.html and copy the PNG
to the reference folder's share-images/.
"""
import os, sys, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

REF = os.environ.get("DMC_REF", os.path.expanduser(
    "~/Library/CloudStorage/OneDrive-Personal/Drive B/Development/Daily Mind Challenge"))
ROUND = "/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf"
AVENIR = "/System/Library/Fonts/Avenir Next.ttc"
W, H = 1200, 630
TOP, BOTTOM = (98, 86, 206), (52, 44, 128)        # brand purple #534AB7 → #3C3489, a touch lighter on top

def trimmed_logo(path):
    img = Image.open(path).convert('RGBA')
    bg = Image.new('RGBA', img.size, (255, 255, 255, 255))
    img = Image.alpha_composite(bg, img).convert('RGB')
    a = np.asarray(img).astype(int)
    ys, xs = np.where(a.min(2) < 245)
    return img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

def wrap(draw, text, font, width):
    words, lines, line = text.split(), [], ''
    for w in words:
        t = (line + ' ' + w).strip()
        if draw.textlength(t, font=font) <= width: line = t
        else: lines.append(line); line = w
    lines.append(line)
    return lines

def make(game, tagline, out):
    im = Image.new('RGB', (W, H))
    g = np.linspace(0, 1, H)[:, None, None]
    grad = (np.array(TOP) * (1 - g) + np.array(BOTTOM) * g).repeat(W, 1).astype(np.uint8)
    im = Image.fromarray(grad)
    d = ImageDraw.Draw(im)
    # soft decorative circles, low contrast
    deco = Image.new('RGBA', (W, H), (0, 0, 0, 0)); dd = ImageDraw.Draw(deco)
    dd.ellipse((900, -160, 1340, 280), fill=(255, 255, 255, 18)); dd.ellipse((-120, 430, 260, 810), fill=(255, 255, 255, 14))
    im = Image.alpha_composite(im.convert('RGBA'), deco)
    # logo card with a soft shadow
    cx0, cy0, cw, ch = 56, 55, 560, 520
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ImageDraw.Draw(sh).rounded_rectangle((cx0 + 6, cy0 + 12, cx0 + cw + 6, cy0 + ch + 12), 40, fill=(20, 12, 60, 110))
    im = Image.alpha_composite(im, sh.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((cx0, cy0, cx0 + cw, cy0 + ch), 40, fill=(255, 255, 255))
    logo = trimmed_logo(f"{REF}/logos/{game}.png")
    logo.thumbnail((cw - 60, ch - 60), Image.LANCZOS)
    im.paste(logo, (cx0 + (cw - logo.width) // 2, cy0 + (ch - logo.height) // 2))
    # right-hand text
    x0, tw = 668, W - 668 - 56
    eyebrow = ImageFont.truetype(AVENIR, 24, index=2)          # Avenir Next Demi Bold
    big = ImageFont.truetype(ROUND, 54)
    body = ImageFont.truetype(AVENIR, 28, index=0)
    d.text((x0, 112), "FREE DAILY PUZZLE", font=eyebrow, fill=(214, 209, 255))
    y = 152
    for line in wrap(d, tagline, big, tw):
        d.text((x0, y), line, font=big, fill=(255, 255, 255)); y += 66
    y += 14
    for line in wrap(d, "A new puzzle every day. Play free in your browser, no download.", body, tw):
        d.text((x0, y), line, font=body, fill=(226, 223, 255)); y += 40
    # link pill
    site = Image.open(f"{REF}/logos/site-logo.png").convert('RGBA'); site.thumbnail((46, 46), Image.LANCZOS)
    url = f"dailymindchallenge.com/{game}"
    uf = ImageFont.truetype(AVENIR, 23, index=2)
    pw = 20 + site.width + 12 + int(d.textlength(url, font=uf)) + 24
    px, py = x0, 492
    d.rounded_rectangle((px, py, px + pw, py + 72), 36, fill=(255, 255, 255))
    im.paste(site, (px + 20, py + (72 - site.height) // 2), site)
    d.text((px + 20 + site.width + 12, py + 21), url, font=uf, fill=(60, 52, 137))
    im.convert('RGB').save(out, optimize=True)

if __name__ == "__main__":
    if len(sys.argv) != 4: sys.exit(__doc__)
    make(sys.argv[1], sys.argv[2], sys.argv[3])
