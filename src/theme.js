// Light/dark/auto theme handling: resolves the effective theme, persists
// the user's choice, and notifies listeners (charts, map) so they can
// re-render with the new colors.

const STORAGE_KEY = 'amperecloud-solar-theme'
const MODES = ['auto', 'light', 'dark']

function readStoredMode() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return MODES.includes(stored) ? stored : 'auto'
  } catch {
    return 'auto'
  }
}

function writeStoredMode(mode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Storage may be unavailable (private browsing, blocked cookies, …) -
    // the theme just won't persist across reloads.
  }
}

// A `?theme=light|dark` URL param forces a theme without touching the
// stored preference - handy for automated screenshots.
function getUrlThemeOverride() {
  try {
    const value = new URLSearchParams(window.location.search).get('theme')
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
const urlOverride = getUrlThemeOverride()

let currentMode = urlOverride ?? readStoredMode()
const listeners = new Set()

function resolveEffectiveTheme(mode) {
  if (mode === 'light' || mode === 'dark') return mode
  return darkMediaQuery.matches ? 'dark' : 'light'
}

function applyTheme() {
  const effective = resolveEffectiveTheme(currentMode)
  document.documentElement.dataset.theme = effective
  document.documentElement.dataset.themeMode = currentMode
  for (const listener of listeners) listener(effective, currentMode)
}

export function getThemeMode() {
  return currentMode
}

export function getEffectiveTheme() {
  return resolveEffectiveTheme(currentMode)
}

export function setThemeMode(mode) {
  if (!MODES.includes(mode)) return
  currentMode = mode
  if (!urlOverride) writeStoredMode(mode)
  applyTheme()
}

export function onThemeChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

darkMediaQuery.addEventListener('change', () => {
  if (currentMode === 'auto') applyTheme()
})

applyTheme()
