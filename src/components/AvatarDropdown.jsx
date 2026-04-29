import React from 'react'
import {
  SQAvatarDropdown,
  SQAvatarMenuItem,
} from '../../../rae-side-quest/packages/sq-ui/index.js'

// Floating identity panel anchored under the avatar button. Visual
// chrome lives in sq-ui so all SQ surfaces match. Open state controlled
// by RunglesHeader.
export default function AvatarDropdown({ open, profile, onClose, onOpenStats }) {
  return (
    <SQAvatarDropdown
      open={open}
      onClose={onClose}
      profile={profile}
      align="left"
    >
      <SQAvatarMenuItem onClick={() => { onClose(); onOpenStats() }}>
        📊 Stats
      </SQAvatarMenuItem>
    </SQAvatarDropdown>
  )
}
