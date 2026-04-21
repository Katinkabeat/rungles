// Tile bag and rack management for Rungles.
// Standard Scrabble distribution: 100 tiles, with letter values.

export const LETTER_VALUES = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8,
  K: 5, L: 1, M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1,
  U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
  '_': 0, // blank
};

const LETTER_COUNTS = {
  A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1,
  K: 1, L: 4, M: 2, N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6,
  U: 4, V: 2, W: 2, X: 1, Y: 2, Z: 1,
};

export const RACK_SIZE = 7;
const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

// Build an unshuffled 100-tile bag. Each tile is a string: letter A-Z or '_' for blank.
function buildBag() {
  const bag = [];
  for (const [letter, count] of Object.entries(LETTER_COUNTS)) {
    for (let i = 0; i < count; i++) bag.push(letter);
  }
  return bag;
}

// Fisher-Yates shuffle in place.
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Create a fresh shuffled bag.
export function createBag() {
  return shuffle(buildBag());
}

// Draw up to `count` tiles from the end of the bag (mutates bag). Returns drawn tiles.
export function draw(bag, count) {
  const out = [];
  for (let i = 0; i < count && bag.length > 0; i++) {
    out.push(bag.pop());
  }
  return out;
}

// Refill a rack up to RACK_SIZE from the bag.
export function refillRack(rack, bag) {
  const needed = RACK_SIZE - rack.length;
  if (needed <= 0) return rack;
  rack.push(...draw(bag, needed));
  return rack;
}

// Check if a rack is "bad": all vowels or all consonants (blanks count as neither).
export function isBadOpeningRack(rack) {
  const letters = rack.filter(t => t !== '_');
  if (letters.length === 0) return true;
  const allVowels = letters.every(l => VOWELS.has(l));
  const allConsonants = letters.every(l => !VOWELS.has(l));
  return allVowels || allConsonants;
}

// Deal an opening hand. Redraws until the rack is playable per the supplied predicate
// (otherwise falls back to the all-vowels/all-consonants heuristic). Capped so we always
// return something sensible, but in practice a real dictionary-backed check succeeds fast.
export function dealOpeningHand(isPlayable) {
  const MAX_TRIES = 30;
  let bag, rack;
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    bag = createBag();
    rack = draw(bag, RACK_SIZE);
    const ok = !isBadOpeningRack(rack) && (!isPlayable || isPlayable(rack));
    if (ok) return { bag, rack };
  }
  return { bag, rack };
}
