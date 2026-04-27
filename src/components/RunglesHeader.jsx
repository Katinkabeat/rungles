import React from 'react'
import AvatarButton from './AvatarButton.jsx'

// Phase 3a: header with avatar + title + 🏠 + ⚙️.
// Settings dropdown content is wired in Phase 3e — for now ⚙️ is a stub.
export default function RunglesHeader({ profile, onAvatarClick, onSettingsClick }) {
  return (
    <header className="bg-white border-b border-rungles-100 shadow-sm sticky top-0 z-10 dark:bg-[#130c25] dark:border-[#2d1b55]">
      <div className="max-w-[480px] mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AvatarButton profile={profile} onClick={onAvatarClick} />
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
            onClick={onSettingsClick}
            className="text-lg leading-none hover:scale-110 transition-transform text-rungles-500 hover:text-rungles-700"
            title="Settings"
            aria-label="Settings"
          >
            ⚙️
          </button>
        </div>
      </div>
    </header>
  )
}
