# Rungles React Port — Project Plan

**Status:** In progress
**Started:** 2026-04-26
**Goal:** Port Rungles from vanilla HTML/CSS/JS to React + Vite + Tailwind so it shares a stack with Wordy. After this port, both games can consume a shared `sq-ui` component package, and Snibble becomes the last SQ game that requires manual style work.

## Context for whoever picks this up

- Rae has 5–6 active users on Rungles. PWA is installed on phones. Cutover plan: tell users to "fully close the app, reopen, then close and reopen one more time" to get past the cached service worker.
- Rungles' Supabase is **shared with Wordy** (project ref `yyhewndblruwxsrqzart`). All Rungles tables/functions use the `rg_*` prefix. **The database is not changing in this port** — only the frontend.
- `main` branch must stay deployable throughout. All work happens on `react-port` branch. Cutover is a single merge.
- Wordy is the reference implementation for stack choices (Vite config, Tailwind config, `darkMode: 'class'`, deploy workflow). Mirror Wordy where possible.
- Decisions Rae has approved:
  - Port Rungles to React (not the other way; not "share tokens only").
  - `react-port` long-lived branch is fine.
  - Get as much done per session as possible. Ask before destructive or scope decisions.

## Stack target (matches Wordy)

- React 18 + react-router-dom 6
- Vite 5 (`base: '/rungles/'`, dev port 5182 — Wordy uses 5181)
- Tailwind 3 with `darkMode: 'class'`
- `@supabase/supabase-js` 2.x
- `react-hot-toast` for notifications
- Tailwind preset color name: `rungles` (parallel to Wordy's `wordy` palette). Use the same purple ramp until/unless Rae picks different brand colors.

## Phase 0 — Safety net

- [ ] `pg_dump` of all `rg_*` tables → `rungles/snapshots/pre-react-port-2026-04-26.sql`
- [ ] Create `react-port` branch off `main`. All subsequent work lands there.
- [ ] Write the parity test checklist (see below). Run end-to-end at the close of every phase.

### Parity test checklist (run at end of every phase)

**Auth & header**
- [ ] Unauthed user → redirected to hub
- [ ] Avatar + username show after login
- [ ] Avatar dropdown: identity card, Stats link
- [ ] Settings dropdown: theme toggle, Admin (gated), Log out (rose color)
- [ ] 🏠 returns to hub
- [ ] Theme toggle persists across reload

**Solo flow**
- [ ] New solo game starts, deals 7 tiles
- [ ] Free redraw fires when opening rack is all vowels/all consonants
- [ ] First rung must be ≥4 letters
- [ ] Subsequent rungs must share ≥3 letters with previous rung
- [ ] Carried letters render in carried-letters strip
- [ ] Score preview updates as word forms
- [ ] Score = letter values of newly-played tiles only + length bonus (+2/letter beyond 4)
- [ ] Blanks lock to chosen letter for the rest of the game
- [ ] End-of-bag handling

**Multi flow**
- [ ] Create multi game, invite players
- [ ] Players appear in lobby chip strip; current player highlighted
- [ ] 4-player rows wrap chips 2-per-line
- [ ] (N/M) count chip
- [ ] Turn submitted → `turn_started_at` updates
- [ ] Nudge button: hidden if my turn; visible after 12h waiting; disabled if last_nudged_at <12h
- [ ] Push notification fires on turn change

**PWA**
- [ ] Manifest loads, icon shows on install
- [ ] Service worker registers and updates cleanly
- [ ] Direct URL (`/rungles/?game=…`) resolves while logged in

## Phase 1 — React scaffold alongside vanilla

- [ ] `package.json` (mirror Wordy's deps; name `rungles`)
- [ ] `vite.config.js` with `base: '/rungles/'`, port 5183 (5182 is taken by Snibble)
- [ ] `tailwind.config.js`, `postcss.config.js`
- [ ] Rename current `index.html` → `index.legacy.html`. Create new minimal React `index.html` that mounts `<App />`.
- [ ] `src/main.jsx`, `src/App.jsx` (placeholder UI)
- [ ] `src/index.css` (Tailwind directives + the dropdown-surface global rules from sq-conventions.md)
- [ ] Update `rae-side-quest/package.json` `dev:all` script: replace `python -m http.server 5176 --directory ../rungles` with `npm --prefix ../rungles run dev`
- [ ] Verify `npm run dev:all` from hub launches all three apps and Rungles renders the placeholder

**Checkpoint:** localhost:5182 shows React placeholder. main still has live vanilla app.

## Phase 2 — Move pure logic into src/lib/

Files to copy `js/*` → `src/lib/` and convert to ESM imports where needed:

- [ ] `dictionary.js` — word list loader
- [ ] `tiles.js` — letter values, tile bag, rack drawing
- [ ] `scoring.js` — rung scoring math
- [ ] `game.js` — solo game state machine (will need adaptation to be React-friendly: extract pure functions, leave DOM-coupled bits for Phase 3)
- [ ] `match.js` — match logic
- [ ] `multiplayer.js` — Supabase realtime subscriptions, RPC calls
- [ ] `telemetry.js`
- [ ] `supabase-client.js` → `src/lib/supabase.js` (match Wordy naming)
- [ ] `sw-update.js` — keep until Phase 4

**Strategy:** Logic functions stay pure. Anything that touches `document.getElementById` or sets `.textContent` gets left in the legacy file for now and is rewritten as React components in Phase 3. Pure validators, scorers, and Supabase calls move cleanly.

**Checkpoint:** Sanity-call a few imports from `App.jsx` (validate a word, score a sample rung) and console.log to confirm logic works.

## Phase 3 — Port screens

Build each in React, A/B compare against legacy at localhost:5176 (or whatever port the vanilla one ends up on if we keep it serving in parallel during the port).

- [ ] **3a — Header** (`<RunglesHeader>`): avatar slot + title + 🏠 + ⚙️. Implements the dropdown-surface treatment from sq-conventions.md. Reference: Wordy's `LobbyPage.jsx` header section.
- [ ] **3b — Landing** (`<LandingPage>`): solo card, multi card, lobby list (live-subscribed), empty state. Reference: legacy `index.html` `.landing` block.
- [ ] **3c — Solo game** (`<SoloGamePage>`): mode-topbar, game-info, ladder, current-rung, word-input, carried-letters, score-preview, tile rack.
  - **Picks up at:** `js/game.js` (1069 lines) is the source. Recommended split: extract pure reducers + selectors (rung state, word-build, scoring) into `src/lib/soloGame.js` first; then build React UI on top. The UI mirrors the legacy `.solo-mode` block in `index.legacy.html` (lines 106–162). Save/load contract: localStorage key `rungles:solo:v1` — keep the same shape so existing saves survive the cutover (or accept that solo-in-progress games reset; they're not multiplayer-shared).
  - Specific items to faithfully port: `pickPremiumPos` (one slot per rung gets a 2x marker), `pickBlankLetter` modal (blank locks to chosen letter for the rest of the game), hint button (`HINT_COST = 5`, finds any valid play from rack+carried), word build interactions (tap rack tile → fill first empty slot; tap word slot → return to rack/carried), reorder rack (drag), endgame modal with "Play Again".
- [ ] **3d — Multi game** (`<MultiGamePage>`): everything in 3c plus player chip strip, turn indicator, nudge button, status banner.
- [ ] **3e — Avatar/Settings dropdowns + stats popup**: identity card, Stats link, theme toggle, Admin (gated via `admins` table), Log out.

After each sub-phase: run the relevant section of the parity checklist before moving on.

**House style:** match Wordy's tile look (purple gradient, tile-shadow). Tailwind preset color name = `rungles` so `bg-rungles-500` etc. work the same way `bg-wordy-500` does in Wordy. Use sq-conventions.md as the source of truth for header anatomy, dropdown surface, lobby chip layout, nudge feature.

## Phase 4 — Service worker + PWA

- [ ] Move `sw.js` → `public/sw.js` (Vite copies `public/` to dist root unchanged)
- [ ] Move `manifest.json`, `favicon.svg` → `public/`
- [ ] Bump SW version constant in `sw.js`
- [ ] Configure SW with `self.skipWaiting()` in `install` and `clients.claim()` in `activate` so the new SW takes over immediately on first reload (single-reload UX instead of two-reload)
- [ ] Test on a real phone: install PWA pointing at a preview deploy, confirm update flow
- [ ] Confirm direct URL with `?game=…` query param still resolves

## Phase 5 — GitHub Actions deploy

- [ ] Copy `wordy/.github/workflows/deploy.yml` → `rungles/.github/workflows/deploy.yml`
- [ ] Swap names/paths (rungles instead of wordy)
- [ ] Add `npm ci && npm run build` step. Deploy `dist/` to Pages.
- [ ] Note: Rae's PAT for the rungles remote may not have `workflow` scope (Wordy has the same constraint per `wordy.md`). If push fails on `.github/workflows/`, edit the file via GitHub web UI.
- [ ] Test: deploy `react-port` branch to a preview if possible, or merge during low-traffic window.

## Phase 6 — Cutover

- [ ] Final full parity-checklist pass against prod Supabase data, locally
- [ ] Notify the 5–6 users in advance: "After this update, fully close Rungles and reopen twice to clear the cache."
- [ ] Bump SW version one more time as the cutover commit
- [ ] Merge `react-port` → `main`. GitHub Actions auto-deploys.
- [ ] Watch `net._http_response` and Supabase logs for any errors in the hour after deploy
- [ ] Follow-up cleanup commit: delete `index.legacy.html`, `js/`, `css/` (legacy folders kept until cutover for instant rollback)

## Phase 7 — Extract sq-ui shared package

Now that Wordy and Rungles share a stack, extract:

- [ ] Create `C:/Users/trace/OneDrive/Claude/sq-ui/` sibling folder with `package.json`, peer-dep on React, exports map
- [ ] Tailwind preset (colors, fonts, shadows) → `sq-ui/tailwind-preset.js`
- [ ] `<DropdownSurface>` — base for every floating overlay
- [ ] `<SQHeader>` — `[avatarSlot] [title] [home] [cogSlot]`
- [ ] `<AvatarMenu>` — identity + stats (extra slot for hub-only colour picker)
- [ ] `<SettingsDropdown>` — theme/admin/logout base + slot for app-specific items
- [ ] `<LobbyPlayerChips>` + `<NudgeButton>`
- [ ] `<ThemeProvider>` + `useTheme`
- [ ] Wordy + Rungles add `"@sq/ui": "file:../sq-ui"` to package.json, swap their local copies for imports
- [ ] Hub migrates after games are stable

After Phase 7, scaffolding a new SQ game = clone a template + `npm install` + register in hub allowlist + create memory file. Style stays consistent automatically.

## Open questions / decisions to revisit

- Rungles brand color: keep Wordy's purple ramp, or pick a distinct hue? (Right now both use the same purple in CSS — sq-conventions.md doesn't differentiate.)
- Does Rungles need react-router, or is a single `App.jsx` with state-driven view switching simpler? (Wordy uses react-router. Recommend: match Wordy for consistency.)
- Snibble migration to sq-ui happens in Phase 7 too, or as a separate project? (Out of scope of this plan — Rae's call after Phase 6.)

## Rollback plan

At any time before merging Phase 6:
- Delete `react-port` branch. `main` is untouched, prod is untouched.

After Phase 6 merge if something is wrong:
- Revert the merge commit on `main`. GitHub Actions redeploys the previous vanilla bundle.
- Service workers will eventually pick up the rollback (same skipWaiting+clients.claim pattern works in reverse).
- Database is unchanged, so no data restore needed. The `pre-react-port` snapshot is insurance only.
