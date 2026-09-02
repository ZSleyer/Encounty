/**
 * Text primitives of the overlay: the layered stroke-and-fill renderer every
 * text element is built from, plus the label and counter pieces that reuse it.
 */
import { TextStyle } from "../../types";
import {
  buildBaseTextStyle,
  buildFillPaint,
  buildOutlinePaint,
  effectiveOutlineWidth,
  outlinePadding,
} from "../../utils/textStyle";

/** Props of the layered text renderer. */
interface StyledTextProps {
  /** Style model the layers are derived from. */
  style: TextStyle;
  /** Classes of the outer element, carrying the trigger animation. */
  className?: string;
  /** Extra CSS for the outer element (display, animation, white-space). */
  outerStyle?: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * StyledText renders one text element, stroke and fill as two stacked layers.
 *
 * A single span cannot carry both: `background-clip: text` paints the gradient
 * below the glyph, and the fill has to be transparent for the gradient to show,
 * so an opaque stroke on the same span covers the gradient completely. The
 * stroke therefore gets its own layer underneath, and the fill is painted on top
 * of it at the same origin.
 *
 * Without an outline the element stays a single span, so the common case keeps
 * exactly the DOM and CSS it had before.
 */
export function StyledText({ style, className, outerStyle, children }: Readonly<StyledTextProps>) {
  const base = buildBaseTextStyle(style);
  const fill = buildFillPaint(style);
  const width = effectiveOutlineWidth(style);

  if (width === 0) {
    return (
      <span className={className} style={{ ...base, ...fill, ...outerStyle }}>
        {children}
      </span>
    );
  }

  // Padding reserves the room the stroke needs outside the glyph box, the
  // matching negative margin takes it back out of the layout so the glyph does
  // not shift. Ancestors that clip therefore cut at the ink, not into it.
  const pad = outlinePadding(style);

  return (
    <span
      className={className}
      style={{
        display: "inline-block",
        ...outerStyle,
        position: "relative",
        padding: pad,
        margin: -pad,
      }}
    >
      <span
        className="overlay-text-stroke"
        style={{ ...base, ...buildOutlinePaint(style, width), display: "block" }}
      >
        {children}
      </span>
      {/* The same text twice would be announced twice, so the stroke layer is
          the only one left in the accessibility tree. */}
      <span
        aria-hidden="true"
        className="overlay-text-fill"
        style={{
          ...base,
          ...fill,
          // The shadow belongs to the widest silhouette, which is the stroke
          // layer. Repeating it here would darken it a second time.
          textShadow: undefined,
          position: "absolute",
          left: pad,
          top: pad,
          right: pad,
        }}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * TextLabel renders the optional label of a text element. Overlays saved before
 * an element had a label style carry none, and those labels keep rendering
 * unstyled instead of crashing on a missing style.
 */
export function TextLabel({ style, text }: Readonly<{ style?: TextStyle; text: string }>) {
  if (!style) return <span>{text}</span>;
  return <StyledText style={style}>{text}</StyledText>;
}

/**
 * CounterAffix renders the counter prefix or suffix in the counter's own text
 * style, so the digit-animation modes keep the affixes that the plain counter
 * span renders inline. An empty string renders nothing.
 */
export function CounterAffix({
  text,
  counterStyle,
}: Readonly<{ text: string; counterStyle: TextStyle }>) {
  if (!text) return null;
  return (
    <StyledText
      style={counterStyle}
      className="font-black leading-none"
      // pre keeps the spacing the user typed: a prefix like "Encounters: " ends
      // in a space that HTML would otherwise collapse away against the digits.
      outerStyle={{ display: "inline-block", whiteSpace: "pre" }}
    >
      {text}
    </StyledText>
  );
}

/** SlotCounter: only digits that change re-mount and animate. */
export function SlotCounter({
  value,
  counterStyle,
  reverse,
  strokePadding = 0,
}: Readonly<{
  value: number;
  counterStyle: TextStyle;
  reverse?: boolean;
  strokePadding?: number;
}>) {
  const digits = String(value).split("");
  const anim = reverse ? "overlay-slide-down" : "overlay-slide-up";
  return (
    <span style={{ display: "inline-flex" }}>
      {digits.map((digit, i) => (
        <span
          key={`${i}_${digit}`}
          style={{
            display: "inline-block",
            overflow: "hidden",
            padding: strokePadding,
            margin: -strokePadding,
          }}
        >
          <StyledText
            style={counterStyle}
            className="font-black tabular-nums leading-none"
            outerStyle={{
              display: "block",
              animation: `${anim} 0.22s ease-out forwards`,
            }}
          >
            {digit}
          </StyledText>
        </span>
      ))}
    </span>
  );
}

/** FlipCounter: like SlotCounter but uses the flip-clock animation per digit. */
export function FlipCounter({
  value,
  counterStyle,
  reverse,
  strokePadding = 0,
}: Readonly<{
  value: number;
  counterStyle: TextStyle;
  reverse?: boolean;
  strokePadding?: number;
}>) {
  const digits = String(value).split("");
  return (
    <span style={{ display: "inline-flex" }}>
      {digits.map((digit, i) => (
        <span
          key={`${i}_${digit}`}
          style={{
            display: "inline-block",
            overflow: "hidden",
            padding: strokePadding,
            margin: -strokePadding,
          }}
        >
          <StyledText
            style={counterStyle}
            className="font-black tabular-nums leading-none"
            outerStyle={{
              display: "block",
              animation: "overlay-flip 0.45s ease-in-out forwards",
              animationDirection: reverse ? "reverse" : "normal",
              transformOrigin: "center",
            }}
          >
            {digit}
          </StyledText>
        </span>
      ))}
    </span>
  );
}
