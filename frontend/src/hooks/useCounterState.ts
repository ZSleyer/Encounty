/**
 * useCounterState.ts — Zustand store that is the single source of truth
 * for UI state. AppState is replaced wholesale on every "state_update"
 * WebSocket message from the backend.
 *
 * flashPokemon marks a Pokémon as flashing for 400 ms to trigger the card
 * flash animation whenever an encounter is counted. Flashing ids are tracked in
 * a Set so several cards that count up at the same time (e.g. a whole group)
 * animate together instead of overwriting each other's flash. lastEncounterPokemonId
 * is kept as the single most-recent id for callers that only need that.
 */
import { create } from 'zustand'
import { AppState, Pokemon } from '../types'

export interface DetectorStatusEntry {
  state: string;      // "idle" | "match" | "cooldown"
  confidence: number; // 0.0–1.0
  poll_ms: number;
  cooldown_remaining_ms?: number;
}

interface CounterStore {
  appState: AppState | null
  lastEncounterPokemonId: string | null
  /** Every Pokémon currently flashing; lets a whole group animate at once. */
  flashingIds: Set<string>
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
  flashingIds: new Set<string>(),
  isConnected: false,
  detectorStatus: {},

  setAppState: (state) => set({ appState: state }),

  setConnected: (v) => set({ isConnected: v }),

  flashPokemon: (id) => {
    set((s) => {
      const next = new Set(s.flashingIds)
      next.add(id)
      return { flashingIds: next, lastEncounterPokemonId: id }
    })
    setTimeout(() => set((s) => {
      const next = new Set(s.flashingIds)
      next.delete(id)
      return {
        flashingIds: next,
        lastEncounterPokemonId: s.lastEncounterPokemonId === id ? null : s.lastEncounterPokemonId,
      }
    }), 400)
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
