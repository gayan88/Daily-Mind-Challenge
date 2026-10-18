# Generating Game Content With an AI

A reference for producing puzzle/word files for Daily Mind Challenge's games, precise enough to
hand to **any** AI assistant (this one, ChatGPT, Gemini, etc.) along with a request like *"Generate
100 Wordle Daily Challenge words as a file, following the rules below."* Every rule here is taken
directly from the app's own admin import code (`src/js/admin/*-admin.js`), not guessed — if the app
would reject a file, it's called out here.

**How to use this**: copy the whole "Quick copy-paste prompts" section at the bottom (or just the
one game/mode you need) into any AI chat, fill in the puzzle count, and it has everything it needs
to produce a ready-to-import file. Then upload that file through **Admin → \<Game\>** on this site.

## Rules that apply to every game

- **Plain text, UTF-8.** Windows (`\r\n`) or Unix (`\n`) line endings both work.
- **Case doesn't matter.** The app uppercases every word/letter itself on import. Write in
  whatever case is easiest to read — this guide uses Title Case for readability.
- **Leading/trailing spaces are trimmed automatically**, but don't rely on that — keep it clean.
- **Every bulk import is all-or-nothing.** If even one line in the file is invalid, or duplicates
  something else in the same file, or duplicates something already seeded, **the entire file is
  rejected and nothing is imported** — not just the bad line. Always dedupe *within* a generated
  file yourself before uploading (ask the AI to double-check its own output for repeats), since the
  app can't tell you which specific line failed until you fix all of them.
- **"Duplicate" is checked per collection**, and for Classic pools, *per difficulty* — the exact
  same puzzle can legitimately exist in both the Easy pool and the Hard pool, for example, since
  each difficulty is served from its own independent pool.
- **Content should be family-friendly** — this is a casual, all-ages puzzle site. Nothing here
  enforces that in code; it's an editorial rule for whoever is generating or reviewing content.
- **Order in the file becomes play order for Daily content.** Daily puzzles/words are auto-assigned
  to consecutive calendar dates starting from a date you pick in the admin panel for the very first
  one — the file itself never specifies dates. Puzzle #1 in your file plays first, #2 plays the day
  after, and so on. Classic and Tournament pools don't have this date concept.

---

## Wordle

### Daily Challenge

One 5-letter English word per puzzle. **There is no Classic mode for Wordle** — don't generate that.

- **Format**: one word per line. A plain word list or a CSV with the word as the first column both
  work (anything after a comma on the line is ignored).
- **Rules**: exactly 5 letters, `A-Z` only, no numbers or punctuation. No word may repeat within
  the file (case-insensitive) or already exist in the seeded pool.
- **Quality note**: nothing in the app checks that a Daily word is a real dictionary word at
  upload time — but it should be one anyway. During play, every guess *except* the exact target is
  checked against a dictionary API, so a made-up target word would still technically be winnable
  (typing it exactly always works) but would never feel fair to reach by deduction.

Example file (`wordle-daily.txt`):
```
CRANE
STOMP
PIXEL
BRAVE
QUILT
```

### Tournament

A named set of 5-letter words, played back-to-back on a countdown, created directly in the admin
panel's **Wordle → Tournaments** form — there's no file upload for this one. Generate the list
externally, then paste it straight into the "Words" textarea.

- **Format**: comma-separated or newline-separated, 5-letter words.
- **Rules**: same `^[A-Za-z]{5}$` check as Daily. The admin form doesn't block duplicate words
  within one tournament, but avoid them — a player would just face the same word twice in one run.
- Also set when creating it: a name, seconds allowed per word (≥10), and a completion bonus.

Example (paste into the Words field):
```
CRANE, STOMP, PIXEL, BRAVE, QUILT
```

---

## Sudoku

