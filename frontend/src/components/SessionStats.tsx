import { useEffect, useState } from 'react'
import { Clock, Zap } from 'lucide-react'
import { AppState } from '../types'

interface Props {
  readonly appState: AppState
  readonly sessionStart: Date
}

export function SessionStats({ appState, sessionStart }: Props) {
  const [elapsed, setElapsed] = useState('')

  useEffect(() => {
    const update = () => {
      if (document.hidden) return
      const diff = Date.now() - sessionStart.getTime()
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setElapsed(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [sessionStart])

  const totalEncounters = appState.pokemon.reduce((sum, p) => sum + p.encounters, 0)

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2 bg-bg-secondary border border-border-subtle rounded-lg px-3 py-1.5">
        <Clock className="w-4 h-4 text-text-muted" />
        <span className="text-sm text-text-secondary tabular-nums">{elapsed}</span>
      </div>
      <div className="flex items-center gap-2 bg-bg-secondary border border-border-subtle rounded-lg px-3 py-1.5">
        <Zap className="w-4 h-4 text-accent-yellow" />
        <span className="text-sm text-text-secondary tabular-nums">{totalEncounters}</span>
        <span className="text-xs text-text-faint">gesamt</span>
      </div>
    </div>
  )
}
