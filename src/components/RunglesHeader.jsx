import React, { useState } from 'react'
import AvatarButton from './AvatarButton.jsx'
import AvatarDropdown from './AvatarDropdown.jsx'
import SettingsDropdown from './SettingsDropdown.jsx'

// Header with avatar + title + 🏠 + ⚙️.
// Dropdowns are mutually exclusive — opening one closes the other.
// Stats modal is owned here; the avatar dropdown's "Stats" item triggers `onOpenStats`.
export default function RunglesHeader({ profile, onOpenStats }) {
  const [open, setOpen] = useState(null) // 'avatar' | 'settings' | null

  return (
    <header className="bg-white border-b border-rungles-100 shadow-sm sticky top-0 z-10 dark:bg-[#130c25] dark:border-[#2d1b55]">
      <div className="max-w-[480px] mx-auto px-4 py-3 flex items-center justify-between relative">
        <div className="flex items-center gap-2">
          <AvatarButton
            profile={profile}
            onClick={() => setOpen(o => (o === 'avatar' ? null : 'avatar'))}
          />
          <span className="font-display text-2xl text-rungles-700 dark:text-rungles-200">
            Rungles
          </span>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/games/"
            className="text-2xl leading-none hover:scale-110 transition-transform"
            title="Rae's Side Quest"
            aria-label="Rae's Side Quest"
          >
            🏠
          </a>
          <button
            type="button"
            onClick={() => setOpen(o => (o === 'settings' ? null : 'settings'))}
            className="text-lg leading-none hover:scale-110 transition-transform text-rungles-500 hover:text-rungles-700"
            title="Settings"
            aria-label="Settings"
            aria-expanded={open === 'settings'}
          >
            ⚙️
          </button>
        </div>

        <AvatarDropdown
          open={open === 'avatar'}
          profile={profile}
          onClose={() => setOpen(null)}
          onOpenStats={onOpenStats}
        />
        <SettingsDropdown
          open={open === 'settings'}
          onClose={() => setOpen(null)}
        />
      </div>
    </header>
  )
}
