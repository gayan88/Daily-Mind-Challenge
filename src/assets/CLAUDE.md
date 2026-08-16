# src/assets

Currently empty, and that's intentional — the app uses no image or icon **files**. Every icon in the UI is a Unicode emoji character, centralized in `src/js/utils/icons.js` and rendered via `textContent` (see that file's comments for why: a bad copy/paste of raw emoji glyphs into HTML previously produced mojibake, so emoji only ever live as explicit `\u{...}` escapes in one JS file now).

If real image/icon assets are ever needed (e.g. a favicon, OG share image, or SVG illustrations), they'd go in `images/` and `icons/` subfolders here.
