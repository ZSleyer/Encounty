/**
 * Data tables of the animation `<select>` controls in the overlay property
 * panel. Every builder is a plain list over the translate function: which
 * animations one element offers is a fact about that element, not about the
 * panel that renders the dropdown.
 */
import type { AnimationOption, TranslateFn } from "./propertyPanelTypes";

/** buildIdleAnimations lists the continuous animations offered for text elements. */
export function buildIdleAnimations(t: TranslateFn): AnimationOption[] {
  return [
    { value: "none", label: t("overlay.animNone") },
    { value: "breathe", label: t("overlay.animBreathe") },
    { value: "glow", label: t("overlay.animGlow") },
    { value: "shimmer", label: t("overlay.animShimmerIdle") },
    { value: "float", label: t("overlay.animFloat") },
  ];
}

/** buildSpriteIdleAnimations lists the continuous animations offered for the sprite. */
export function buildSpriteIdleAnimations(t: TranslateFn): AnimationOption[] {
  return [
    { value: "none", label: t("overlay.animNone") },
    { value: "float", label: t("overlay.animFloat") },
    { value: "bob", label: t("overlay.animBob") },
    { value: "pulse", label: t("overlay.animPulseShort") },
    { value: "rock", label: t("overlay.animWobble") },
    { value: "wiggle", label: t("overlay.animBounce") },
    { value: "shimmer", label: t("overlay.animShimmerIdle") },
  ];
}

/** buildSpriteTriggerAnimations lists the one-shot animations offered for the sprite. */
export function buildSpriteTriggerAnimations(t: TranslateFn): AnimationOption[] {
  return [
    { value: "none", label: t("overlay.animNone") },
    { value: "pop", label: t("overlay.pop") },
    { value: "bounce", label: t("overlay.bounce") },
    { value: "shake", label: t("overlay.shake") },
    { value: "spin", label: t("overlay.spin") },
    { value: "flip", label: t("overlay.flip") },
    { value: "rubber", label: t("overlay.rubber") },
    { value: "flash", label: t("overlay.flash") },
    { value: "jello", label: t("overlay.jello") },
    { value: "tada", label: t("overlay.tada") },
    { value: "swing", label: t("overlay.swing") },
  ];
}

/** buildTextTriggerAnimations lists the one-shot animations of the plain text elements. */
export function buildTextTriggerAnimations(t: TranslateFn): AnimationOption[] {
  return [
    { value: "none", label: t("overlay.animNone") },
    { value: "fade-in", label: t("overlay.animFadeIn") },
    { value: "slide-in", label: t("overlay.animSlideIn") },
    { value: "pop", label: t("overlay.pop") },
    { value: "bounce", label: t("overlay.bounce") },
    { value: "shake", label: t("overlay.shake") },
    { value: "flip", label: t("overlay.flip") },
    { value: "rubber", label: t("overlay.rubber") },
    { value: "jello", label: t("overlay.jello") },
    { value: "tada", label: t("overlay.tada") },
    { value: "zoom-in", label: t("overlay.zoomIn") },
  ];
}

/**
 * buildCounterTriggerAnimations lists the counter's one-shot animations. "Slot"
 * and "Flip Digit" are digit render modes and only the counter can show them.
 */
export function buildCounterTriggerAnimations(t: TranslateFn): AnimationOption[] {
  return [
    { value: "none", label: t("overlay.animNone") },
    { value: "pop", label: t("overlay.pop") },
    { value: "flash", label: t("overlay.flash") },
    { value: "bounce", label: t("overlay.bounce") },
    { value: "shake", label: t("overlay.shake") },
    { value: "slot", label: t("overlay.slot") },
    { value: "flip-digit", label: t("overlay.flipDigit") },
    { value: "slide-up", label: t("overlay.slideUp") },
    { value: "flip", label: t("overlay.flip") },
    { value: "rubber", label: t("overlay.rubber") },
    { value: "jello", label: t("overlay.jello") },
    { value: "tada", label: t("overlay.tada") },
    { value: "zoom-in", label: t("overlay.zoomIn") },
  ];
}

/** buildOddsTriggerAnimations lists the one-shot animations offered for the odds. */
export function buildOddsTriggerAnimations(t: TranslateFn): AnimationOption[] {
  return [
    { value: "none", label: t("overlay.animNone") },
    { value: "fade-in", label: t("overlay.animFadeIn") },
    { value: "pop", label: t("overlay.pop") },
    { value: "flash", label: t("overlay.flash") },
    { value: "bounce", label: t("overlay.bounce") },
    { value: "shake", label: t("overlay.shake") },
    { value: "tada", label: t("overlay.tada") },
    { value: "zoom-in", label: t("overlay.zoomIn") },
  ];
}

/**
 * buildNumericTriggerAnimations lists the trigger animations offered for the
 * labeled text elements. "Slot" and "Flip Digit" are missing on purpose: they
 * are render modes rather than animations and only the counter renders them.
 */
export function buildNumericTriggerAnimations(t: TranslateFn): AnimationOption[] {
  return [
    { value: "none", label: t("overlay.animNone") },
    { value: "pop", label: t("overlay.pop") },
    { value: "flash", label: t("overlay.flash") },
    { value: "bounce", label: t("overlay.bounce") },
    { value: "shake", label: t("overlay.shake") },
    { value: "slide-up", label: t("overlay.slideUp") },
    { value: "flip", label: t("overlay.flip") },
    { value: "rubber", label: t("overlay.rubber") },
    { value: "jello", label: t("overlay.jello") },
    { value: "tada", label: t("overlay.tada") },
    { value: "zoom-in", label: t("overlay.zoomIn") },
  ];
}
