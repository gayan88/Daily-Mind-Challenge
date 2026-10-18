# Quilt test data

Synthetic **test** pictures (mirrored pixel-sprite designs, generated 2026-10-19) for loading
Admin → Quilt in a test or launch environment. They're valid and importable, but they're
procedurally generated, not hand-drawn art — swap in real pictures for long-term content.

| File | Pictures | Use in Admin → Quilt |
|---|---|---|
| `test-daily-500.txt` | 500 × 10×10 (Medium) | **Daily Puzzles**: upload the file (or paste), Preview, pick a start date, Add. Order in the file = play order, one per day (~16 months). |
| `test-classic-300.txt` | 100 Easy 7×7 + 100 Medium 10×10 + 100 Hard 14×14 | **Classic Puzzles**: upload, Preview, Add. Each block has its own `difficulty:` line, so the dropdown doesn't matter. |
| `test-patchwork-runs-100.txt` | 100 × 20×20 | **Patchwork Runs → Bulk import runs**: upload the file, Tiles 2×2 (10×10 each), set the bonus, Start as Inactive, Preview Runs, Create 100 Runs — then activate a few at a time. (The single-run builder above it still takes one pasted picture.) |

Format: the standard Quilt text format (`title:` / `difficulty:` / `palette:` + one digit row per
grid row) — see `docs/content-creation-guide.md` → Quilt.

Checked before saving:
- every picture generates a puzzle with exactly one solution, using the same generator and seed
  (the title) the admin page uses, so Preview produces exactly these puzzles;
- no duplicate pictures within a file (the import rejects the whole batch on a duplicate);
- every run picture cuts into 2×2 uniquely-solvable 10×10 tiles;
- titles are unique across all three files.

Expect soft "single cells" warnings on most Easy 7×7 pictures — small shapes have staircase
edges. Warnings never block an import.
