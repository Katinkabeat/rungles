import React, { useEffect, useRef } from 'react'

// Ported from index.legacy.html .rules-modal. Read by SettingsDropdown.
export default function RulesModal({ open, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (open && !dlg.open) dlg.showModal()
    if (!open && dlg.open) dlg.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose() }}
      className="dropdown-surface rounded-2xl p-0 max-w-[520px] w-[92vw] backdrop:bg-black/40"
    >
      <div className="p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-display text-xl text-rungles-700">How to Play Rungles</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-rungles-500 hover:text-rungles-700 text-xl leading-none"
          >
            ✕
          </button>
        </div>

        <Section title="The goal">
          <p>Build a ladder of connected words. Each word is a "rung." Solo is 7 rungs; multiplayer is 10 (5 each).</p>
        </Section>

        <Section title="Each rung">
          <ul>
            <li>You have a rack of 7 letter tiles drawn from a Scrabble-style bag.</li>
            <li>Your word must be <strong>4 to 7 letters</strong> and in the dictionary.</li>
            <li>Every rung after the first must use at least <strong>3 letters</strong> carried from the previous word. Carried letters are shown in gray and are free — they don't consume your rack tiles.</li>
            <li><strong>Solo rung 1:</strong> no carryover, pick any valid word from your rack.</li>
            <li><strong>Multiplayer rung 1:</strong> the game gives you a seed word, and rung 1 must carry 3+ letters from it just like every other rung.</li>
            <li>Your rack refills back to 7 tiles after every rung.</li>
          </ul>
        </Section>

        <Section title="Scoring">
          <ul>
            <li>Only <strong>rack letters score</strong>. Carried letters are free, but earn no points.</li>
            <li><strong>Length bonus:</strong> +2 points per letter beyond 4.</li>
            <li><strong>2× slot:</strong> each rung has one premium position (gold). If a rack letter lands there, its value is doubled. Carried letters don't trigger it.</li>
          </ul>
        </Section>

        <Section title="Example">
          <p>Rung 1: <strong>STORE</strong> → Rung 2: <strong>TORCH</strong> (T, O, R carried from STORE; C and H from rack).</p>
        </Section>

        <Section title="Tiles">
          <ul>
            <li><strong>Blanks (solo only):</strong> wildcards worth 0 points. Each time you drop a blank into a slot, you pick the letter it plays as for that placement. Move it back to the rack and place it again to pick a different letter. Multiplayer bags don't include blanks.</li>
            <li>The solo opening rack is always playable (at least one valid word exists).</li>
          </ul>
        </Section>

        <Section title="Placing tiles">
          <ul>
            <li>The word area has <strong>7 fixed slots</strong> — one per letter of your word.</li>
            <li><strong>Tap a tile</strong> in your rack or carried row to pick it up.</li>
            <li><strong>Tap any slot</strong> in the word area to drop the tile in.</li>
            <li>If the slot is already filled, the new tile takes its place and the old one goes back to its source.</li>
            <li><strong>Tap a filled slot with nothing selected</strong> to send that tile back to its source.</li>
            <li><strong>Tap two rack tiles in sequence</strong> to rearrange your rack.</li>
            <li><strong>Tap the same tile twice</strong> to deselect.</li>
            <li>You can't submit a word with an empty slot in the middle — fill every slot up to your word's length first.</li>
          </ul>
        </Section>

        <Section title="Buttons">
          <ul>
            <li><strong>Submit:</strong> play your word.</li>
            <li><strong>Clear:</strong> empty the word area.</li>
            <li><strong>Shuffle:</strong> reorder the rack randomly.</li>
            <li><strong>💡 Hint (−5 pts, solo only):</strong> in the settings menu — reveal one word you could play. Score can go negative.</li>
            <li><strong>Skip (multi only):</strong> pass your turn if you can't find a word.</li>
            <li><strong>Give Up:</strong> end the game. Tap twice to confirm.</li>
          </ul>
        </Section>

        <Section title="Keyboard (solo)">
          <p>Type a letter to pick it (carried first, then rack). <kbd>Backspace</kbd> removes the last tile. <kbd>Enter</kbd> submits. <kbd>Escape</kbd> deselects, or clears the word area if nothing is selected.</p>
        </Section>

        <Section title="Multiplayer">
          <ul>
            <li>Two players share one ladder. Each has a private rack; the tile bag is shared.</li>
            <li>The game starts with a randomly chosen <strong>seed word</strong>. Rung 1 carries 3+ letters from it.</li>
            <li>Players take turns adding rungs: 10 total, 5 each.</li>
            <li>Only your own rung scores count toward your total.</li>
            <li>Use <strong>Skip</strong> if you can't form a valid word; play continues without you.</li>
            <li>The ladder shows the most recent rung; tap it to see the full history including the seed.</li>
          </ul>
        </Section>

        <button type="button" className="btn-primary w-full mt-2" onClick={onClose}>
          Got it
        </button>
      </div>
    </dialog>
  )
}

function Section({ title, children }) {
  return (
    <div className="mb-3">
      <h3 className="font-display text-base text-rungles-700 mb-1">{title}</h3>
      <div className="text-sm text-rungles-700 dark:text-rungles-200 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_li]:leading-snug [&_p]:leading-snug [&_kbd]:px-1 [&_kbd]:py-0.5 [&_kbd]:rounded [&_kbd]:bg-rungles-100 dark:[&_kbd]:bg-rungles-900 [&_kbd]:text-xs">
        {children}
      </div>
    </div>
  )
}
