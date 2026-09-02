/**
 * Shared type definitions of the overlay property panel: the translate
 * signature its data tables take, one entry of an animation `<select>`, and the
 * parameter shapes the panel hands to the shared style editor modals. They live
 * apart from the panel so the extracted editors can reference them without
 * importing the panel back.
 */
import type { GradientStop } from "../../types";
import type { ShadowConfirmParams } from "./controls/ShadowEditorModal";
import type { OutlineType } from "./controls/OutlineEditorModal";

/** Parameters for opening the shadow editor modal. */
export interface OpenShadowEditorParams extends ShadowConfirmParams {
  readonly onConfirm: (params: ShadowConfirmParams) => void;
}

/** Current outline values plus the callback the outline editor confirms with. */
export interface OpenOutlineEditorParams {
  readonly type: OutlineType;
  readonly color: string;
  readonly width: number;
  readonly gradientStops: GradientStop[];
  readonly gradientAngle: number;
  readonly onConfirm: (
    type: OutlineType,
    color: string,
    width: number,
    gradientStops: GradientStop[],
    gradientAngle: number,
  ) => void;
}

/** Translation function signature, mirrored from the I18n context. */
export type TranslateFn = (key: string, options?: Record<string, string | number>) => string;

/** One entry of an animation `<select>`. */
export interface AnimationOption {
  readonly value: string;
  readonly label: string;
}

/** Callbacks that open the shared style editor modals. */
export interface StyleEditorOpeners {
  readonly onOpenTextColorEditor: (
    colorType: "solid" | "gradient",
    color: string,
    gradientStops: GradientStop[],
    gradientAngle: number,
    onConfirm: (ct: "solid" | "gradient", c: string, gs: GradientStop[], ga: number) => void,
  ) => void;
  readonly onOpenOutlineEditor: (params: OpenOutlineEditorParams) => void;
  readonly onOpenShadowEditor: (params: OpenShadowEditorParams) => void;
}
