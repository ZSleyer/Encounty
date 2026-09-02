/**
 * IconSlot.tsx: Fixed-width icon cell used by the catch metadata dropdowns so
 * entries with and without an icon share one label indent.
 */
import { CatchIcon } from "../../utils/catchIcons";

/**
 * Fixed-size icon cell. Keeps its width while the entry has no icon, otherwise
 * the labels of a catalog would sit at two different indents.
 */
export function IconSlot({ src }: { readonly src: string }) {
  return (
    <span className="w-5 h-5 shrink-0 flex items-center justify-center">
      <CatchIcon src={src} className="max-w-full max-h-full object-contain" />
    </span>
  );
}
