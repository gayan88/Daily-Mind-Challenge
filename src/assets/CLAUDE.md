# src/assets

`images/` holds every real image file the app uses: the logo (`logo.png`/`logo-header.png`/`Full Logo.png`), the three game tile images (`tile-wordle.png`/`tile-sudoku.png`/`tile-wordsearch.png`, 400x400, see `docs/adding-a-new-game.md`), and the Rank badge set (`rank-novice.png` through `rank-legend.png`, plus `rank-guest.png` — also 400x400, see `src/js/progression/rank-service.js`). All referenced by root-relative `/assets/images/...` paths, per `src/html/CLAUDE.md`'s convention.

Icons/emblems that *aren't* rank badges or tile art are still plain Unicode emoji, centralized in `src/js/utils/icons.js` and rendered via `textContent` (see that file's comments for why: a bad copy/paste of raw emoji glyphs into HTML previously produced mojibake, so emoji only ever live as explicit `\u{...}` escapes in one JS file). Don't add a new image file for something an emoji already covers well — `icons.js` is still the first place to look before reaching for a graphic.

No `icons/` subfolder exists yet — if SVG icon files are ever needed (as opposed to emoji or the photo-style badges in `images/`), that's where they'd go.
