// Blocking startup script: apply only validated display values before the app and its CSS load.
// This cache never supplies an account write; the authenticated preference is loaded separately.
(() => {
  let palette = 'nature', mode = 'system'
  try {
    const value = JSON.parse(localStorage.getItem('dig:appearance:last'))
    if (value && ['nature', 'neutral', 'tokyo-night'].includes(value.palette) && ['system', 'light', 'dark'].includes(value.mode)) {
      palette = value.palette; mode = value.mode
    }
  } catch { /* Use the default if storage is blocked or corrupt. */ }
  document.documentElement.dataset.palette = palette
  document.documentElement.dataset.scheme = mode === 'system' ? matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' : mode
})()
