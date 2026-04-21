// Scoring for a single rung.
// selected: array of slot entries. Entry is { source: 'rack'|'carried', letter }
//           or null for an empty slot. Either dense (legacy) or sparse (7-slot) works.
// premiumPos: 1-based position of the 2x slot for this rung, or null if none
// Rules:
//   - Only rack-sourced letters contribute to score (carried letters don't score).
//   - If a rack-sourced letter lands on premiumPos, its value is doubled.
//   - Length bonus: +2 per letter beyond 4 (counted on filled slots only).

import { LETTER_VALUES } from './tiles.js';

export function scoreRung(selected, premiumPos) {
  let base = 0;
  let filled = 0;
  selected.forEach((entry, idx) => {
    if (!entry) return;
    filled++;
    if (entry.source !== 'rack') return;
    const val = LETTER_VALUES[entry.letter] ?? 0;
    const pos = idx + 1;
    base += (pos === premiumPos) ? val * 2 : val;
  });
  const lengthBonus = Math.max(0, filled - 4) * 2;
  return base + lengthBonus;
}
