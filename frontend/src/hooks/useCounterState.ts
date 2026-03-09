/**
 * useCounterState.ts — Zustand store that is the single source of truth
 * for UI state. AppState is replaced wholesale on every "state_update"
 * WebSocket message from the backend.
 *
 * flashPokemon sets lastEncounterPokemonId for 400 ms to trigger the card
 * flash animation whenever an encounter is counted.
 */
import { create } from 'zustand'
import { AppState, Pokemon } from '../types'

interface CounterStore {
  appState: AppState | null
  lastEncounterPokemonId: string | null
  isConnected: boolean
  setAppState: (state: AppState) => void
  setConnected: (v: boolean) => void
  flashPokemon: (id: string) => void
  getActivePokemon: () => Pokemon | null
}

export const useCounterStore = create<CounterStore>((set, get) => ({
  appState: null,
  lastEncounterPokemonId: null,
  isConnected: false,

  setAppState: (state) => set({ appState: state }),

  setConnected: (v) => set({ isConnected: v }),

  flashPokemon: (id) => {
    set({ lastEncounterPokemonId: id })
    setTimeout(() => set({ lastEncounterPokemonId: null }), 400)
  },

  getActivePokemon: () => {
    const { appState } = get()
    if (!appState) return null
    return appState.pokemon.find((p) => p.id === appState.active_id) ?? null
  },
}))
