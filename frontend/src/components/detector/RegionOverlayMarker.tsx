/**
 * RegionOverlayMarker.tsx -- One detection region drawn over the snapshot.
 */
import { Image as ImageIcon, Type } from "lucide-react";
import { MatchedRegion } from "../../types";
import { formatPercent } from "../../utils/format";

/** Renders a single region overlay marker on the snapshot preview. */
export function RegionOverlayMarker({
  region,
  index,
  snapshotWidth,
  snapshotHeight,
  scoreBadge,
  chipColor,
}: Readonly<{
  region: MatchedRegion;
  index: number;
  snapshotWidth: number;
  snapshotHeight: number;
  scoreBadge?: number;
  /** Category chip color, or null when the region has no category. */
  chipColor?: string | null;
}>) {
  const isText = region.type === "text";
  const accent = isText ? "#3fd4e0" : "var(--accent-blue)";
  const borderStyle = isText
    ? "border-[#3fd4e0] bg-[#3fd4e0]/10"
    : "border-accent-blue bg-accent-blue/10";
  const regionIcon = isText ? (
    <Type className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
  ) : (
    <ImageIcon className="w-3 h-3 2xl:w-3.5 2xl:h-3.5" />
  );

  return (
    <div
      className={`absolute border-2 border-dashed rounded-none pointer-events-none transition-colors ${borderStyle}`}
      style={{
        left: `${(region.rect.x / snapshotWidth) * 100}%`,
        top: `${(region.rect.y / snapshotHeight) * 100}%`,
        width: `${(region.rect.w / snapshotWidth) * 100}%`,
        height: `${(region.rect.h / snapshotHeight) * 100}%`,
      }}
    >
      {/* Identity tag: solid accent fill (design system's .t-region .tag),
          dark text for contrast. Carries index, type, category, expected
          text — richer than the mockup's static label, same visual idiom. */}
      <div
        className="absolute -top-6 left-0 flex items-center gap-1 px-1.5 py-0.5 2xl:px-2 2xl:py-1 rounded-none font-bold font-mono text-xs 2xl:text-sm whitespace-nowrap text-bg-primary"
        style={{ backgroundColor: accent }}
      >
        <strong>#{index + 1}</strong>
        {chipColor && (
          <span
            aria-hidden="true"
            className="w-2 h-2 rounded-full shrink-0 ring-1 ring-bg-primary/40"
            style={{ backgroundColor: chipColor }}
          />
        )}
        {regionIcon}
        {isText && region.expected_text ? (
          <span className="opacity-80 ml-1 truncate max-w-15">"{region.expected_text}"</span>
        ) : null}
      </div>
      {/* Live match score: separate status readout, own semantic color, so
          it isn't washed out against the identity tag's solid accent fill. */}
      {scoreBadge !== undefined &&
        (() => {
          let scoreColor: string;
          if (scoreBadge >= 0.8) scoreColor = "text-accent-green border-accent-green/40";
          else if (scoreBadge >= 0.5) scoreColor = "text-accent-yellow border-accent-yellow/40";
          else scoreColor = "text-accent-red border-accent-red/40";
          return (
            <div
              className={`absolute -top-6 right-0 bg-bg-primary/90 border px-1.5 py-0.5 2xl:px-2 2xl:py-1 rounded-none font-bold font-mono text-xs 2xl:text-sm whitespace-nowrap ${scoreColor}`}
            >
              {formatPercent(scoreBadge, 0)}%
            </div>
          );
        })()}
    </div>
  );
}
