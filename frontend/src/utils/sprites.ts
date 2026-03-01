export type SpriteType = "normal" | "shiny";

const BASE =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";

export function getSpriteUrl(
  pokemonId: number | string,
  gameKey: string,
  spriteType: SpriteType = "shiny",
): string {
  const shiny = spriteType === "shiny";
  const shinyPart = shiny ? "shiny/" : "";
  gameKey = gameKey || "";

  // For form variants (numeric IDs > 10000), always use the default pokemon sprite path
  const numId =
    typeof pokemonId === "number" ? pokemonId : parseInt(String(pokemonId), 10);
  if (!isNaN(numId) && numId > 10000) {
    return shiny ? `${BASE}/shiny/${numId}.png` : `${BASE}/${numId}.png`;
  }

  // Gen 1
  if (gameKey.includes("red") && !gameKey.includes("firered")) {
    return `${BASE}/versions/generation-i/red-blue/transparent/${pokemonId}.png`;
  }
  if (gameKey.includes("blue")) {
    return `${BASE}/versions/generation-i/red-blue/transparent/${pokemonId}.png`;
  }
  if (gameKey.includes("yellow")) {
    return `${BASE}/versions/generation-i/yellow/transparent/${pokemonId}.png`;
  }

  // Gen 2
  if (gameKey.includes("crystal")) {
    return `${BASE}/versions/generation-ii/crystal/transparent/${shinyPart}${pokemonId}.png`;
  }
  if (gameKey.includes("gold") && !gameKey.includes("heartgold")) {
    return `${BASE}/versions/generation-ii/gold/transparent/${shinyPart}${pokemonId}.png`;
  }
  if (gameKey.includes("silver") && !gameKey.includes("soulsilver")) {
    return `${BASE}/versions/generation-ii/silver/transparent/${shinyPart}${pokemonId}.png`;
  }

  // Gen 3
  if (gameKey.includes("emerald")) {
    return `${BASE}/versions/generation-iii/emerald/${shinyPart}${pokemonId}.png`;
  }
  if (gameKey.includes("firered") || gameKey.includes("leafgreen")) {
    return `${BASE}/versions/generation-iii/firered-leafgreen/${shinyPart}${pokemonId}.png`;
  }
  if (gameKey.includes("ruby") && !gameKey.includes("omegaruby")) {
    return `${BASE}/versions/generation-iii/ruby-sapphire/${shinyPart}${pokemonId}.png`;
  }
  if (gameKey.includes("sapphire") && !gameKey.includes("alphasapphire")) {
    return `${BASE}/versions/generation-iii/ruby-sapphire/${shinyPart}${pokemonId}.png`;
  }

  // Gen 4
  if (gameKey.includes("diamond") || gameKey.includes("pearl")) {
    if (gameKey.includes("brilliant") || gameKey.includes("shining")) {
      // BDSP (Gen 8)
      return shiny
        ? `${BASE}/other/home/shiny/${pokemonId}.png`
        : `${BASE}/versions/generation-viii/brilliant-diamond-shining-pearl/${pokemonId}.png`;
    }
    return `${BASE}/versions/generation-iv/diamond-pearl/${shinyPart}${pokemonId}.png`;
  }
  if (gameKey.includes("platinum")) {
    return `${BASE}/versions/generation-iv/platinum/${shinyPart}${pokemonId}.png`;
  }
  if (gameKey.includes("heartgold") || gameKey.includes("soulsilver")) {
    return `${BASE}/versions/generation-iv/heartgold-soulsilver/${shinyPart}${pokemonId}.png`;
  }

  // Gen 5
  if (gameKey.includes("black") || gameKey.includes("white")) {
    return `${BASE}/versions/generation-v/black-white/animated/${shinyPart}${pokemonId}.gif`;
  }

  // Gen 6
  if (
    gameKey === "pokemon-x" ||
    gameKey === "pokemon-y" ||
    gameKey === "x" ||
    gameKey === "y"
  ) {
    return `${BASE}/versions/generation-vi/x-y/${shinyPart}${pokemonId}.png`;
  }
  if (gameKey.includes("omegaruby") || gameKey.includes("alphasapphire")) {
    return `${BASE}/versions/generation-vi/omegaruby-alphasapphire/${shinyPart}${pokemonId}.png`;
  }

  // Gen 7
  if (
    gameKey.includes("ultra-sun") ||
    gameKey.includes("ultra-moon") ||
    gameKey === "sun" ||
    gameKey === "moon" ||
    gameKey.includes("pokemon-sun") ||
    gameKey.includes("pokemon-moon")
  ) {
    return `${BASE}/versions/generation-vii/ultra-sun-ultra-moon/${shinyPart}${pokemonId}.png`;
  }

  // Gen 8 + 9
  if (gameKey.includes("scarlet") || gameKey.includes("violet")) {
    return shiny
      ? `${BASE}/other/home/shiny/${pokemonId}.png`
      : `${BASE}/versions/generation-ix/scarlet-violet/${pokemonId}.png`;
  }

  // Gen 6+ default and unknown: home sprites
  return shiny
    ? `${BASE}/other/home/shiny/${pokemonId}.png`
    : `${BASE}/other/home/${pokemonId}.png`;
}
