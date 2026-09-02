/**
 * Font loading of the overlay: pulls the stylesheet of a curated Google font
 * into the document once per family.
 */
import { useEffect } from "react";
import { isGoogleFont } from "../../utils/fonts";

/**
 * useGoogleFont injects the stylesheet of a curated Google font.
 *
 * Only the curated families exist on fonts.googleapis.com. Anything else, an
 * engine alias or a family the user picked from their own machine, resolves
 * locally, so requesting it from Google would only produce a failed request for
 * a font that is already there.
 */
export function useGoogleFont(fontFamily: string) {
  useEffect(() => {
    if (!isGoogleFont(fontFamily)) return;
    const id = `gfont-${fontFamily.replaceAll(/\s+/g, "-")}`;
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontFamily)}:wght@100;300;400;700;900&display=swap`;
    document.head.appendChild(link);
  }, [fontFamily]);
}
