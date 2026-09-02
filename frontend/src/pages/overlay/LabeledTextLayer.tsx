/**
 * Shared positioned layer of the phasing text elements (phase, total_counter,
 * total_timer): position and idle animation on the outer box, trigger
 * animation on the keyed inner span.
 */
import { LabeledTextElement } from "../../types";
import type { AnimChannel } from "./animChannels";
import { TEXT_IDLE } from "./animMaps";
import { StyledText, TextLabel } from "./StyledText";

/** Props of the shared layer for the phasing text elements. */
interface LabeledTextLayerProps {
  element: LabeledTextElement;
  /** Stable prefix of the keyed value span, e.g. "phase". */
  channelKey: string;
  /** Trigger channel of the element; omitted for idle-only elements. */
  channel?: AnimChannel;
  /** Already formatted value to display. */
  value: string;
}

/**
 * LabeledTextLayer renders one positioned text element with an optional label,
 * following the same structure as the counter and timer layers: the outer box
 * carries position and idle animation, the keyed inner span carries the trigger
 * animation so it replays on every new trigger id.
 *
 * Used only by the phasing elements (phase, total_counter, total_timer); the
 * older layers keep their hand-written markup.
 */
export function LabeledTextLayer({
  element,
  channelKey,
  channel,
  value,
}: Readonly<LabeledTextLayerProps>) {
  const alignMap: Record<string, string> = { center: "center", right: "flex-end" };
  const alignItems = alignMap[element.style.text_align] ?? "flex-start";

  return (
    <div
      style={{
        position: "absolute",
        left: element.x,
        top: element.y,
        width: element.width,
        height: element.height,
        zIndex: element.z_index,
        display: "flex",
        flexDirection: "column",
        alignItems,
        justifyContent: "center",
      }}
      className={TEXT_IDLE[element.idle_animation] ?? ""}
    >
      <StyledText
        key={`${channelKey}-${channel?.triggerId ?? 0}`}
        style={element.style}
        className={`font-black tabular-nums leading-none ${channel?.animClass ?? ""}`}
        outerStyle={{
          display: "inline-block",
          transformOrigin: "center",
          animationDirection: channel?.reverse ? "reverse" : undefined,
          // pre keeps the spacing the user typed around the value: a prefix
          // like "Phase: " ends in a space that HTML would collapse away.
          whiteSpace: "pre",
        }}
      >
        {(element.prefix_text ?? "") + value + (element.suffix_text ?? "")}
      </StyledText>
      {element.show_label && <TextLabel style={element.label_style} text={element.label_text} />}
    </div>
  );
}
