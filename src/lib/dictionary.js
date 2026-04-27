// Word list loader + validator.
// Loads data/words.txt once; stores both the full word Set and an anagram-key Set
// (sorted letters) for 4-7 letter words, used to answer "can this rack form any word?"

let wordSet = null;
let anagramKeys = null; // Set of sorted-letter strings for words 4-7 chars
let loadPromise = null;

function sortLetters(s) {
  return s.split('').sort().join('');
}

export function loadDictionary() {
  if (wordSet) return Promise.resolve(wordSet);
  if (loadPromise) return loadPromise;
  // Resolves against Vite's `base` (e.g. /rungles/) so this works in dev and prod.
  const wordsUrl = `${import.meta.env.BASE_URL}data/words.txt`
  loadPromise = fetch(wordsUrl)
    .then(r => {
      if (!r.ok) throw new Error(`Word list HTTP ${r.status}`);
      return r.text();
    })
    .then(text => {
      const words = text.split(/\r?\n/).filter(Boolean);
      wordSet = new Set(words);
      anagramKeys = new Set();
      for (const w of words) {
        if (w.length >= 4 && w.length <= 7) anagramKeys.add(sortLetters(w));
      }
      return wordSet;
    });
  return loadPromise;
}

export function isValidWord(word) {
  if (!wordSet) return false;
  return wordSet.has(word.toUpperCase());
}

export function dictionarySize() {
  return wordSet ? wordSet.size : 0;
}

// Generate all subsets of `arr` with sizes in [minLen, maxLen] and yield each as a sorted string.
function* sortedSubsets(arr, minLen, maxLen) {
  const n = arr.length;
  for (let mask = 1; mask < (1 << n); mask++) {
    const subset = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(arr[i]);
    if (subset.length >= minLen && subset.length <= maxLen) {
      yield subset.sort().join('');
    }
  }
}

// Return true if `rackLetters` can form any 4-7 letter word in the dictionary.
// Blanks ('_') are treated as wildcards: if any blank is present, assume playable.
export function canFormAnyWord(rackLetters) {
  if (!anagramKeys) return true; // dict not loaded yet — don't block
  if (rackLetters.includes('_')) return true; // blanks flex enough to make this very likely playable
  for (const key of sortedSubsets(rackLetters, 4, Math.min(7, rackLetters.length))) {
    if (anagramKeys.has(key)) return true;
  }
  return false;
}

function countLetters(arr) {
  const counts = {};
  for (const l of arr) counts[l] = (counts[l] ?? 0) + 1;
  return counts;
}

// Test whether `word` can be formed from the given rack + carried pools (multiset),
// using blanks in the rack as wildcards. Returns the number of letters sourced from
// carried, or null if the word can't be formed.
function howManyCarried(word, rack, carried) {
  const wordCounts = countLetters(word);
  const carriedCounts = countLetters(carried);
  const rackCounts = countLetters(rack);
  let blanks = rackCounts['_'] ?? 0;
  let carriedUsed = 0;
  for (const [letter, need] of Object.entries(wordCounts)) {
    const fromCarried = Math.min(need, carriedCounts[letter] ?? 0);
    const fromRack = need - fromCarried;
    const rackHas = rackCounts[letter] ?? 0;
    if (fromRack > rackHas) {
      const shortfall = fromRack - rackHas;
      if (shortfall > blanks) return null;
      blanks -= shortfall;
    }
    carriedUsed += fromCarried;
  }
  return carriedUsed;
}

// Find a valid word the player could play from their rack + carried letters.
// `minCarried` is how many carried letters the word must include (3 for rung 2+, 0 for rung 1).
// Returns the word string, or null if no valid play exists.
export function findHintWord(rack, carried, minCarried = 0) {
  if (!wordSet) return null;
  for (const word of wordSet) {
    if (word.length < 4 || word.length > 7) continue;
    const carriedUsed = howManyCarried(word, rack, carried);
    if (carriedUsed === null) continue;
    if (carriedUsed < minCarried) continue;
    return word;
  }
  return null;
}
