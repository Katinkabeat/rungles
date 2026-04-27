import React, { useEffect, useState } from 'react'
import { dealOpeningHand, LETTER_VALUES } from './lib/tiles.js'
import { loadDictionary, isValidWord, dictionarySize } from './lib/dictionary.js'
import { scoreRung } from './lib/scoring.js'
import { supabase } from './lib/supabase.js'

export default function App() {
  const [status, setStatus] = useState('Loading dictionary…')
  const [checks, setChecks] = useState([])

  useEffect(() => {
    let alive = true
    loadDictionary().then(() => {
      if (!alive) return
      const { rack } = dealOpeningHand(() => true)
      const sampleWord = 'CRANE'
      const sampleScore = scoreRung(
        sampleWord.split('').map((letter) => ({ source: 'rack', letter })),
        null
      )
      setChecks([
        { label: 'Dictionary loaded', value: `${dictionarySize().toLocaleString()} words` },
        { label: 'Sample rack', value: rack.join(' ') },
        { label: '"CRANE" valid?', value: String(isValidWord(sampleWord)) },
        { label: '"CRANE" score', value: sampleScore },
        { label: 'Letter A value', value: LETTER_VALUES.A },
        { label: 'Supabase client', value: supabase ? 'created' : 'missing' },
      ])
      setStatus('Phase 2 logic loaded ✓')
    }).catch((err) => {
      setStatus(`Dictionary load failed: ${err.message}`)
    })
    return () => { alive = false }
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-rungles-50 text-rungles-900 font-body p-6">
      <div className="max-w-[480px] w-full text-center">
        <h1 className="font-display text-4xl mb-3">Rungles 🪜</h1>
        <p className="text-rungles-700 mb-1">React port — under construction</p>
        <p className="text-sm text-rungles-600 mb-6">{status}</p>
        {checks.length > 0 && (
          <ul className="text-left text-sm bg-white rounded-lg p-4 shadow-tile space-y-1">
            {checks.map((c) => (
              <li key={c.label}>
                <span className="font-semibold text-rungles-700">{c.label}:</span>{' '}
                <span className="text-rungles-900">{String(c.value)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
