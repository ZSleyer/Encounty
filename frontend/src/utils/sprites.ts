export type SpriteType = "normal" | "shiny";

const BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

export function getSpriteUrl(
  pokemonId: number | string,
  gameKey: string,
  spriteType: SpriteType = "shiny",
): string {
  const shiny = spriteType === "shiny";
  const shinyPart = shiny ? "shiny/" : "";

  // For form variants (numeric IDs > 10000), always use the home sprite path
  const numId = typeof pokemonId === "number" ? pokemonId : parseInt(String(pokemonId), 10);
  if (!isNaN(numId) && numId > 10000) {
    return shiny
      ? `${BASE}/shiny/${numId}.png`
      : `${BASE}/${numId}.png`;
  }

  if (
    gameKey.startsWith("pokemon-red") ||
    gameKey.startsWith("pokemon-blue") ||
    gameKey.startsWith("pokemon-yellow")
  ) {
    return `${BASE}/versions/generation-i/red-blue/transparent/${shinyPart}${pokemonId}.png`;
  }
  if (
    gameKey.startsWith("pokemon-gold") ||
    gameKey.startsWith("pokemon-silver") ||
    gameKey.startsWith("pokemon-crystal")
  ) {
    return `${BASE}/versions/generation-ii/crystal/transparent/${shinyPart}${pokemonId}.png`;
  }
  if (
    gameKey.startsWith("pokemon-ruby") ||
    gameKey.startsWith("pokemon-sapphire") ||
    gameKey.startsWith("pokemon-emerald") ||
    gameKey.startsWith("pokemon-firered") ||
    gameKey.startsWith("pokemon-leafgreen")
  ) {
    return `${BASE}/versions/generation-iii/emerald/${shinyPart}${pokemonId}.png`;
  }
  if (
    gameKey.startsWith("pokemon-diamond") ||
    gameKey.startsWith("pokemon-pearl") ||
    gameKey.startsWith("pokemon-platinum") ||
    gameKey.startsWith("pokemon-heartgold") ||
    gameKey.startsWith("pokemon-soulsilver")
  ) {
    return `${BASE}/versions/generation-iv/platinum/${shinyPart}${pokemonId}.png`;
  }
  if (
    gameKey.startsWith("pokemon-black") ||
    gameKey.startsWith("pokemon-white")
  ) {
    return `${BASE}/versions/generation-v/black-white/animated/${shinyPart}${pokemonId}.gif`;
  }

  // Gen 6+ and unknown: home sprites
  return shiny
    ? `${BASE}/other/home/shiny/${pokemonId}.png`
    : `${BASE}/other/home/${pokemonId}.png`;
}
