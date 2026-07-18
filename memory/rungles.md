# Rungles — Project Details

Project-local memory: detailed architecture notes for Rungles. Loaded only when Claude is working in this folder. The high-level summary lives in the user's auto-memory at `~/.claude/projects/.../memory/project_sq_rungles.md`.

## Overview

Rungles is a word game (Scrabble tile management + Wordle daily/shareable feel). Vanilla HTML/CSS/JS frontend, Supabase backend. Spec at `rungles-spec.md`.

- **Repo:** `github.com/Katinkabeat/rungles`
- **Live:** `katinkabeat.github.io/rungles/`
- **Supabase project ref:** `yyhewndblruwxsrqzart` (shared with Wordy and SQ)

## Session: July 12, 2026 — notification-tap routing fix (c274)

Cross-game fix for push taps opening the wrong board / doing nothing when the installed PWA is already open. Rungles' part:
- `main.jsx` now calls `installNotificationNav()` (new sq-ui helper) — the hub SW posts a `{type:'NAVIGATE', url}` message on tap and this navigates the open app to the target board. `openWindow` was a no-op inside an already-running installed PWA on Android (the real root cause). Commit `7c032fc`.
- `App.jsx` deep-link effect now also re-reads `?game` on `visibilitychange`/`pageshow` (was read-once-on-boot), a secondary net. Commit `c80fdca`.
- The substantive fix lives in the hub (`public/sw.js` + `sq-ui/utils/notificationNav.js`); this game only wires the receiver. See `rae-side-quest` memory + auto-memory `feedback_sq_notification_click_routing`.

## Session: July 9, 2026 — the daily write now names its day (c257)

Found while doing Oublex's c246: Rungles was the only daily game where a ladder
crossing local midnight silently went wrong, and c237 had marked it "already
safe" for the *wrong reason*.

- **The bug.** `rg_record_daily_solo` took no date and stamped
  `(now() AT TIME ZONE 'America/Halifax')::date` at write time. That does make a
  past-dated (padding) write impossible — c237's conclusion — but it also means
  a ladder started at 11:50pm and finished at 12:05am is **re-dated onto today's
  board**, and `ON CONFLICT DO NOTHING` then reads as "already played today",
  locking the player out of today's real ladder with no explanation.
- **`migration-021-solo-daily-play-date-guard.sql`** adds a `p_play_date date`
  overload that rejects anything that isn't the server's current Halifax day
  (same shape as `yahdle_record_daily_solo` / `oublex_record_solo_result`). The
  client sends the board's `state.dayKey`: the client date is the *claim*, the
  server stays the *authority*. Zero-downtime rollout (add overload → deploy
  client → drop the old dateless signature). All three steps done; the dateless
  overload no longer exists in prod, so `rg_record_daily_solo` cannot be called
  without naming its day.
- **Client.** `finishGame` re-reads `atlanticYMD()` at finish time (not the
  mount-time `today`), skips the write when the day has rolled over, and
  `EndGameModal` shows a `DayEnded` note in place of `SaveStatus` +
  "come back tomorrow": *"This ladder's day ended at midnight, so this score
  won't be recorded. Today's ladder is ready when you are."*
- **`clearSave(dayKey)`** now takes the finished board's day. It defaulted to
  *today's* key, so a cross-midnight finish left yesterday's save orphaned.
- **Verified.** Guard SQL-tested against prod in a rolled-back txn (past date →
  reject, future date → reject, today → counted=t, second play → counted=f).
  Client verified in the browser by stamping a board with yesterday's dayKey and
  then ending the ladder: note renders, no `rg_record_daily_solo` POST fires,
  stale save cleared; the normal path still shows SaveStatus. Checked prod for
  damage: 4 daily rows total, none written just after midnight, so nothing was
  ever misattributed. CACHE_VERSION v42 → v43. Commit `0fb6bfe`.

## Session: June 14, 2026 — Solo is now a DAILY (c215)

Converted solo from unlimited replays to a once-a-day daily puzzle. Rae's
locked decisions: Halifax midnight reset, **no practice mode** (one play, full
stop).

- **Deterministic board from the daily seed.** New `src/lib/rng.js` (mulberry32
  + `atlanticYMD` + `dailySeedString('rungles:daily:YYYY-MM-DD')`, mirrors
  Yahdle). `tiles.js` shuffle/createBag/dealOpeningHand take an optional `rng`
  (defaults to Math.random — multiplayer deals server-side, untouched).
  `soloGame.js`: `newGameState(seed)` builds the rng, deals deterministically,
  and **pre-rolls all 7 premium positions** into `state.premiumPositions` up
  front, so no randomness is consumed during play (refills just pop the
  already-shuffled bag). `applySubmit` reads premium from the array. Same board
  for everyone, verified (rack UOCERVI + premium slot 6 reproduced after
  clearing the save).
- **Per-day save key.** `rungles:solo:<Atlantic-date>`; a previous day's save
  never resumes into today; old `rungles:solo:v1` cleaned up on load.
- **One scored play per day.** `migration-020-solo-daily.sql`: adds
  `play_date` to `rg_solo_games` + **partial** unique index on (user_id,
  play_date) WHERE play_date IS NOT NULL (history keeps play_date NULL → index
  ignores it, non-destructive). `rg_record_daily_solo()` SECDEF RPC computes the
  Atlantic day server-side and no-ops the 2nd play (ON CONFLICT DO NOTHING,
  returns counted bool). Verified in a rolled-back txn: 1st counts, 2nd no-ops,
  keeps the FIRST score. Applied to prod via pooler.
- **Leaderboard unchanged** — existing `rg_solo_leaderboard`/`rg_solo_my_rank`
  (migration-015) already rank per-user-best in a Halifax window; a daily just
  means ≤1 row/user/day.
- **UI.** Landing card → "🎯 Today's Rungles" + "✓ Played today" pill +
  "↗ View today's result" when done. SoloGamePage gates on mount via
  `fetchTodayDaily` (checking / playable / already-played panel). EndGameModal
  swapped "Play Again" for ← Lobby / 🏆 Leaderboard. `recordSoloGame` direct
  insert replaced by `recordDailySolo` RPC call.
- **Why:** gives Rungles a daily loop like Yahdle/Snibble, and naturally caps
  solo for the planned Rook weekly-points board (c214) without a special cap.
- **CACHE_VERSION bumped** rungles-v40 → v41. Committed + pushed (`ecff627`).

