import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { reloadForUpdate } from './lib/app-update'

// Vite reports a dynamic import (a page, the PDF reader) whose files are from an older build; reload to get the new
// one. If it can't reload (it just did), the import's own error handling takes over.
window.addEventListener('vite:preloadError', () => {
  reloadForUpdate()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
