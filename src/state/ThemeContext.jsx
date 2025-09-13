import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const ThemeCtx = createContext({ mode: 'system', setMode: () => {} })

const THEME_KEY = 'mood.theme'
const DARK_BG = '#111315'
const LIGHT_BG = '#f3f4f6' // light gray for light mode

function getSystemTheme() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || 'system' } catch { return 'system' }
  })

  // Apply data-theme attribute and meta theme-color
  useEffect(() => {
    const actual = mode === 'system' ? getSystemTheme() : mode
    const root = document.documentElement
    root.setAttribute('data-theme', actual)
    try { localStorage.setItem(THEME_KEY, mode) } catch {}

    // Update theme-color meta for mobile UI bars
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', actual === 'dark' ? DARK_BG : LIGHT_BG)

    // Listen to system changes when in system mode
    if (mode === 'system' && window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      const onChange = () => {
        const cur = mq.matches ? 'dark' : 'light'
        root.setAttribute('data-theme', cur)
        if (meta) meta.setAttribute('content', cur === 'dark' ? DARK_BG : LIGHT_BG)
      }
      mq.addEventListener?.('change', onChange)
      return () => mq.removeEventListener?.('change', onChange)
    }
  }, [mode])

  const value = useMemo(() => ({ mode, setMode }), [mode])
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

export function useTheme() {
  return useContext(ThemeCtx)
}
