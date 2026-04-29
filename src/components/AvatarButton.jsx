// Thin wrapper around the shared SQAvatarButton so Rungles' avatar
// matches Wordy and Snibble exactly. The dropdown is rendered separately
// by RunglesHeader.
import React from 'react'
import { SQAvatarButton } from '../../../rae-side-quest/packages/sq-ui/index.js'

export default function AvatarButton({ profile, onClick }) {
  return <SQAvatarButton profile={profile} onClick={onClick} />
}
