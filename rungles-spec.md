# Rungles - Game Spec & Build Plan

## Project Overview

**Rungles** is a word game that combines Scrabble's tile-management strategy with Wordle's shareable-daily-puzzle feel. Players build a "ladder" of words where each word (rung) must share at least 3 letters with the previous rung, while managing a rack of 7 letter tiles.

**Name:** Rungles (working titles were Tile Ladder, Rungs, TileChain, Stacked, Linkup)

**Tech stack:** HTML, CSS, JavaScript (vanilla), Supabase (for daily puzzles, leaderboards, user accounts in later phases)

**Target:** Mobile-friendly web app, playable in browser

---

## Core Game Rules

### Setup
- Player starts with a rack of **7 letter tiles** drawn from a Scrabble-style letter bag
- Letter distribution and point values match standard Scrabble (A=1, B=3, C=3, D=2, E=1, F=4, G=2, H=4, I=1, J=8, K=5, L=1, M=3, N=1, O=1, P=3, Q=10, R=1, S=1, T=1, U=1, V=4, W=4, X=8, Y=4, Z=10, blank=0)
- Standard tile counts: 100 tiles total (same as Scrabble)

### Playing a Rung
- **Rung 1:** Play any valid word using tiles from your rack. Minimum 4 letters.
- **Rung 2+:** New word must:
  - Use **at least 3 letters** that appeared in the previous rung's word
  - Any additional letters needed come from your tile rack
  - The carried-over letters are "free" (don't consume tiles from your rack)
- After each rung, draw tiles back up to 7 from the bag
- **Blanks** lock to whatever letter they're assigned on first use — they stay that letter for the rest of the game
- **Free redraw:** If the opening rack is all vowels or all consonants, the player gets one free redraw

### Word Validation
- Use a standard word list (TWL or SOWPODS for Scrabble dictionary)
- Suggest using a free word list like `words_alpha.txt` or the Collins Scrabble Words list
- Words must be at least 4 letters long
- No proper nouns, no abbreviations

### Scoring
- **Base score per rung:** Sum of letter values (like Scrabble) — **only newly-played tiles count**. Carried-over letters do NOT contribute to the score. This prevents pure-anagram chains from dominating.
- **Length bonus:** +2 points per letter beyond 4 (so a 5-letter word = +2, 6-letter = +4, etc.)
- **Premium slot (2x):** Each rung has one randomly-placed premium slot, visible before the player submits. If a newly-played tile lands on that slot, its letter value is doubled. Carried-over letters do NOT trigger the premium. If the word is too short to reach the premium position, no bonus.
- **Full reuse bonus:** REMOVED — no longer needed since carried letters don't score.
- **Game length:** 7 rungs for MVP (10 for multiplayer) — revisit after playtesting.

### Scoring tuning — possible adjustments (post-playtest)

If chain-heavy rungs feel under-rewarded after real play, consider adding:

- **Chain bonus** (preferred option): flat bonus for deep carryovers.
  - +5 points if the rung uses 4 carried letters
  - +10 points if the rung uses 5+ carried letters
  - Rewards the "deep chain" move directly, without weakening the no-score-for-carried rule.
- **Alternates if the chain bonus isn't enough:**
  - Bump length bonus from +2 to +3 per letter beyond 4 (or scale: 4→0, 5→3, 6→7, 7→12)
  - Bump premium slot from 2× to 3×

Playtest current numbers first; only tune if the feel is actually flat.

---

## Game Modes

### Phase 1: Solo Practice Mode (MVP)
- Random tile bag each game
- Goal: complete 7 rungs, maximize score
- Give-Up button (double-click to confirm, Wordy-style) ends the game early
- **Hint button** (costs 5 points): reveals one valid word the player could play from their rack + carried letters, honoring the 3-letter carryover rule. Unlimited uses. Score can go negative.
- **Opening-rack guarantee:** the dealer always returns a rack that can form at least one valid 4-7 letter word (verified against the dictionary). No frustrating "impossible" opening hands.
- No daily mode, no backend, no accounts — pure frontend

### Phase 3: Multiplayer (future)
- **Race mode:** Both players get same starting tiles, build parallel ladders, highest score after 10 rungs wins
- **Shared ladder:** Players take turns adding rungs to a single ladder
- Requires Supabase realtime subscriptions

---

## UI / UX

### Main Screen Layout (Mobile-First)
```
┌─────────────────────────┐
│ Tile Ladder      ⚙️ 📊  │  <- Header: title, settings, stats
├─────────────────────────┤
│ Daily #42  Score: 127   │  <- Game info bar
├─────────────────────────┤
│                         │
│ Rung 3: TOASTER  (+18)  │  <- Previous rungs (scrollable)
│ Rung 2: ROAST    (+7)   │
│ Rung 1: STORM    (+11)  │
│                         │
├─────────────────────────┤
│ Current rung: _______   │  <- Input area
│ [Letters carried: T,O,A]│
│                         │
├─────────────────────────┤
│ Your rack:              │
│ [E][I][N][R][S][L][B]   │  <- Tile rack (tappable)
├─────────────────────────┤
│ [Submit]  [Shuffle]     │  <- Action buttons
└─────────────────────────┘
```

### Interactions
- Tap tiles to build a word (they move into the input area)
- Tap letters already "carried over" from previous rung (shown differently, maybe shaded) to include them for free
- Tap in input area to remove a letter
- Shuffle randomizes rack order (visual only, no game effect)
- Submit validates the word and scores it

### Visual Feedback
- Invalid word: shake animation + red flash
- Valid word: green flash, rung slides up into the ladder
- Running out of tiles that could form a valid word: show hint button (Phase 2)

### Accessibility (IMPORTANT)
- Full keyboard support (type letters to add to input, Enter to submit, Backspace to remove)
- Proper ARIA labels on all tiles and buttons
- Screen reader announcements for scoring and rung completions
- High contrast mode toggle
- Color-blind friendly (don't rely solely on color for state)

---

## File Structure

```
tile-ladder/
├── index.html
├── css/
│   └── style.css
├── js/
│   ├── game.js          # Core game logic
│   ├── dictionary.js    # Word validation
│   ├── tiles.js         # Tile bag & rack management
│   ├── scoring.js       # Score calculation
│   ├── ui.js            # DOM manipulation
│   └── share.js         # Share-result generation
├── data/
│   └── words.json       # Word list (or loaded from CDN)
└── README.md
```

---

## Build Phases

### Phase 1 - MVP (Solo Practice Mode, No Backend)

**Goal:** Playable single-player game in browser, one random puzzle per session.

1. Set up file structure and basic HTML skeleton
2. Build tile bag logic (100 tiles, correct distribution, random draw)
3. Build rack display and tile selection UI
4. Implement word input area with tile → input flow
5. Load word list (use a free English word list - keep under 1MB if possible, or lazy-load)
6. Implement word validation (min 4 letters, in dictionary)
7. Implement "3-letter carryover" rule checking against previous rung
8. Implement scoring (base + length bonus + full-reuse bonus + chain multiplier)
9. Build ladder display (previous rungs scrollable above current input)
10. Handle game end (7 rungs completed OR player gives up)
11. Show final score summary with option to start over

### Pre-publish - Player-facing rules & help

Before sharing with testers or publishing:

1. **Rules/How to Play section** accessible from the ⚙️ settings button:
   - How a rung works (rack + carried letters, min 4 letters, need 3 carried from rung 2 onward)
   - Scoring explained (rack letters score, carried don't; 2× premium slot doubles a rack letter if you land on it; length bonus +2 per letter beyond 4)
   - Blank tile behavior (lock to the letter you choose on first use)
   - Give-up and skip mechanics
   - Multiplayer-specific rules (shared ladder, separate racks, shared bag, 10 rungs total, turn-based)
2. Keep copy short — 1 screen on mobile, bullet points or a small table, not a wall of text
3. Include a worked example (e.g., "STORM → CHORE uses 3 carried: C H O R E, where C and E came from your rack")

### Phase 2 - Daily Mode + Local Persistence

1. Seed tile bag based on date (same seed = same tiles for everyone on that day)
2. Save daily result in localStorage (prevent replaying same day)
3. Build share-result generator (copyable text with emoji grid)
4. Add streak tracking in localStorage
5. Add stats page (games played, average score, best score, streak)

### Phase 3 - Supabase Integration

1. Set up Supabase project
2. User authentication (email or anonymous)
3. Save daily results to cloud (sync across devices)
4. Global leaderboard (optional - top scores per day)
5. Friend system (optional)

### Phase 4 - Multiplayer

1. Realtime game rooms via Supabase channels
2. Race mode implementation
3. Shared ladder mode

---

## Key Technical Considerations

### Word List
- A full Scrabble dictionary is ~270,000 words. Too big to load upfront on mobile.
- Options:
  - Load word list lazily from CDN
  - Use a Bloom filter or trie for efficient lookup
  - Host word list on Supabase and validate via API call
  - For MVP, use a smaller common-word list (~10,000-50,000 words) to keep load times reasonable

### Carryover Validation
- "Uses at least 3 letters from previous rung" = letter multiset intersection of at least 3
- Example: previous = "STORM" (S,T,O,R,M), new = "ROAST" (R,O,A,S,T) → intersection is {R,O,S,T} = 4 letters ✓
- Important: handle duplicate letters correctly (treat as multiset, not set)

### Seeded Randomness (for Daily Mode)
- Use a seeded PRNG (e.g., mulberry32) so everyone gets same tile draw order on same date
- Seed = days since some epoch date, or a hash of the date string

---

## First Prompt to Claude Code

When you're ready to start building, try something like:

> I'm building a word game called Rungles. I have a spec file at `rungles-spec.md`. Please read it, then start with Phase 1 Step 1: set up the file structure and a basic index.html skeleton with placeholder divs for the header, ladder display, input area, tile rack, and action buttons. Mobile-first CSS. No JS logic yet — just the scaffold. Confirm the plan before creating files.

Then build iteratively, one step at a time. Don't let it run off and build the whole Phase 1 in one shot — it'll be easier to debug step by step.

---

## Notes for Rae

- This fits well with your existing HTML/CSS/JS + Supabase stack
- Accessibility features listed are important given your Wordy experience — building them in from the start is much easier than retrofitting
- For Phase 1, you don't need Supabase at all — it's pure frontend, which is a nice self-contained scope
- Consider making this a candidate for your personal project portfolio alongside Wordy