Every mode uses the same puzzle shape: an **81-character puzzle string** (`0`–`9`, `0` = blank
cell, read left-to-right top-to-bottom across all 9 rows) and its matching **81-character solution
string** (`1`–`9` only, a fully solved grid).

**A solution must be a genuinely valid completed Sudoku grid** — every row, every column, and every
3×3 box must contain each digit 1–9 exactly once — and the puzzle's non-zero cells must match the
solution at the same positions. The app validates this shape but **cannot verify the puzzle has
exactly one solution** (a real Sudoku requirement) — a generic AI is unreliable at hand-generating
correct 81-cell grids that satisfy all of this. **Recommendation**: use an actual Sudoku
generator/solver (a script, library, or dedicated generator site) to produce the puzzle/solution
pairs, then have an AI only handle formatting them into the file shapes below.

### Daily Challenge

- **Format** (CSV, one puzzle per line): `puzzle,solution`
- **Rules**: exact duplicate puzzle strings are rejected, both within the file and against the
  existing pool.

```
500000100001300000420080907050703040000000209004205060907040032000006700003000600,539764182281359476426189357657493528198527396734215860243611...
```
*(illustrative — see the caveat above; generate real pairs with a Sudoku generator, not free text.)*

### Classic

- **Format** (CSV, one puzzle per line): `difficulty,puzzle,solution`
- **Rules**: `difficulty` must be exactly `easy`, `medium`, or `hard`. Duplicate puzzle strings are
  rejected only *within the same difficulty's* pool.

```
easy,500000100001300000420080907...,539764182281359476426189357...
medium,003000600900305001...,483091657967245381...
```

### Tournament

Created directly in the admin panel — no file upload. Two separate boxes, matched by line number
(line 3 of "Puzzles" pairs with line 3 of "Solutions"):

```
Puzzles:
500000100001300000420080907...
003000600900305001...

Solutions:
539764182281359476426189357...
483091657967245381...
```

Time limit and max errors per puzzle are a global setting (Admin → Sudoku → Global Configs), not
part of the file — only the puzzle count, name, and a completion bonus are set per tournament.

---

## Word Search

A theme (optional, depending on mode) plus a fixed-size word list.

| Mode | Word count | Word length | Theme field |
|---|---|---|---|
| Daily | exactly 10 | 4–9 letters | optional |
| Tournament | exactly 10 | 4–9 letters | n/a (pasted, see below) |
| Classic — Easy | exactly 6 | 4–9 letters | always present |
| Classic — Medium | exactly 10 | 4–9 letters | always present |
| Classic — Hard | exactly 10 | 4–9 letters | always present |

