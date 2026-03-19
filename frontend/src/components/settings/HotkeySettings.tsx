import { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { HotkeyMap } from '../../types'
import { useI18n } from '../../contexts/I18nContext'

const API = '/api'

interface HotkeySettingsProps {
  hotkeys: HotkeyMap
  onUpdate: (hk: HotkeyMap) => void
}

const ACTIONS: { key: keyof HotkeyMap; label: string }[] = [
  { key: 'increment', label: '+1 Encounter' },
  { key: 'decrement', label: '-1 Encounter' },
  { key: 'reset', label: 'Reset' },
  { key: 'next_pokemon', label: 'Nächstes Pokémon' },
]

export function HotkeySettings({ hotkeys, onUpdate }: Readonly<HotkeySettingsProps>) {
  const { t } = useI18n()
  const [local, setLocal] = useState<HotkeyMap>(hotkeys)
  const [recording, setRecording] = useState<keyof HotkeyMap | null>(null)
  const [liveModifiers, setLiveModifiers] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [hotkeyAvailable, setHotkeyAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    fetch(`${API}/hotkeys/status`)
      .then((r) => r.json())
      .then((d) => setHotkeyAvailable(d.available))
      .catch(() => setHotkeyAvailable(false))
  }, [])

  const cancelRecording = useCallback(() => {
    fetch(`${API}/hotkeys/resume`, { method: 'POST' }).catch(() => {})
    setRecording(null)
    setLiveModifiers('')
  }, [])

  const commitRecording = useCallback(
    async (action: keyof HotkeyMap, combo: string) => {
      setError(null)
      const res = await fetch(`${API}/hotkeys/${action}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: combo }),
      })
      await fetch(`${API}/hotkeys/resume`, { method: 'POST' }).catch(() => {})
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? 'Unbekannte Taste')
      } else {
        const updated = { ...local, [action]: combo }
        setLocal(updated)
        onUpdate(updated)
      }
      setRecording(null)
      setLiveModifiers('')
    },
    [local, onUpdate],
  )

  const deleteBinding = async (action: keyof HotkeyMap) => {
    setError(null)
    const res = await fetch(`${API}/hotkeys/${action}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: '' }),
    })
    if (res.ok) {
      const updated = { ...local, [action]: '' }
      setLocal(updated)
      onUpdate(updated)
    }
  }

  const startRecording = (action: keyof HotkeyMap) => {
    setRecording(action)
    setLiveModifiers('')
    setError(null)
    fetch(`${API}/hotkeys/pause`, { method: 'POST' }).catch(() => {})
  }

  useEffect(() => {
    if (recording === null) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        cancelRecording()
        return
      }

      const modKeys = ['Control', 'Shift', 'Alt', 'Meta']
      if (modKeys.includes(e.key)) {
        const parts: string[] = []
        if (e.ctrlKey) parts.push('Ctrl')
        if (e.shiftKey) parts.push('Shift')
        if (e.altKey) parts.push('Alt')
        setLiveModifiers(parts.join('+'))
        return
      }

      const parts: string[] = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.shiftKey) parts.push('Shift')
      if (e.altKey) parts.push('Alt')

      const mainKey = e.key.length === 1 ? e.key.toUpperCase() : e.key
      parts.push(mainKey)

      commitRecording(recording, parts.join('+'))
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      const parts: string[] = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.shiftKey) parts.push('Shift')
      if (e.altKey) parts.push('Alt')
      setLiveModifiers(parts.join('+'))
    }

    globalThis.addEventListener('keydown', handleKeyDown)
    globalThis.addEventListener('keyup', handleKeyUp)
    return () => {
      globalThis.removeEventListener('keydown', handleKeyDown)
      globalThis.removeEventListener('keyup', handleKeyUp)
    }
  }, [recording, cancelRecording, commitRecording])

  return (
    <div className="space-y-3">
      {hotkeyAvailable === false ? (
        <div className="mb-4 p-3 bg-amber-900/20 border border-amber-700/40 rounded-lg">
          <p className="text-xs text-amber-400">Globale Hotkeys nicht verfügbar</p>
          <p className="text-xs text-text-muted mt-1">
            Linux:{' '}
            <code className="text-text-secondary">sudo usermod -aG input $USER</code>{' '}
            dann neu einloggen
          </p>
        </div>
      ) : null}

      {ACTIONS.map(({ key, label }) => {
        const isRecording = recording === key
        const currentCombo = local[key]
        const conflictAction = currentCombo
          ? ACTIONS.find(({ key: k }) => k !== key && local[k] === currentCombo)
          : undefined

        return (
          <div key={key} className="space-y-1">
            <div
              className={`flex items-center justify-between bg-bg-secondary rounded-lg px-4 py-3 border transition-colors ${
                isRecording ? 'border-accent-blue/50' : 'border-transparent'
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isRecording
                      ? 'bg-accent-blue animate-pulse'
                      : (currentCombo ? 'bg-accent-green' : 'bg-border-subtle')
                  }`}
                />
                <span className="text-sm 2xl:text-base text-text-secondary">{label}</span>
              </div>

              <div className="flex items-center gap-2">
                <kbd
                  className={`px-2 py-1 border rounded text-xs 2xl:text-sm font-mono min-w-18 2xl:min-w-21 text-center ${
                    isRecording
                      ? 'bg-accent-blue/10 border-accent-blue/30 text-accent-blue'
                      : 'bg-bg-primary border-border-subtle text-text-secondary'
                  }`}
                >
                  {(() => {
                    if (isRecording) return liveModifiers ? `${liveModifiers}+…` : '…';
                    return currentCombo || '—';
                  })()}
                </kbd>

                <button
                  onClick={() =>
                    isRecording ? cancelRecording() : startRecording(key)
                  }
                  title={isRecording ? t("tooltip.common.cancel") : t("hotkeys.tooltipRecord")}
                  className={`px-3 py-1 2xl:px-4 2xl:py-1.5 rounded text-xs 2xl:text-sm transition-colors ${
                    isRecording
                      ? 'bg-accent-blue/20 text-accent-blue border border-accent-blue/30'
                      : 'bg-bg-hover text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {isRecording ? 'Abbrechen' : 'Aufzeichnen'}
                </button>

                {currentCombo && !isRecording ? (
                  <button
                    onClick={() => deleteBinding(key)}
                    className="p-1 rounded text-text-faint hover:text-red-400 transition-colors"
                    title={t("hotkeys.tooltipDelete")}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : null}
              </div>
            </div>

            {conflictAction && (
              <p className="text-xs 2xl:text-sm text-amber-400 ml-4">
                ⚠ Gleiche Taste wie „{conflictAction.label}"
              </p>
            )}
          </div>
        )
      })}

      {recording && (
        <div className="mt-4 p-3 bg-accent-blue/10 border border-accent-blue/20 rounded-lg">
          <p className="text-sm 2xl:text-base text-accent-blue">
            ● Drücke eine Taste für „
            {ACTIONS.find((a) => a.key === recording)?.label}"
            {liveModifiers && (
              <span className="ml-2 font-mono text-text-primary">
                {liveModifiers}+…
              </span>
            )}
          </p>
          <p className="text-xs 2xl:text-sm text-text-secondary mt-1">ESC zum Abbrechen</p>
        </div>
      )}

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
    </div>
  )
}