## Session: June 7, 2026 — How-to: inactive-player rules documented

Added a "When your opponent goes quiet" `<Section>` to the bottom of `RulesModal.jsx`:
🔔 nudge on the opponent's lobby chip after 12h idle; claim-win from the settings
cog ⚙ after 7 days idle. Pure copy, no logic change. Committed + pushed. Part of a
4-game sweep (Raeban c185) documenting the shared inactive-player rules.

## Supabase sharing decision

Rungles **shares Wordy's Supabase project** (ref `yyhewndblruwxsrqzart`) instead of having its own. The reason: testers don't need to sign up for a second account — they reuse their existing Wordy `profiles` row. Will split into a separate Supabase project before going public.

**How the sharing works without collisions:**
- All Rungles tables and functions use the `rg_*` prefix (`rg_games`, `rg_players`, `rg_racks`, `rg_rungs`, `rg_game_secrets`, `rg_create_game`, etc.) to avoid colliding with Wordy's `games`, `game_players`, `game_moves`, `player_matchups`, `push_subscriptions`.
- `profiles` and `auth.users` are reused as-is — that's the whole point of sharing.
- RLS policies on Rungles tables reference `auth.uid()` the same way Wordy does, scoped only to Rungles tables.
- When the Supabase MCP is pointed at this project ref and you see Wordy tables, that's expected — not a misconfiguration. Do NOT warn the user about wrong project.
- Future split path: spin up new Supabase project, copy `rg_*` tables and functions, repoint frontend. Clean because of the prefix.
- Migration plan lives at `rungles/supabase/migration-001-initial.sql` — idempotent (drops `rg_*` first), uses SECURITY DEFINER RPCs for all mutations so the tile bag stays hidden, RLS scopes racks to the owning user.

## c92 round 3: stats modal → routed page + visual unification (2026-05-19)

Converted Rungles' stats from a `<dialog>` modal to a full routed page so it matches Yahdle's pattern (the visual standard for all three solo SQ games).

- **New `StatsPage.jsx`** uses `SQLobbyShell + RunglesHeader + "← Back to lobby"`. Same chrome as Yahdle/Snibble.
- **Routing:** Added `view === 'stats'` case in App.jsx state machine. `openStats` now does `setStatsReturnView(view); setView('stats')` — remembers where we came from (landing / solo / multi) so "Back to lobby" returns correctly. `closeStats` restores `statsReturnView`.
- **All callers updated transparently:** RunglesHeader / SoloGamePage / MultiGamePage all still pass `onOpenStats` prop down — only the App-level handler changed.
- **Visual tokens** swapped from `rungles-*` (saturated purple) and `divide-rungles-100` borders to neutral white-based classes (`bg-white/5`, `border-white/10`, `opacity-70`). Verified: row `bg: rgba(255, 255, 255, 0.05)` / `color: rgb(237, 224, 255)` — pixel-identical to Yahdle and Snibble.
- **StatsModal.jsx deleted.** Me-tab content (Solo + MP + Last 10 sections) moved into StatsPage with the neutral chrome too.
- **CACHE_VERSION bumped** rungles-v30 → v31.

## c92 follow-up: per-user BEST + medal removal (2026-05-19)