- **Letters only**, `A-Z`, no spaces or hyphens within a word.
- **No word may be a substring of another word in the same puzzle**, in either direction (e.g.
  `CAT` and `CATFISH` can't be in the same list) — the game's letter-matching can't tell them
  apart on the grid.
- **Duplicate check** compares the *whole word set* per puzzle, order-independent — the same 10
  words in a different order still counts as a duplicate of an existing puzzle.

### Daily Challenge

- **Format** (CSV, one puzzle per line): either exactly 10 comma-separated words, or 11 fields
  where the first is a theme and the remaining 10 are the words.

```
Ocean Life,SHARK,WHALE,CORAL,OYSTER,ANCHOR,DOLPHIN,STARFISH,TURTLE,SEAWEED,LOBSTER
TIGER,ZEBRA,RABBIT,PANDA,EAGLE,DOLPHIN,GIRAFFE,APPLE,MANGO,BANANA
```

### Classic

- **Format** (CSV, one puzzle per line): `difficulty,theme,word1,word2,...` — theme is **always**
  present as its own field (never omitted), since word count varies by difficulty so the app can't
  infer whether a theme was included the way Daily's importer does.

```
easy,Fruits,APPLE,MANGO,GRAPE,PEACH,LEMON,BERRY
medium,Space,COMET,ORBIT,GALAXY,PLANET,ROCKET,METEOR,SATURN,NEBULA,ASTEROID,ECLIPSE
```

### Tournament

Created directly in the admin panel — no file upload, one word list per line pasted into a single
textarea, each line exactly 10 comma-separated words (no theme field):

```
TIGER,ZEBRA,RABBIT,PANDA,EAGLE,DOLPHIN,GIRAFFE,APPLE,MANGO,BANANA
CORAL,SHARK,WHALE,OCTOPUS,TURTLE,OYSTER,ANCHOR,STORM,CLOUD,THUNDER
```

---

## Connections

Sixteen words per puzzle, split into **4 groups of 4**, ordered **easiest to hardest** — the first
group you list is colored yellow, then green, then blue, then purple (the trickiest, often
wordplay-based). **This is plain text, not a spreadsheet CSV** — the file picker only accepts
`.txt`.

- **Format**: 4 lines per puzzle, each `Group name: word, word, word, word`. Separate multiple
  puzzles in the same file with one blank line.
- **Rules**: exactly 4 groups, exactly 4 words each. All 16 words in one puzzle must be unique,
  case-insensitively, even across different groups. Each word must be 14 characters or fewer.
- **Classic only**: a block may start with an extra leading line, `difficulty: easy` (or `medium`/
  `hard`), to set/override that puzzle's difficulty when importing a mixed-difficulty file — Daily
  and Tournament files never use this line.
- **Duplicate check** compares the full 16-word set per puzzle, order-independent, scoped the same
  way as the other games (per difficulty for Classic).
- **Design guidance** (not enforced by the app, but core to the format): at least one word should
  plausibly fit more than one group — that overlap is the puzzle's trap. The purple group is
  usually wordplay (hidden words, homophones, a shared prefix/suffix) rather than a plain category.

Example file, two puzzles (`connections-daily.txt`):
```
Fish: Bass, Pike, Perch, Carp
Musical terms: Flat, Sharp, Note, Scale
Kitchen items: Pan, Whisk, Ladle, Grater
Hidden colors: Bored, Scarlet, Tangerine, Bluff

Chess pieces: King, Queen, Rook, Pawn
Currencies: Yen, Peso, Rand, Franc
Card games: Bridge, Hearts, Spades, Poker
Dental: Crown, Filling, Root, Brace
```

Classic import with a difficulty override on each block:
```
difficulty: easy
Fruits: Apple, Banana, Orange, Grape
Animals: Lion, Tiger, Zebra, Monkey
Colors: Red, Blue, Green, Yellow
Furniture: Chair, Table, Sofa, Bed

difficulty: hard
Anagrams of colors: Der, Nurb, Ergne, Lube
Homophones of numbers: Won, Too, Ate, Fore
Silent letters: Knight, Gnome, Wrist, Psalm
Palindromes: Level, Radar, Civic, Kayak
```

Ready-made starter sets already exist in `docs/connections-content/` (`daily.txt`, `classic.txt`,
`tournament.txt`) if you just need real content now rather than generating more.

---

## Quilt

Admin → Quilt takes **pictures, not puzzles**: the admin page turns each picture into a puzzle and
proves it has exactly one solution before it can be saved (`src/js/admin/quilt-admin.js`, using
`src/js/games/quilt/quilt-generator.js`). Nothing to hand-check — Preview shows every problem.

Two ways to supply a picture:

- **PNG** drawn at **1 image pixel = 1 grid cell**, no smoothing/anti-aliasing, **at most 8
  colours** (Piskel, Aseprite, Lospec Pixel Editor). The file name becomes the title
  (`little-tree.png` → "Little tree"). Several files can be uploaded at once.
- **Text blocks**, separated by a blank line:

```
title: Cosy House
difficulty: medium
palette: #87ceeb #b22222 #f5deb3 #8b4513 #2e7d32
0000110000
0001111000
0011111100
0111111110
1111111111
0222222220
0233223320
0233223320
0222332220
4444334444
```

`palette` = 2–8 `#rrggbb` colours; each digit in the rows is a palette index (first colour = 0).
`difficulty` is optional (the form's dropdown fills it in; Daily defaults to medium). Every row the
same length; each side 5–20 cells.

| Mode | Size | Notes |
|---|---|---|
| Daily | 10×10 (Medium) | Order in the input = play order, dated one per day from the start date. |
| Classic | Easy 7×7 · Medium 10×10 · Hard 14×14 | Hard automatically gets knots (its single-cell pieces) and shape clues. |
| Patchwork Run | one picture per run, e.g. 20×20 | Cut into 2×2, 3×2 or 3×3 tiles; sides must divide evenly, each tile 5–20 a side. **Bulk import runs** takes a whole file (one run per picture, named from `title:`). |

- **"Duplicate"** = the same palette + pixel rows, whatever the title (Daily: anywhere in the pool;
  Classic: within the same difficulty). The whole batch is rejected if any picture fails.
- **Picture quality:** blocky shapes with areas of solid colour make good puzzles. Single-pixel
  details and diagonal staircases produce lots of 1×1 pieces — Preview warns when more than a
  quarter of the pieces are single cells. Smooth gradients / photos can't work (>8 colours).
- **Download** exports the text format, and re-importing it is a no-op (duplicates are rejected).

## Quick copy-paste prompts

Fill in the puzzle count and hand the whole block to any AI.

**Wordle Daily** — *"Generate 100 real, common 5-letter English words, one per line, no numbers or
punctuation, no duplicates. Output as a plain text file, no header row."*

**Wordle Tournament** — *"Generate 10 real, common 5-letter English words, comma-separated on one
line, no duplicates."*

**Sudoku (any mode)** — *"Generate N valid Sudoku puzzle-and-solution pairs. Each solution must be
a completed 9x9 grid (81 digits, 1-9) where every row, column, and 3x3 box contains each digit
exactly once. Each puzzle must be the same solution with some cells replaced by 0, and every
puzzle must have exactly one valid solution. Output as CSV, one pair per line:
`puzzle,solution` [add `difficulty,puzzle,solution` with difficulty easy/medium/hard for Classic]."*
Use a real Sudoku generator for this one rather than trusting free-text generation — see the
caveat in the Sudoku section above.

**Word Search Daily** — *"Generate 50 puzzles, each a themed set of exactly 10 English words, 4-9
letters each, letters only, no word a substring of another word in the same set. Output as CSV,
one puzzle per line: `theme,word1,word2,...,word10`, no duplicate word sets across puzzles."*

**Word Search Classic (Easy)** — same prompt as above but *"exactly 6 words"* and prefix each line
with `easy,` before the theme.

**Connections (any mode)** — *"Generate 20 Connections puzzles. Each puzzle has 16 unique English
words split into 4 groups of 4, ordered easiest to hardest (a plain category first, then two
mid-difficulty categories, then a wordplay-based trickiest category — hidden words, homophones, or
a shared prefix/suffix). No word over 14 characters. Format each puzzle as 4 lines, `Group name:
word, word, word, word`, with a blank line between puzzles. No duplicate words within a puzzle, and
no two puzzles sharing the exact same 16 words."*

**Quilt (any mode)** — *"Draw N pixel-art pictures for a picture-reveal logic puzzle. Each is a
10×10 grid [7×7 easy / 14×14 hard / 20×20 for a tournament] using 3–6 colours with large blocky
areas of solid colour and few single-pixel details. Output each as a text block: `title: <name>`,
`difficulty: medium`, `palette: #rrggbb #rrggbb ...`, then one line of digits per row where each
digit is the palette index (0 = first colour). Every row exactly the same length. Blank line between
pictures; no two pictures the same."* Paste the result into Admin → Quilt and press Preview —
anything the generator can't use is flagged there.
