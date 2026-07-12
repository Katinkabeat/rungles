import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { SQErrorBoundary, installGlobalErrorReporting, installPushHeal } from '../../rae-side-quest/packages/sq-ui/index.js'
import './index.css'

// Report uncaught errors + unhandled rejections + render crashes to #error-log (c266).
installGlobalErrorReporting({
  game: 'rungles',
  reportUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sq-report-client-error`,
  anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
})

// Refresh the shared `sidequest` push address while the user plays (c270, A1).
// No-op unless notification permission is already granted; never prompts.
installPushHeal()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <SQErrorBoundary label="rungles">
      <App />
    </SQErrorBoundary>
  </React.StrictMode>
)

// Register service worker. Path must be relative so it lives under
// `${BASE_URL}sw.js` in both dev and prod (Vite serves public/ at the base).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(err => console.warn('Service worker registration failed:', err))
  })
}
