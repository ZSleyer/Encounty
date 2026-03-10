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

export interface DetectorStatusEntry {
  state: string;      // "idle" | "match_active" | "cooldown"
  confidence: number; // 0.0–1.0
  poll_ms: number;
}

interface CounterStore {
  appState: AppState | null
  lastEncounterPokemonId: string | null
  isConnected: boolean
  detectorStatus: Record<string, DetectorStatusEntry>;
  setAppState: (state: AppState) => void
  setConnected: (v: boolean) => void
  flashPokemon: (id: string) => void
  getActivePokemon: () => Pokemon | null
  setDetectorStatus: (pokemonId: string, entry: DetectorStatusEntry) => void;
  clearDetectorStatus: (pokemonId: string) => void;
}

export const useCounterStore = create<CounterStore>((set, get) => ({
  appState: null,
  lastEncounterPokemonId: null,
  isConnected: false,
  detectorStatus: {},

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

  setDetectorStatus: (pokemonId, entry) =>
    set((s) => ({ detectorStatus: { ...s.detectorStatus, [pokemonId]: entry } })),
  clearDetectorStatus: (pokemonId) =>
    set((s) => {
      const next = { ...s.detectorStatus };
      delete next[pokemonId];
      return { detectorStatus: next };
    }),
}))
