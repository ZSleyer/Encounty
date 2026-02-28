import { useState } from 'react'
import { Keyboard } from 'lucide-react'
import { HotkeyMap } from '../types'

interface Props {
  readonly hotkeys: HotkeyMap
  readonly onUpdate: (hk: HotkeyMap) => void
}

const ACTIONS: { key: keyof HotkeyMap; label: string }[] = [
  { key: 'increment', label: '+1 Encounter' },
  { key: 'decrement', label: '-1 Encounter' },
  { key: 'reset', label: 'Reset' },
  { key: 'next_pokemon', label: 'Nächstes Pokémon' },
]

export function HotkeySettings({ hotkeys, onUpdate }: Props) {
  const [listening, setListening] = useState<keyof HotkeyMap | null>(null)
  const [local, setLocal] = useState<HotkeyMap>(hotkeys)

  const startListening = (key: keyof HotkeyMap) => {
    setListening(key)

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      const parts: string[] = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.shiftKey) parts.push('Shift')
      if (e.altKey) parts.push('Alt')

      const mainKey = e.key.length === 1 ? e.key.toUpperCase() : e.key
      if (!['Control', 'Shift', 'Alt', 'Meta'].includes(mainKey)) {
        parts.push(mainKey)
      }

      const combo = parts.join('+')
      if (combo) {
        const updated = { ...local, [key]: combo }
        setLocal(updated)
        onUpdate(updated)
      }

      setListening(null)
      globalThis.removeEventListener('keydown', onKeyDown)
    }

    globalThis.addEventListener('keydown', onKeyDown)
  }

  return (
    <div className="space-y-3">
      {ACTIONS.map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between bg-bg-secondary rounded-lg px-4 py-3">
          <div className="flex items-center gap-3">
            <Keyboard className="w-4 h-4 text-gray-500" />
            <span className="text-sm text-gray-300">{label}</span>
          </div>
          <div className="flex items-center gap-2">
            <kbd className="px-2 py-1 bg-bg-primary border border-border-subtle rounded text-xs text-gray-300 font-mono min-w-[60px] text-center">
              {local[key] || '—'}
            </kbd>
            <button
              onClick={() => startListening(key)}
              className={`px-3 py-1 rounded text-xs transition-colors ${
                listening === key
                  ? 'bg-accent-blue text-white animate-pulse'
                  : 'bg-bg-hover text-gray-400 hover:text-white'
              }`}
            >
              {listening === key ? 'Drücke Taste...' : 'Ändern'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
