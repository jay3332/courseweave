// Applies the saved theme before the app loads, so pages don't flash the wrong colors.
// A separate file (not an inline script) so the Content-Security-Policy can stay script-src 'self'.
try {
  // Storage key predates the rename; kept so saved schedules survive.
  const t = JSON.parse(localStorage.getItem('plaid') || '{}')?.state?.theme
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t
} catch {}
