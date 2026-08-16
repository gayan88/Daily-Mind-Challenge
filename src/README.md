# src/

Application source. Plain HTML/CSS/JS, no build tooling — everything under this folder is served as-is.

- **`html/`** — the 9 real pages. Start here; see `html/CLAUDE.md` for the full list and how paths work.
- **`css/`** — `base.css`, `components.css`, `pages/*.css`.
- **`js/`** — see `js/CLAUDE.md` for the folder-by-folder breakdown (`api/`, `auth/`, `games/*`, `leaderboard/`, `admin/`, `pages/`, `utils/`, `app.js`).
- **`partials/`** — shared header/footer HTML fragments.
- **`assets/`** — currently unused; the app renders icons as Unicode emoji instead of image files.

Each subfolder has its own `CLAUDE.md` documenting what's actually implemented there — update those as the code changes rather than treating them as fixed specs.

For project-level setup (Firebase console steps, running locally, environment) see the root `README.md`. For architecture/data-flow/deployment write-ups see `/docs`.
