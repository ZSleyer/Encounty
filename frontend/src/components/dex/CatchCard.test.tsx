/**
 * CatchCard.test.tsx: the per-catch name display, resolved fresh from the
 * pokedex catalog rather than reused from whatever the catch itself recorded.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, makePokemon } from "../../test-utils";
import { CatchCard } from "./CatchCard";
import type { GameEntry, Pokemon } from "../../types";

const GAMES: GameEntry[] = [];

/** The pokedex catalog CatchCard resolves species/form names against. */
const CATALOG = [
  {
    id: 118,
    canonical: "goldeen",
    names: { de: "Goldini", en: "Goldeen", ko: "골디언" },
  },
];

function stubCatalogFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const data = String(input).includes("/api/pokedex") ? CATALOG : [];
      return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
    }),
  );
}

function renderCard(nameLanguage: string, entryLanguage: string, gender?: Pokemon["gender"]) {
  return render(
    <CatchCard
      entry={makePokemon({ canonical_name: "goldeen", language: entryLanguage, gender })}
      canonical="goldeen"
      snapshot={[]}
      games={GAMES}
      languages={["de", "en"]}
      nameLanguage={nameLanguage}
      onOpenInDashboard={vi.fn()}
    />,
  );
}

describe("CatchCard name display", () => {
  it("shows the species name in the Pokédex's own chosen language", async () => {
    stubCatalogFetch();
    renderCard("de", "de");

    await waitFor(() => expect(screen.getByText("Goldini")).toBeInTheDocument());
  });

  it("adds the catch's own hunt language alongside when it reads differently", async () => {
    stubCatalogFetch();
    renderCard("de", "ko");

    await waitFor(() => expect(screen.getByText("Goldini")).toBeInTheDocument());
    expect(screen.getByText("(골디언)")).toBeInTheDocument();
  });

  it("does not repeat the name when the catch's own language matches the Pokédex", async () => {
    stubCatalogFetch();
    renderCard("de", "de");

    await waitFor(() => expect(screen.getByText("Goldini")).toBeInTheDocument());
    expect(screen.queryByText(/^\(.*\)$/)).not.toBeInTheDocument();
  });

  it("still shows the hunt-language flag when the name reads the same", async () => {
    stubCatalogFetch();
    const { container } = renderCard("de", "de");

    await waitFor(() => expect(screen.getByText("Goldini")).toBeInTheDocument());
    expect(container.querySelectorAll("svg")).toHaveLength(1);
  });

  it("shows no flag at all when the catch never recorded a language", async () => {
    stubCatalogFetch();
    const { container } = renderCard("de", "");

    await waitFor(() => expect(screen.getByText("Goldini")).toBeInTheDocument());
    expect(container.querySelectorAll("svg")).toHaveLength(0);
  });

  it("labels a genderless catch as genderless", async () => {
    stubCatalogFetch();
    const { container } = renderCard("de", "de", "genderless");

    await waitFor(() =>
      expect(container.querySelector(".font-semibold")).toHaveTextContent("Geschlechtslos"),
    );
    expect(container.querySelector(".font-semibold")).not.toHaveTextContent("Weiblich");
  });
});
