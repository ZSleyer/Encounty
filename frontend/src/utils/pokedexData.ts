/**
 * pokedexData.ts: one shared load of the species catalog and the game list.
 *
 * Both payloads are static for the lifetime of a session, and the pokedex alone
 * is around 430 KB. Six components want it, and fetching inside the hook meant
 * six requests, six JSON parses and six copies of the same array on the heap.
 * The copies also cost more than memory: six distinct array identities defeat
 * every `useMemo` downstream that keys on the species list, so the Pokédex
 * rebuilt its whole slot model per consumer.
 *
 * One module-level promise each fixes all of it. Every caller awaits the same
 * request and gets the same array back.
 */
import { apiUrl } from "./api";
import type { GameEntry } from "../types";
import type { PokemonData } from "../components/pokemon/pokemonPicker";

let pokedexPromise: Promise<PokemonData[]> | null = null;
let gamesPromise: Promise<GameEntry[]> | null = null;

/**
 * Fetches a JSON array from the backend. Rejects on anything unusable so the
 * caller can decide whether the outcome is worth remembering.
 */
async function fetchArray<T>(path: string): Promise<T[]> {
  const res = await fetch(apiUrl(path));
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  const data: unknown = await res.json();
  // Consumers iterate the list outside the promise chain, so a malformed
  // payload has to be rejected here instead of throwing later.
  if (!Array.isArray(data)) throw new Error(`${path} did not return an array`);
  return data as T[];
}

/**
 * The dex-ordered species catalog with their forms, fetched at most once.
 *
 * A failure is deliberately not remembered: the backend may still be starting
 * up when the first component mounts, and a cached empty dex would then outlive
 * the outage until the window reloads.
 */
export function loadPokedex(): Promise<PokemonData[]> {
  pokedexPromise ??= fetchArray<PokemonData>("/api/pokedex").catch((err: unknown) => {
    pokedexPromise = null;
    throw err;
  });
  return pokedexPromise;
}

/** The game catalog, fetched at most once. Retries after a failure, as above. */
export function loadGames(): Promise<GameEntry[]> {
  gamesPromise ??= fetchArray<GameEntry>("/api/games").catch((err: unknown) => {
    gamesPromise = null;
    throw err;
  });
  return gamesPromise;
}

/**
 * Drops both cached payloads.
 *
 * Test-only. The cache lives in the module and therefore outlives a single
 * `it()`, so a suite that re-stubs `fetch` between cases would otherwise keep
 * seeing the first case's data. `src/test-setup.ts` calls this before every
 * test, which restores the fetch-per-mount behavior the suites were written
 * against.
 */
export function resetPokedexCache(): void {
  pokedexPromise = null;
  gamesPromise = null;
}
