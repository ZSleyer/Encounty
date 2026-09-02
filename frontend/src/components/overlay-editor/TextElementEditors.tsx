/**
 * Element editors of the overlay property panel: the rows every value layer
 * with an optional label shares, and the shorter set a plain text layer needs.
 */
import type { ReactNode } from "react";
import { LabeledTextElement, TextStyle } from "../../types";
import type { DraggableElementKey, ElementKey } from "../../utils/overlayElements";
import { BASE_TEXT_STYLE as DEFAULT_TEXT_STYLE } from "./overlayTemplates";
import { TextStyleEditor } from "./TextStyleEditor";
import { AffixFields, LabelFields } from "./TextElementFields";
import { AnimationGroup, fireTestFor } from "./AnimationGroup";
import type { AnimationOption, StyleEditorOpeners } from "./propertyPanelTypes";

/**
 * LabeledTextLike is the structural shape every value layer with an optional
 * label shares: counter, timer, odds and the phasing elements. The timer has no
 * trigger animations, which is why both trigger fields are optional here.
 */
interface LabeledTextLike {
  style: TextStyle;
  show_label: boolean;
  label_text: string;
  label_style?: TextStyle;
  prefix_text: string;
  suffix_text: string;
  idle_animation: string;
  trigger_enter?: string;
  trigger_decrement?: string;
}

/**
 * LabeledTextElementEditor renders the property rows shared by every value
 * layer that can carry a label: text style, the text drawn before and after the
 * value, the label group, and the animation group. Omitting triggerAnimations
 * drops the one-shot rows, which is what the timers need.
 */
export function LabeledTextElementEditor({
  elementKey,
  element,
  styleLabel,
  idleAnimations,
  triggerAnimations,
  extraRows,
  onChange,
  onOpenTextColorEditor,
  onOpenOutlineEditor,
  onOpenShadowEditor,
  fireTest,
}: Readonly<
  StyleEditorOpeners & {
    elementKey: DraggableElementKey;
    element: LabeledTextLike;
    styleLabel: string;
    idleAnimations: readonly AnimationOption[];
    /** Omitted for elements without trigger animations, such as the timers. */
    triggerAnimations?: readonly AnimationOption[];
    /** Element-specific rows, rendered right below the affix group. */
    extraRows?: ReactNode;
    onChange: (patch: Partial<LabeledTextElement>) => void;
    fireTest: (element: ElementKey, reverse?: boolean) => void;
  }
>) {
  const openers: StyleEditorOpeners = {
    onOpenTextColorEditor,
    onOpenOutlineEditor,
    onOpenShadowEditor,
  };
  return (
    <div className="space-y-3">
      <TextStyleEditor
        style={element.style || DEFAULT_TEXT_STYLE}
        label={styleLabel}
        onChange={(s) => onChange({ style: s })}
        {...openers}
      />
      <AffixFields
        idPrefix={elementKey}
        prefixText={element.prefix_text}
        suffixText={element.suffix_text}
        onChange={onChange}
      />
      {extraRows}
      <LabelFields
        show={element.show_label}
        text={element.label_text}
        style={element.label_style}
        onChange={onChange}
        {...openers}
      />
      <AnimationGroup
        idPrefix={elementKey}
        idle={{
          value: element.idle_animation,
          options: idleAnimations,
          onChange: (v) => onChange({ idle_animation: v }),
        }}
        trigger={
          triggerAnimations && {
            value: element.trigger_enter ?? "none",
            options: triggerAnimations,
            onChange: (v) => onChange({ trigger_enter: v }),
          }
        }
        decrement={
          triggerAnimations && {
            value: element.trigger_decrement || "none",
            options: triggerAnimations,
            onChange: (v) => onChange({ trigger_decrement: v }),
          }
        }
        onTest={fireTestFor(fireTest, elementKey)}
      />
    </div>
  );
}

/**
 * PlainTextElementEditor renders the rows of a text layer without a label:
 * the name and the title. Only a text style and the animation group.
 */
export function PlainTextElementEditor({
  elementKey,
  style,
  idleAnimation,
  triggerEnter,
  triggerDecrement,
  styleLabel,
  idleAnimations,
  triggerAnimations,
  onChange,
  onOpenTextColorEditor,
  onOpenOutlineEditor,
  onOpenShadowEditor,
  fireTest,
}: Readonly<
  StyleEditorOpeners & {
    elementKey: DraggableElementKey;
    style: TextStyle | undefined;
    idleAnimation: string;
    triggerEnter: string;
    triggerDecrement: string;
    styleLabel: string;
    idleAnimations: readonly AnimationOption[];
    triggerAnimations: readonly AnimationOption[];
    onChange: (patch: {
      style?: TextStyle;
      idle_animation?: string;
      trigger_enter?: string;
      trigger_decrement?: string;
    }) => void;
    fireTest: (element: ElementKey, reverse?: boolean) => void;
  }
>) {
  return (
    <div className="space-y-3">
      <TextStyleEditor
        style={style || DEFAULT_TEXT_STYLE}
        label={styleLabel}
        onChange={(s) => onChange({ style: s })}
        onOpenTextColorEditor={onOpenTextColorEditor}
        onOpenOutlineEditor={onOpenOutlineEditor}
        onOpenShadowEditor={onOpenShadowEditor}
      />
      <AnimationGroup
        idPrefix={elementKey}
        idle={{
          value: idleAnimation,
          options: idleAnimations,
          onChange: (v) => onChange({ idle_animation: v }),
        }}
        trigger={{
          value: triggerEnter,
          options: triggerAnimations,
          onChange: (v) => onChange({ trigger_enter: v }),
        }}
        decrement={{
          value: triggerDecrement || "none",
          options: triggerAnimations,
          onChange: (v) => onChange({ trigger_decrement: v }),
        }}
        onTest={fireTestFor(fireTest, elementKey)}
      />
    </div>
  );
}