After shipping c92, Rae noticed Rungles looked different from Yahdle/Snibble — per-game ranking meant Rae appeared multiple times in the top 10 (positions #1, #3, #5, #8) whereas the other two games showed one row per user. Decided to:

- **Switch to per-user BEST game in window** (was per-game). Each user appears once, ranked by their best single game's `total_score` in the window. Tie-break: earliest played_at among their best games. Preserves Rungles' "best single game" framing (consistent with the "🎯 Best single rung ever" badge) but unifies the row shape with Yahdle/Snibble. Migration `migration-015-leaderboard-per-user-best.sql` uses `DISTINCT ON (user_id) ORDER BY user_id, total_score DESC, played_at ASC`.
- **Drop medal emojis** (🥇🥈🥉) across ALL THREE games — Rae asked for plain `#N` everywhere. Same change in Yahdle StatsPage.jsx and Snibble StatsModal.jsx as well.
- **Match row style to Yahdle/Snibble** — rounded pill rows with `bg-rungles-50` / dark equivalent (was bare `divide-y` rows), `space-y-1.5`, added `pts` suffix to scores, "← you" indicator on caller's row.
- **CACHE_VERSION bumped** rungles-v28 → v29.
- Verified Month tab now shows `#1 Rae 107 pts` / `#2 Onyi 106 pts` (was 10 rows of Rae+Onyi alternating).

## Extended leaderboards (c92, 2026-05-19)

Ported the c92 pattern from Yahdle + Snibble. Last of the three SQ games to land.

- **Per-game ranking** (not per-user sums) — each row in the leaderboard is one game; a user can appear multiple times in the top 10. Matches Rungles' existing "hall of fame" UX and the card spec tie-break `total_score DESC, played_at ASC`. Yahdle/Snibble are per-user/per-window sums because their games are once-per-day; Rungles users play many times per day so the per-game framing is more useful.
- **New RPCs** (additive — old direct-table queries gone from the client but no DB function was dropped):
  - `rg_solo_leaderboard(p_timeframe, p_date)` — top 10 games in window. Window computed in Halifax tz on `p_date` then converted to timestamptz so the existing `rg_solo_games_score_idx` index is hit.
  - `rg_solo_my_rank(p_timeframe, p_date)` — caller's BEST game's rank in the window (LIMIT 1 with ORDER BY rk ASC).
- **Halifax-tz window pattern** (new to this repo, played_at is timestamptz not date): compute Halifax-local start/end dates, then convert each via `::timestamp AT TIME ZONE 'America/Halifax'` to get the timestamptz boundaries.
- **Migration:** `supabase/migration-014-extended-leaderboards.sql` (no-timestamp convention per [SQ supabase patterns](../../.claude/projects/.../feedback_supabase_patterns.md)). Applied via psql + pooler URL.
- **statsService.js refactored:**
  - Removed `fetchLeaderboard()` and `startOfThisWeek()` — server handles windows now.
  - New `fetchSoloLeaderboard({ timeframe, date })` calls both RPCs in parallel.
  - New `fetchBestRungEver()` separate from leaderboard so the permanent badge doesn't refetch per timeframe.
  - RPC returns username directly (server-side join), eliminating the client-side profile fan-out.
- **StatsModal.jsx rewrite:**
  - Removed the dual All-time + This Week sections. Single timeframe-aware leaderboard now.
  - Segmented control: Day / Week / Month / All-time.
  - Date stepper on Day tab only.
  - Appended "your best in this window #N" row when caller's best game isn't in top 10.
  - "🎯 Best single rung ever" badge always shown below the leaderboard regardless of timeframe — preserved per card spec.
- **CACHE_VERSION bumped** rungles-v27 → v28 (SQ Rungles PWA deploy convention).
- **Verified locally** at `localhost:8080/rungles/` with test user. Day-today: empty + "be the first" message. Month: 10 games shown, Rae and Onyi each appearing 4-5 times (per-game ranking confirmed). All-time: same shape, similar ordering. Week: empty (no plays this week). Best Rung Ever: Rae · REZONED +28 shown across all tabs. No console errors.
- Raeban card [c92] all three games shipped.

## End-of-game discoverability (2026-04-28)

Wordy-parity end-of-game flow added in migration 007:

- **`rg_players.dismissed_at timestamptz`** — per-user ack of a finished game's result. NULL = banner still showing for that user. Mutated only via `rg_dismiss_result(p_game_id)` RPC (SECURITY DEFINER), matching the project convention that all writes go through RPCs.
- **`rg_games.forfeit_user_id uuid`** — records WHICH player gave up. `rg_give_up` patched in 007 to populate it. Lets the lobby/end-game UI distinguish forfeit wins from played-out wins ("🏳️ X gave up — Y wins!" vs "🏆 X wins!").
- **Lobby unseen-results banner** (`LobbyResultsBanner.jsx`) — persistent stack above the games list showing each finished game the user hasn't dismissed. Click row → navigate to game (auto-opens `MultiEndGameModal`). ✕ button → explicit dismiss only; **never auto-dismisses on view** (per Rae: "some users may want to go back and look"). Server `rg_dismiss_result` + per-user localStorage cache `rungles_seen_results_${userId}`.
- **Finish toast** — lobby subscribes to `rg_games` UPDATE events globally. When a game I'm a player in flips to `complete`, a 15-second toast appears: "🏆 Game over · View final board →". Refreshes the banner list ~1s later.
- **Cold-load auto-open** — `MultiGamePage` initial-load effect checks `me.dismissedAt == null` on a `complete` game and auto-opens `MultiEndGameModal`. So clicking the lobby banner takes the user straight to the rung-by-rung review.
- The active-games lobby query stays filtered to `['waiting', 'active']` — finished games surface only via the banner, not in the main list (matches Wordy split).

Files touched: `supabase/migration-007-end-game-discoverability.sql` (new), `src/lib/lobbyService.js`, `src/lib/matchService.js`, `src/components/LobbyList.jsx`, `src/components/LobbyResultsBanner.jsx` (new), `src/components/MultiGamePage.jsx`, `src/components/MultiEndGameModal.jsx`, `public/sw.js` (cache bumped to v14).

### Follow-ups in same session (commits d002496, 7fe21c9)

The banner stack was relocated and re-skinned:

- **`🏁 Completed Games` section** — banners moved out of the top of the lobby into their own section card below `🪜 Multiplayer`. Section header is always visible; empty section when no banners (no "no completed games yet" empty state). Self-contained `src/components/CompletedGamesSection.jsx` owns the unseen-results state, the `subscribeFinishes` toast subscription, and the dismissal handler — `LobbyList.jsx` is back to just the active multiplayer list.
- **Tightened banner copy** — score line is `You X · Opponent Y` (dropped the redundant "Final:" prefix since the section header already says "Completed Games"). The long underlined "View final board →" link was replaced with a compact right-justified "View Game" text button just left of ✕. Click-to-view target is now the button, not the whole row.

Cache bumped through v14 → v15 → v16 across these commits.

## Auth (Phase 2, 2026-04-25)

Rungles no longer hosts its own login form. `js/multiplayer.js`'s boot handler calls `supabase.auth.getSession()` — if there's no session, it redirects to `/games/?return=/rungles/...` and the SQ hub at `katinkabeat.github.io/games/` handles all auth UI. The `shouldRedirectToHub()` hostname guard was removed in Phase 2 along with the in-app auth-gate HTML, the Turnstile script, `handleSignIn`, and `mountTurnstile` — see commit `7a285bd` for the full diff.

Direct URLs still resolve for logged-in users (notification deep links, bookmarks). For local development, all three apps run together via the unified-origin setup (`npm run dev:all` from `rae-side-quest/`) on `localhost:8080` so sessions share via localStorage exactly like production.

## Session: April 29, 2026

### Theme-flash bug — fixed (commit 6a4ebaf)

Live-deploy spot check caught it: Rungles' `index.html` was missing the synchronous pre-React script that Wordy and Snibble both have:

```html
<script>if(localStorage.getItem('rungles-theme')==='dark')document.documentElement.classList.add('dark')</script>
```

Effect: dark-mode users saw a flash of light theme on every page load before React mounted. Fix is one line inserted between the font preloads and `</head>`. Verified locally — `<html>` gets the `dark` class on first paint when localStorage is dark, no class when light.

LocalStorage key is `rungles-theme` (defined in `src/contexts/ThemeContext.jsx:7`).

### CSS extraction sweep — clean

Diffed `rungles/src/index.css` against `sq-ui/globals.css` looking for missed shared rules (similar to the `bg-wordy-300`/`board-grid` bug from the Wordy extraction). Initial pass flagged 5 candidates — all turned out to be false alarms after grepping Wordy/Snibble for usages: `tile-empty*`, `lobby-chip*`, `ladder-letter*`, `action-bar-sticky` are Rungles-only. The `.dark .text-rungles-*` overrides also looked redundant but are actually load-bearing — Tailwind generates `bg-rungles-*` and `bg-wordy-*` as separate class names even though the palettes are identical, so the rungles-named overrides in this file are needed for dark mode to apply to elements that use rungles-named classes.

No CSS changes needed.

## Session: April 30, 2026

### iOS Safari "Load failed" on first play submission — fixed (commit 080f718)

Onyi (iPhone) reported a "TypeError: Load failed" on her first attempt to submit a play; subsequent attempts worked. Desktop users never saw it.

Root cause was an auth-boot race in `src/App.jsx`. The old flow `await supabase.auth.getSession()` and immediately flipped `boot='ready'`. On iOS Safari, `getSession()` can resolve from cached storage before the JWT is actually wired into the client's outbound-request layer, so the first RPC fires headerless and Safari kills the fetch at the network layer (which surfaces as "Load failed", iOS's equivalent of Chrome's "Failed to fetch"). Desktop Chrome doesn't repro because session restoration completes faster than the user can click submit.

Fix: subscribe to `supabase.auth.onAuthStateChange` and only flip `boot='ready'` after the listener fires its `INITIAL_SESSION` event. That event is the supabase-js v2 signal that auth is fully initialized (JWT loaded, listeners armed, ready to attach headers). DEV fallback (no session → fake user) and the redirect-to-hub path are preserved inside the same handler. Listener unsubscribed on unmount. SW cache bumped v18 → v19.

If a similar "Load failed" pattern shows up on Wordy or Snibble, check their App-mount auth flow for the same `getSession()`-then-flip-ready pattern — likely the same fix.

### iOS Safari "Load failed" — round 2: multi-only RPC retry (commit aea2056, 2026-05-01)

The boot-time fix above did NOT resolve the multi-game case. Onyi (after fully closing Safari to pick up `rungles-v19`) still hit "TypeError: Load failed" on her first submission inside an active multi game. Solo was unaffected.

Hypothesis: in multi, `MultiGamePage` mount fires 4-5 parallel `loadMatch` queries plus opens a realtime `subscribeMatch` WebSocket. If the user enters from a push notification (after the app was backgrounded long enough to require an auth-token auto-refresh), iOS Safari can drop the first RPC fetch because it's contending with the websocket handshake and/or the auth refresh fetch. By the second submit, both have settled and submissions go through.

Fix: added `rpcWithRetry()` helper in `src/lib/matchService.js` wrapping `submitRung`, `skipTurn`, `giveUpMatch`. Catches *only* thrown `TypeError` (network-layer fail) and retries once after 400 ms. Server-returned errors (bad word, not your turn, etc.) come back in the `error` field and are NOT retried. SW cache bumped v19 → v20.

If the retry pattern proves to work, consider lifting `rpcWithRetry` into `src/lib/supabase.js` so all Rungles RPCs benefit, and copying the pattern into Wordy and Snibble's data layers for the same iOS contention case.

### iOS Safari "Load failed" — round 3: retry guard was a no-op (commit 7aca7e7, 2026-05-04)

The round-2 retry didn't help. Onyi reported the same error a few days after invite-a-friend shipped, even though her flow didn't involve invites. Investigation found the guard `if (e instanceof TypeError)` never matched, because `@supabase/supabase-js` v2.43.5's postgrest-js catches the underlying `TypeError` from `fetch()` and **repackages it** into a plain object whose `.message` starts with `"FetchError:"`. It returns the wrapped error through the normal `{ error }` channel rather than re-throwing the TypeError. Confirmed in `node_modules/@supabase/postgrest-js/dist/index.mjs:290-321`.

So when our code did `if (error) throw error`, it threw a plain object, and the retry's `instanceof TypeError` was false. Round 2 has been a no-op since it shipped.

Round-3 fix:
- Lifted `rpcWithRetry` into `src/lib/supabase.js` (single source of truth).
- Network-fail detection now matches by message regex (`/load failed|failed to fetch|fetcherror|networkerror/i`) **plus** `instanceof TypeError`, and inspects both thrown exceptions and the returned `{ error }` object.
- Applied the wrapper to every `supabase.rpc()` call site across the codebase:
  - matchService.js: `submitRung`, `skipTurn`, `giveUpMatch`, `fetchPremium`
  - lobbyService.js: `createGame`, `joinGame`, `cancelGame`, `sendNudge`, `rg_expire_stale_games` sweep
  - AdminPanel.jsx: `rg_admin_list_open_games`, `rg_admin_close_game`
- SW cache bumped v24 → v25.

**Lesson for Wordy/Snibble:** if you copy this retry helper, do NOT use `instanceof TypeError` as the only guard — supabase-js v2 hides the TypeError. Match on message string OR check the returned `{ error }` object.

### Username live-join behavior — documented, deferred

Question came up: does renaming a player update old leaderboard rows? Answer: yes, everywhere. All `rg_*` game/leaderboard tables store only `user_id`; usernames are joined live from `profiles` at render time (see `src/lib/statsService.js:88-93` and the same pattern in `matchService.js`, `lobbyService.js`). For a friends-and-family game this is the right default — score stays linked to the person.

Flagged in `rae-side-quest/docs/refactor-backlog.md` (Someday section) as a thing to revisit before public launch — at that point trolls/ban-evasion, screenshot integrity, moderation trails, and deleted-account "Unknown" rows would push toward snapshotting username (and likely avatar_hue) onto the play row at insert time.


### Rack reorder unification — Solo + Multi share visual permutation (commit d3b875c, 2026-05-03)

Both modes now use a `rackOrder` permutation array instead of two divergent mechanisms. Solo previously physically mutated `state.rack` and remapped `selected[].idx` references; Multi already used a visual `rackOrder` but with a buggy splice-with-`to-1` math producing off-by-one swaps, AND was gated on `playable` so rack reorder was silently dead during opponent's turn (HTML disabled blocks clicks).

Fix landed:
- New `src/lib/rackOrder.js` with `swapInOrder` (clean swap, no off-by-one), `shuffleOrder`, `normalizeOrder`, `identityOrder`. Both Solo and Multi import from it.
- Solo: `state.rackOrder` added to state shape, `reorderRack`/`shuffleRack` now permute order only. After `applySubmit`, rackOrder resets to identity for the new tile set. `loadState` is backward-compatible (defaults rackOrder to identity if missing).
- Multi: rack swap + shuffle ungated from `playable` (purely visual prep, no server effect). `disabled={!playable}` removed from rack tiles. `rackOrder` persists to localStorage at `rungles:multi:rackOrder:<gameId>`, restored on initial load, cleared on rack refill (turn change).
- Slot placement and carried-tile selection still gated on `playable` — those affect submission state.

If rack-related bugs surface in either mode, check that `state.rack` (Solo) or server `rack` (Multi) is the source of truth for letters, and `rackOrder` is purely the visual permutation lookup. Selected entries store server idx, never visual position.

### Tier 1 refactor — useBoardDerived + BoardSlots + CarriedTiles (commit f392900, 2026-05-03)

Extracted three shared pieces from `SoloGamePage` and `MultiGamePage` so future styling tweaks and bug fixes land once instead of twice:

- `hooks/useBoardDerived.js` — pure derivation from `selected`. Returns `{ filled, lastFilledSlot, hasGap, currentWord, usedRackIdxs, usedCarriedIdxs }`. Replaces inline computation blocks in both pages.
- `components/BoardSlots.jsx` — the 7-slot play area (Tile + EmptySlot + 2× highlight). Takes `selected`, `premiumPos`, `onSlotTap`, optional `tileDisabled` (Multi gates on `playable`) and optional `wrapperClassName` (Solo passes flash-animation classes).
- `components/CarriedTiles.jsx` — the 304px-wide carried-letter row with empty-state and label. Caller normalizes letters to `string[]` — Solo extracts `state.carried[i].letter`, Multi passes raw `carriedLetters`.

Sizes after: SoloGamePage 418 → 375, MultiGamePage 610 → 582. Three shared files total 126 lines.

What was deliberately NOT extracted: `handleSlotTap` and `handleSourceTap` handlers. They diverge fundamentally — Solo dispatches via pure reducers in `lib/soloGame.js`, Multi mutates fragmented `useState` pieces. Forcing them into a shared hook would require rewriting one of the state patterns. The pure-presentation extractions sidestep this entirely and were the actual safe wins.

The Tier 1 / Tier 1.5 / Rungles MultiGamePage entry in `rae-side-quest/docs/refactor-backlog.md` can now be marked shipped.


### Session: 2026-05-03 — Completed Games: same fix as Wordy

Mirrored Wordy's completed-games fix to Rungles:
- **Order-by bug:** `fetchUnseenResults` ordered on the joined `rg_games.finished_at` column via `referencedTable`. PostgREST only sorts the embed payload that way, not the parent rows. With `LIMIT 10` applied first, the section returned the OLDEST 10 finished games. Reworked to query `rg_games` as the parent so order-by sorts the rows we limit on.
- **Always show 10:** removed the `dismissed_at IS NULL` filter and the `rungles_seen_results_*` localStorage filter.
- **Removed dismiss UI:** `LobbyResultsBanner` no longer renders the X button. `dismissResult` helper deleted from `lobbyService`. `CompletedGamesSection` no longer wires `onDismiss`.

Note: The `rg_dismiss_result` RPC and `rg_players.dismissed_at` column still exist in the DB. Left in place — harmless and would only need cleanup as part of a wider schema review.

**Commit:** `0af2bfd`.


### Session: 2026-05-03 — Invite-a-friend feature

Mirrored Snibble's invite pattern to Rungles. Same single "Create game" button now opens a sheet with two modes: 🌍 Open (anyone joins, 7-day auto-cancel) and 👥 With a friend (only invitee joins, 3-day auto-cancel).

**Schema (`migration-010-invite-friend.sql`, applied):**
- `rg_games.invited_user_id` (uuid?) — if set, only this user can see + join
- `rg_games.expires_at` (timestamptz) — auto-set by `rg_set_game_expiry` BEFORE-INSERT trigger; 3d for invited, 7d for open
- `rg_games.cancelled_at` (timestamptz?) — set when creator manually cancels
- `'cancelled'` and `'expired'` added to status check constraint
- Read-RLS replaced — invited games hidden from non-participants. Policy uses `created_by` and `invited_user_id` only (no rg_players cross-table check) to avoid RLS recursion. Once invitee joins, they remain pinned by invited_user_id, so reads still work.
- `rg_create_game(p_total_rungs, p_invited_user_id)` — old single-arg sig dropped; clients must pass two args (null is fine for the second)
- `rg_join_game` — refuses non-invitees on private invite games
- `rg_cancel_game(p_game_id)` — creator-only, blocked once any rung exists
- `rg_expire_stale_games()` — sweeps past-expiry waiting games to status='expired'
- `rg_notify_game_invited` AFTER-INSERT trigger → POSTs to rungles-push-notification with type=`game_invited`

**Edge function (deployed):** `game_invited` handler in `rungles-push-notification` — looks up inviter username, sends "Rungles — match invite: {inviter} invited you to a Rungles match" push to invitee.

**Frontend:**
- `src/hooks/useFriends.js` — same shape as Snibble's; reads hub friendships+profiles
- `src/components/CreateGameSheet.jsx` (new) — toggle + search + friend picker, rungles-themed (rungles-* tokens)
- `src/lib/lobbyService.js` — `createGame({ totalRungs, invitedUserId? })`, new `cancelGame()`; `fetchLobby` now selects `invited_user_id`/`expires_at`/`cancelled_at`/`created_by` and lazy-calls `rg_expire_stale_games` before reading
- `src/components/LobbyList.jsx` — buckets `invitedToYou` to the top, wires the cancel handler, passes `onCancel` only for waiting games the user created
- `src/components/LobbyRow.jsx` — accepts `isInviteToMe` (amber row + "Accept" button + synthesized "You" chip + "(N inviter) invited you" subtext) and `onCancel` (✕ button on creator's waiting rows). For creator's invite rows, subtext reads "📨 Invited {invitee}".
- `src/components/LandingPage.jsx` — opens `CreateGameSheet` instead of calling `createGame` directly; passes `user` from session

**Verified in preview:** sheet opens with Open mode by default, toggle swaps to friend mode, 3 accepted friends load (Krispy/Onyi/snuggie), search filters as you type, friend selection updates button label to "Send invite to {name}", ✕ cancel button appears on existing waiting-for-opponent row.

**Auto-expiry:** lazy via `rg_expire_stale_games()` called on each lobby load. Cron is a future add.

**Cancelled/expired UX:** cancelled games disappear from lobby. Expired games drop out of the waiting-status filter naturally (status flips to 'expired'). Both still show in completed history if needed (status check accepts both).



## 2026-05-04 — Tile rack cross-browser layout

Switched the rack container in both `SoloGamePage.jsx` and `MultiGamePage.jsx` from `flex … flex-nowrap` to `grid grid-cols-7 gap-1 max-w-[304px] mx-auto`. Rungles wasn't visibly broken (flex-nowrap held), but grid is more robust against future tile/gap changes and matches the Wordy fix where Firefox was wrapping the 7th tile. Cache bumped to v24.

## 2026-05-04 — perf sweep: lobby subscription scoping

Same fix as the Wordy lobby. `subscribeLobby()` in `js/multiplayer.js`
was subscribed to every `rg_games` and `rg_players` row change in the
database, causing a full lobby DOM rebuild on every other player's move
across the platform. Now narrowed via filters:
```js
.channel(`lobby_rg_games_${me}`)
.on('postgres_changes',
    { event: '*', schema: 'public', table: 'rg_games', filter: `created_by=eq.${me}` }, ...)
.on('postgres_changes',
    { event: '*', schema: 'public', table: 'rg_players', filter: `user_id=eq.${me}` }, ...)
```

Other people's open games appear via the existing visibility-change
refresh instead of in real-time — acceptable trade-off since urgent
events still come via push notifications.

**Cross-cutting (rae-side-quest):** Added 5 perf indexes via
`sq_perf_indexes.sql` migration on `rg_players(user_id)`,
`rg_solo_games(user_id)`, `rg_rungs(player_user_id, created_at)`,
plus the Wordy equivalents.

Commit `60a4144`.

**Audit-flagged but NOT fixed yet** (lower priority; revisit if Rae
notices Rungles-specific slowness):
- Hint word finder iterates all 172k words on main thread
- Full lobby DOM rebuild on every subscription event (now less of a
  problem since the subscription itself is narrowed)
- O(m) `indexOf` lookup in `appendWordWithCarryHighlight`

## Match-load perf sweep (2026-05-04)

The vanilla-JS lobby-subscription fix (commit `60a4144`) had never been
ported to the React rewrite. Reapplied here, plus parallelized
`loadMatch`. Cache bumped to `rungles-v26`.

- **`src/lib/lobbyService.js` — `subscribeLobby(myUserId, onChange)`**
  now takes the user id and uses three filtered subscriptions
  (`rg_games created_by=eq.me`, `rg_games invited_user_id=eq.me`,
  `rg_players user_id=eq.me`) on a per-user channel name. Previously
  every move on the platform fired `refresh()` and rebuilt the lobby.
  Same tradeoff as vanilla: new public games created by others won't
  appear live until the next manual refresh.
- **`src/components/LobbyList.jsx`** — caller updated to pass
  `myUserId`.
- **`src/lib/matchService.js` — `loadMatch()`** now fans out the four
  independent queries (`rg_games`, `rg_players`, `rg_racks`,
  `rg_rungs`) via `Promise.all`, then runs `profiles` + `fetchPremium`
  in parallel as the dependent stage. Was 6 sequential roundtrips;
  now 2 stages.
- **Still unfixed** (low priority): `loadMatch` selects `*` from
  `rg_games` and `rg_rungs`; `fetchLobby`'s `rg_expire_stale_games`
  RPC fires on every refresh.

## 2026-05-07 — Multi ladder color coding fix (commit 9d98263, migration-013)

Rae and Onyi noticed multiplayer rungs sometimes coloring scoring letters
grey and missing the gold 2x highlight. Solo was unaffected.

Root cause: pre-013 the `rg_rungs` table had no per-letter source column.
`rg_submit_rung` accepted `p_word_sources` for validation, then threw it
away. `MultiLadderRow.jsx` had to guess via `highlightCarried()` in
`src/lib/matchService.js`, which greedy-pool-matched the new word's letters
against the previous rung's word. Any letter coincidentally present in the
previous rung got painted grey even when the player actually played a fresh
rack tile for it — and the `!isCarried` guard on the gold premium then
suppressed gold for the same letters.

Fix:
- **`migration-013-rung-sources.sql`** — `ALTER TABLE rg_rungs ADD COLUMN
  word_sources int[]` (nullable; old rows stay NULL). Replaced
  `rg_submit_rung` to write `p_word_sources` into the new column. Idempotent.
- **`src/components/MultiLadderRow.jsx`** — reads `rung.word_sources` when
  present, falls back to the legacy `highlightCarried` pool-match for old
  rungs. `loadMatch`'s `select('*')` from `rg_rungs` already passes the new
  column through; no service-layer changes needed.
- Cache bumped v26 → v27.

Existing 260 rows have NULL `word_sources` and render exactly as before
(fall-back path). Only newly-played multi rungs use the authoritative
sources array. Solo's `LadderRow.jsx` was already correct (per-letter
sources stored in local state).

Migration applied via Management API SQL endpoint
(`api.supabase.com/v1/projects/.../database/query`) — direct `psql` to the
`db.<ref>.supabase.co` host fails with DNS resolution on this network
(IPv6-only). Note for future migrations: pooler URL would also work but
isn't in `.env.supabase`; the API route works with `SUPABASE_ACCESS_TOKEN`
+ a `User-Agent: curl/8.0.0` header (default Python UA gets blocked by
Cloudflare with code 1010).

Visual end-to-end confirmation deferred — needs a fresh two-player game
between Rae and Onyi to see new rungs render with the corrected colors.

## 2026-05-21 — Blocked-user filtering in invite friend list (c124)

`useFriends` now fetches `user_blocks` (RLS exposes only rows where
`blocker = auth.uid()`) and filters those ids out before loading profiles, so
people you've blocked no longer show in the Create Game invite dropdown.
Game-side only, no DB change — mirrors the hub Friends view pattern. This hook
is byte-identical to Wordy's; same edit shipped to both.

Root cause: `block_user` only inserts into `user_blocks`; it does NOT remove the
friendship, so blocked friends leaked into the friends-only dropdown. Scope: only
removes people *you* blocked; the reverse direction is server-side and out of
scope (RLS won't expose who blocked you).

Verified at the data layer in psql (simulated authenticated session, temp block
inside a rolled-back transaction). Build clean. NOT exercised in-browser
(Turnstile login, no test creds).

## 2026-05-31 — Decline-invite + opt-in decline-notify (c167/c172)

Added a decline (x) button to incoming invites + `rg_decline_invite` SECURITY DEFINER RPC (supabase/migration-016-decline-invite.sql). Rungles invites are 1v1, so a decline always closes the game (close_reason='Invite declined'). Phase 2 (migration-017-decline-notify.sql): the RPC net.http_post's an 'invite_declined' push to rungles-push-notification edge fn, gated by the new per-game 'invite_declined' notif topic (default OFF, opt-in in hub NotificationsPanel). Edge fn handles the type via sendIfOptedIn. Verified via rolled-back impersonation test + live smoke test on deployed fn. Authed device-side push NOT E2E'd — Rae to confirm.

## Invite-expiry baseline (c151, 2026-06-01)
Adopted the SQ invite-expiry baseline (1v1 → universal half only; NOT expanded to N-player). `supabase/migration-014-invite-expiry-baseline.sql` (applied to prod via pooler): friend window 1d→3d; `rg_expire_stale_games` now stamps `close_reason='no_other_players'` + fires a `game_closed` push to created_by (keeps status='expired'; no triggers fire on waiting→expired). Edge fn `rungles-push-notification`: added `game_closed` type. Client: `lobbyService.fetchUnseenResults` broadened to include 'expired' + selects close_reason + sets isExpired; LobbyResultsBanner shows "🚫 Game closed" + "invite expired" blurb. (Creator gets an rg_players row at create, so the inner-join completed query surfaces it.) Commit 6c10d4a.

## 2026-06-06 — Claim-inactive-win, built from scratch (c153)
Rungles had no claim path. Reused the existing `rg_games.turn_started_at` (added for nudge, stamped on every turn advance) as the inactivity clock — no schema change. `supabase/migration-018-claim-inactive.sql` (applied to prod via pooler) adds `rg_claim_inactive_win(p_game_id)`, mirroring `rg_give_up`'s end-state (status=complete, current_player_idx=NULL, winner_player_idx=caller, forfeit_user_id=stalled opponent) but initiated by the off-turn player; guards: not-your-turn + turn_started_at older than 7d. Client: `claimInactiveWin` in matchService.js; MultiGamePage computes `canClaim` and renders a "🏆 Claim win" button inside the always-visible top status card (reachable on mobile). Verified with a rolled-back impersonation happy-path test. SW bumped v32→v33. Authed click-through NOT E2E'd. Commit pushed.

## 2026-06-07 — Claim + give-up moved into the cog; fixed a crash I caused (c153 revision)
Per Rae, moved claim + give-up OUT of the status-card / action-bar and INTO the settings cog. Added a `gameRows` render-prop to SettingsDropdown.jsx (threaded through RunglesHeader.jsx); MultiGamePage passes `cogGameRows`. Removed the status-card claim button and the action-bar "Give Up" button. Give-up now uses a `window.confirm()` dialog (the old two-tap-arm doesn't work inside a closing menu) — dropped the giveUpArmed state/timer. Claim row ALWAYS shown, greyed unless opponent's turn + idle 7+ days. **REGRESSION I introduced + fixed same session:** `cogGameRows` referenced `isComplete` before its `const` declaration (TDZ) → MP page white-screen crashed on every render. Fix: hoisted `const isComplete` above `cogGameRows`. Lesson: anything computed in the component body that's used before the render must be declared before it (build won't catch TDZ). SW bumped v33→v36. Rae verified MP loads again + greyed claim/give-up in cog.

## 2026-06-07 — timeAgo unified on sq-ui shared helper; days bug fixed (c186)
Deleted local src/lib/timeAgo.js (it capped at "Xh ago" and NEVER rolled over to days — the one real inconsistency across games). Repointed LobbyRow.jsx to the shared `timeAgo` from rae-side-quest/packages/sq-ui. Rungles lobby now shows "Xd ago" on 24h+ stale rows like the other games. Lost the old "Xs ago" sub-minute granularity (shared helper says "just now" under 1m — intentional, matches the others). SW bumped v36 -> v37.

## 2026-06-11 — Game-end push on claim/forfeit (c188)
Rungles had no game-end push (turn_change only). Added the unified SQ game-end contract (mirrors Wordy). `rg_games.end_reason` ('claim'|'forfeit'). `rg_claim_inactive_win` stamps 'claim'; `rg_give_up` stamps 'forfeit' AND now records `forfeit_user_id = caller` (it previously set only winner_player_idx, so the loser couldn't be identified). New `on_rg_game_finished` trigger (active→complete, WHEN end_reason set) → pg_net 'game_finished'. Edge fn got `getUsername` + a `game_finished` handler: loser = forfeit_user_id, winner = rg_players at winner_player_idx; claim → push loser, forfeit → push winner; same two messages as Wordy; skips bots/respects prefs. Migration `supabase/migration-019-gameend-push.sql` applied via pooler; fn deployed. Routing verified on the deployed fn (recipient/wording identical to verified Wordy).

## 2026-07-02 — Removed "← you" leaderboard self-marker (Rae request)
Dropped the "← you" text label (Wordy: "(you)") from the leaderboard row in StatsPage. The `isYou`/`isMe` prop still drives the row highlight (bg-white/15 ring) — only the redundant text was removed. In-match "(you)" during live games left as-is (not a leaderboard). No Quill post (Rae's call, too small).

## 2026-07-07 — Nudge push failures now surfaced (c239)
The nudge push was fire-and-forget (`.catch(() => {})` / warn-only), so a dropped POST left the nudger with a false "Reminder sent!" toast. Now the handler awaits the push, checks `res.ok`, and on a non-2xx or network error surfaces a failure toast instead of success (plus `console.warn`). Added an 8s `AbortController` cap so a hung edge fn can't spin the nudge button forever. Failure leaves the button available to retry.
Known limit (unchanged, out of scope): the RPC/update stamps `last_nudged_at` *before* the push, so a retry within 12h is still cooldown-blocked server-side. Verified: all four games build clean + boot; the failure toast itself needs an authed >12h-stale match to click (hub-login bounce = known authed-verify wall).

## 2026-07-09 — Solo daily write hardened (fire-and-forget → resilient) (SQ audit, c254 sibling)
Cross-game audit follow-up after the Oublex silent-write bug. Rungles' solo daily write was fire-and-forget: `finishGame` called `recordDailySolo(...).catch(e => console.warn(...))` — no await, no retry, no `refreshSession`, no UI status, and it uniquely bypassed the project's `rpcWithRetry` helper. A failed write (stale-token 401 after a backgrounded mobile tab) silently dropped the score AND — because re-entry is gated on the `rg_solo_games` row (`fetchTodayDaily`) — reopened today's daily for replay/leaderboard-farm.
- **Fix:** `recordDailySolo` now wraps the RPC in `rpcWithRetry` (network-layer race). `SoloGamePage.finishGame` → new async `recordDaily(args)` that awaits, calls `supabase.auth.refreshSession()` + backs off, retries up to 3×, and sets a `recordState` (idle|saving|error|saved). `EndGameModal` shows "Saving your score…" / "Couldn't save your score. Retry saving" (retry button) instead of silently claiming success. SW bumped v41 → v42. Commit `cfcf274`.
- **Gotcha caught in verify:** first pass named the React state `saveState`, which SHADOWED the imported `saveState` from `soloGame.js` (the localStorage board-persist fn) → `saveState is not a function` crash on entering the game. Renamed to `recordState`. This is exactly why "compiles clean" ≠ verified.
- **Verified locally (preview):** game board renders (no crash); Give Up → EndGameModal → 3 retry attempts logged (attempt 1/2/3, with refreshSession between) → "Couldn't save" + Retry surfaced. That was the FAILURE path (dev session has a user id but no valid token). Success path not driven with a live token — same unchanged RPC contract proven in prod + E2E-verified in Oublex.
- Sibling fixes: Oublex (c254, done), Yahdle + Wordy (pending, same audit).

## 2026-07-10 — Nudge bell gated on the opponent's opt-in + toast now reads `sent` (c259)
Generalised c248 (which shipped Yahdle-only) to all four games, and closed the hole c260 left open.

**Two changes, one invariant: never claim a nudge was sent unless a notification was actually delivered.**
1. **Bell gate.** The 🔔 only renders when the recipient has that game's `nudge` topic enabled (`sq_notification_enabled(uid, app, 'nudge')`). Fail-open: an RPC/transport error returns `true`, so a hiccup in a courtesy check never hides a bell that would have worked (the server re-checks the same pref anyway).
2. **Delivery check.** The push edge functions answer **HTTP 200** with `{sent:false, reason:'opted out'|'no push subscription'}` or `{skipped:'…'}`. `res.ok` therefore proves *nothing*. All four call sites now read the body and treat `sent !== true` as a failure. An unparseable 200 counts as delivered (fail-open — a false "couldn't send" on a nudge that landed is worse).

`no push subscription` is the common case, not `opted out`: a player with the pref ON who never granted browser permission. The bell gate does NOT catch that one — only the `sent` read does.

**Shared helper.** `rae-side-quest/packages/sq-ui/utils/nudge.js` — `isNudgeEnabled(supabase, userId, app)`, `postNudge({url, anonKey, body})` → `{delivered, reason, status}`, `nudgeFailureMessage(reason)`. sq-ui carries no deps, so the **caller passes its own supabase client**. Non-React lib files import `utils/nudge.js` directly (not the package index) so they don't drag the JSX components into their chunk. Games consume sq-ui by relative path, so no install step.

Failure copy never names the recipient's notification settings — "They're not set up to get reminders right now." Their prefs are their business, not the nudger's.

**Verified:** probed the four *live* edge fns with a bogus game id — all returned **200 + `{skipped}`**, i.e. the old `res.ok` code would have toasted "Reminder sent!" for a nudge that never left the server. Stubbed the remaining body shapes (`sent:true`, both `sent:false` reasons, 404, unparseable, network error) — all classify correctly. Gate proven at the data layer in a rolled-back txn against a real account: per-topic off → bell hides for that game only; back on → returns; per-app `_master` off → hides; global `_all/_master` off → hides everywhere. Vite `@fs` resolution of the new cross-package import confirmed 200 in all four dev servers. All four build clean. Bell click stays the authed boundary ([[feedback_sq_verification_constraint]]).
**Rungles specifics:** `LobbyRow` is a controlled component, so the gate lives in `LobbyList.jsx` as a `nudgePrefs` Map (Yahdle's fan-out shape), fed by new `isNudgeEnabled` + `currentPlayerId` exports from `lobbyService.js`. Nudge error toast no longer prefixes `Couldn't send reminder:` — the helper's copy is already a full sentence. SW → `rungles-v44`. Commit `37b9b27`.

✅ **Resolved (c264, 2026-07-11):** split `rg_nudge` (validate-only, still `RETURNS void`) + new `rg_mark_nudged(p_game_id)` (re-checks participant/active/not-current-player, then stamps). `lobbyService.js:sendNudge` calls `rg_mark_nudged` via `rpcWithRetry` **only after** `postNudge` returns `delivered:true`; a failed stamp `console.warn`s, never throws. Migration `supabase/migration-023-nudge-cooldown-on-success.sql` — re-specified `SET search_path` (CREATE OR REPLACE clears it) + re-asserted the anon/public revoke. SW → `rungles-v45`. Verified at the data layer in a rolled-back txn: validate leaves `last_nudged_at` NULL (bell stays available on a failed send); mark stamps; current player rejected. Commit `d50c963`. All four games now stamp only after confirmed delivery.

## 2026-07-11 — Push address refresh-on-play + address-death alarm (c270 / c268)
Part of the platform-wide notification-reliability stack (watch card c269). Two changes landed in this game:
1. **Refresh-on-play (A1, c270):** `main.jsx` now calls `installPushHeal()` (from sq-ui) after `installGlobalErrorReporting`. It injects a hidden `/games/?heal=1` iframe — guarded by `Notification.permission==='granted'` (never prompts), once/session — that runs in the HUB service-worker scope and re-subscribes the shared `sidequest` push address while the user just plays. Closes the old "only heals on hub-open" gap for players who live in one game tab. The heal logic lives in the hub (`HealFrame.jsx` + `pushNotifications.ensurePushSubscribed`); this game only embeds the frame. All SQ apps are same-origin under `katinkabeat.github.io`, so the iframe shares localStorage + session.
2. **Address-death alarm (c268):** the push edge fn's 410/404→delete branch (`sendPushToUser`) now calls `reportAddressDeath` → posts a low-noise FYI to #error-log (game/user/topic/endpoint-host, as Rook) so a dead push address is no longer silent. `topic` threaded through `sendIfOptedIn → sendPushToUser`.
**Rungles SW:** bumped `rungles-v45 → v46` (PWA app-shell). Push fn: `supabase/functions/rungles-push-notification/index.ts`. Deployed + smoke-tested 200.

## 2026-07-18 — Time-sensitive pushes send Urgency: high (c283)
Follow-up to the 2026-07-14 stale-notification investigation (c285): battery saver / Doze defers normal-urgency FCM delivery up to ~1h, so a your-turn push could display already stale. The push fn now sends `urgency: 'high'` for topics where a held-back delivery goes stale — `your_turn`, `nudge`, `invite`, `opponent_joined` (new `HIGH_URGENCY_TOPICS` set; `topic` threaded into `sendWithRetry`). Outcome topics (`game_finished`, `invite_declined`, `game_closed`) stay normal — FCM can deprioritize senders that blanket-mark pushes high. Same edit across all 8 SQ push fns + the sq-game-starter scaffold. Deno type-check clean; deployed; verified with a live wordy nudge to Rae (`sent:true` through the new path). Only narrows the stale window — the hard guarantee is the SW staleness guard (c284, still pending).
