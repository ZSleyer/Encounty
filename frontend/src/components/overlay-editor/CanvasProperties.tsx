/**
 * Canvas properties of the overlay property panel: the size of the box, its
 * background fill and image, the border, and the animated background with its
 * per-animation color settings.
 */
import type { ReactNode } from "react";
import { Upload, Trash2 } from "lucide-react";
import { OverlaySettings } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { NumSlider, PercentSlider } from "./controls/NumSlider";
import { ColorSwatch } from "./controls/ColorSwatch";
import { SELECT_CLASS } from "./panelStyles";

/** Callback that writes a whole settings object back to the editor. */
type UpdateSettings = (settings: OverlaySettings) => void;

/**
 * One `<input type="color">` row of the background animation settings. The
 * label is a node rather than a string so the numbered gradient stops keep
 * rendering their index as its own text node.
 */
function AnimationColorInput({
  label,
  value,
  onChange,
}: Readonly<{
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
}>) {
  return (
    <label className="block">
      <span className="text-xs text-text-muted">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-7 mt-1 rounded-none border border-border-subtle cursor-pointer"
      />
    </label>
  );
}

/**
 * Animated background of the canvas: which animation runs, how fast, and the
 * colors the running animation reads out of the background animation config.
 */
function BackgroundAnimationFields({
  localSettings,
  update,
}: Readonly<{
  localSettings: OverlaySettings;
  update: UpdateSettings;
}>) {
  const { t } = useI18n();
  const bgConfig = localSettings.background_animation_config ?? {};
  const setBgConfig = (key: string, value: unknown) =>
    update({ ...localSettings, background_animation_config: { ...bgConfig, [key]: value } });
  return (
    <div className="space-y-2">
      <label className="block" htmlFor="pp-bg-animation">
        <span className="text-xs text-text-muted">{t("overlay.bgAnimation")}</span>
        <select
          id="pp-bg-animation"
          value={localSettings.background_animation ?? "none"}
          onChange={(e) => update({ ...localSettings, background_animation: e.target.value })}
          className={`${SELECT_CLASS} mt-1`}
        >
          <option value="none">{t("overlay.animNone")}</option>
          <option value="waves">{t("overlay.animWaves")}</option>
          <option value="gradient-shift">{t("overlay.animGradient")}</option>
          <option value="shimmer-bg">{t("overlay.animShimmer")}</option>
        </select>
      </label>

      {/* Animation speed */}
      {(localSettings.background_animation ?? "none") !== "none" && (
        <NumSlider
          label={`${t("overlay.speed")} ${(localSettings.background_animation_speed ?? 1).toFixed(1)}×`}
          value={localSettings.background_animation_speed ?? 1}
          min={0.1}
          max={3}
          step={0.1}
          onChange={(v) => update({ ...localSettings, background_animation_speed: v })}
        />
      )}

      {/* Animation-specific settings */}
      {(localSettings.background_animation ?? "none") !== "none" && (
        <div className="space-y-2 pt-1 border-t border-border-subtle">
          <span className="text-[10px] font-medium text-text-faint uppercase tracking-wider">
            {t("overlay.animSettings")}
          </span>

          {/* Waves: color, opacity */}
          {localSettings.background_animation === "waves" && (
            <>
              <AnimationColorInput
                label={t("overlay.animColor")}
                value={(bgConfig.wavesColor as string) ?? "#ffffff"}
                onChange={(v) => setBgConfig("wavesColor", v)}
              />
              <PercentSlider
                label={t("overlay.animOpacity")}
                value={(bgConfig.wavesOpacity as number) ?? 0.18}
                onChange={(v) => setBgConfig("wavesOpacity", v)}
              />
            </>
          )}

          {/* Gradient shift: 4 color stops */}
          {localSettings.background_animation === "gradient-shift" && (
            <>
              <AnimationColorInput
                label={<>{t("overlay.animColor")} 1</>}
                value={(bgConfig.gradientColor1 as string) ?? "#ff6b6b"}
                onChange={(v) => setBgConfig("gradientColor1", v)}
              />
              <AnimationColorInput
                label={<>{t("overlay.animColor")} 2</>}
                value={(bgConfig.gradientColor2 as string) ?? "#feca57"}
                onChange={(v) => setBgConfig("gradientColor2", v)}
              />
              <AnimationColorInput
                label={<>{t("overlay.animColor")} 3</>}
                value={(bgConfig.gradientColor3 as string) ?? "#48dbfb"}
                onChange={(v) => setBgConfig("gradientColor3", v)}
              />
              <AnimationColorInput
                label={<>{t("overlay.animColor")} 4</>}
                value={(bgConfig.gradientColor4 as string) ?? "#ff9ff3"}
                onChange={(v) => setBgConfig("gradientColor4", v)}
              />
            </>
          )}

          {/* Shimmer: color and intensity */}
          {localSettings.background_animation === "shimmer-bg" && (
            <>
              <AnimationColorInput
                label={t("overlay.animColor")}
                value={(bgConfig.shimmerColor as string) ?? "#ffffff"}
                onChange={(v) => setBgConfig("shimmerColor", v)}
              />
              <PercentSlider
                label={t("overlay.animIntensity")}
                value={(bgConfig.shimmerIntensity as number) ?? 0.12}
                onChange={(v) => setBgConfig("shimmerIntensity", v)}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * CanvasProperties renders the rows shown while the canvas layer is selected.
 */
export function CanvasProperties({
  localSettings,
  update,
  openColorPicker,
  bgPreviewUrl,
  bgUploading,
  onBgUpload,
  onBgRemove,
}: Readonly<{
  localSettings: OverlaySettings;
  update: UpdateSettings;
  openColorPicker: (
    color: string,
    onPick: (c: string) => void,
    opts?: { opacity?: number; showOpacity?: boolean },
  ) => void;
  bgPreviewUrl?: string;
  bgUploading?: boolean;
  onBgUpload?: () => void;
  onBgRemove?: () => void;
}>) {
  const { t } = useI18n();

  // Named colors cannot drive a swatch preview, so anything but a hex falls
  // back to white the same way the color picker does.
  const borderSwatchColor = localSettings.border_color?.startsWith("#")
    ? localSettings.border_color
    : "#ffffff";

  return (
    <div className="space-y-3">
      {/* --- Canvas size --- */}
      <fieldset className="border border-border-subtle rounded-none px-2.5 pb-2.5 space-y-2">
        <legend className="px-1 text-xs 2xl:text-sm text-text-secondary">
          {t("overlay.canvasSize")}
        </legend>
        <NumSlider
          label={t("overlay.width")}
          unit="px"
          value={localSettings.canvas_width}
          min={100}
          max={1920}
          step={10}
          onChange={(v) => update({ ...localSettings, canvas_width: v })}
        />
        <NumSlider
          label={t("overlay.height")}
          unit="px"
          value={localSettings.canvas_height}
          min={50}
          max={1080}
          step={10}
          onChange={(v) => update({ ...localSettings, canvas_height: v })}
        />
      </fieldset>

      {/* --- Background: fill, image and the shape of the box --- */}
      <fieldset className="border border-border-subtle rounded-none px-2.5 pb-2.5 space-y-2">
        <legend className="px-1 text-xs 2xl:text-sm text-text-secondary">
          {t("overlay.background")}
        </legend>

        <div
          className={
            localSettings.hidden ? "space-y-2 opacity-30 pointer-events-none" : "space-y-2"
          }
        >
          <ColorSwatch
            color={localSettings.background_color}
            label={t("overlay.color")}
            detail={localSettings.background_color}
            onClick={() =>
              openColorPicker(localSettings.background_color, (c) =>
                update({ ...localSettings, background_color: c }),
              )
            }
          />
          <PercentSlider
            label={t("overlay.opacity")}
            value={localSettings.background_opacity}
            onChange={(v) => update({ ...localSettings, background_opacity: v })}
          />
          <NumSlider
            label={t("overlay.blur")}
            unit="px"
            value={localSettings.blur}
            min={0}
            max={30}
            onChange={(v) => update({ ...localSettings, blur: v })}
          />
        </div>

        <NumSlider
          label={t("overlay.radius")}
          unit="px"
          value={localSettings.border_radius}
          min={0}
          max={60}
          onChange={(v) => update({ ...localSettings, border_radius: v })}
        />

        {/* Background image upload */}
        {onBgUpload && (
          <div>
            <span className="text-xs text-text-muted">{t("overlay.bgImage")}</span>
            <div className="flex items-center gap-1.5 mt-1">
              <button
                type="button"
                title={t("tooltip.editor.uploadBackground")}
                onClick={onBgUpload}
                disabled={bgUploading}
                className="flex items-center gap-1 px-2 py-1 rounded-none text-xs bg-bg-primary hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
              >
                <Upload className="w-3 h-3" aria-hidden="true" />
                {bgUploading ? "..." : t("overlay.upload")}
              </button>
              {localSettings.background_image && onBgRemove && (
                <button
                  type="button"
                  title={t("tooltip.editor.removeBackground")}
                  onClick={onBgRemove}
                  className="flex items-center gap-1 px-2 py-1 rounded-none text-xs bg-bg-primary hover:bg-accent-red/20 text-text-secondary hover:text-accent-red transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
                >
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                  {t("overlay.remove")}
                </button>
              )}
            </div>
            {localSettings.background_image && bgPreviewUrl && (
              <>
                <div
                  className="mt-1.5 w-full h-12 rounded-none border border-border-subtle bg-bg-primary overflow-hidden"
                  style={{
                    backgroundImage: `url(${bgPreviewUrl})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                  }}
                />
                <label className="block mt-1" htmlFor="pp-bg-image-fit">
                  <span className="text-xs text-text-muted">{t("overlay.bgImageFit")}</span>
                  <select
                    id="pp-bg-image-fit"
                    value={localSettings.background_image_fit ?? "cover"}
                    onChange={(e) =>
                      update({
                        ...localSettings,
                        background_image_fit: e.target.value as
                          | "cover"
                          | "contain"
                          | "stretch"
                          | "tile",
                      })
                    }
                    className={SELECT_CLASS}
                  >
                    <option value="cover">Cover</option>
                    <option value="contain">Contain</option>
                    <option value="stretch">Stretch</option>
                    <option value="tile">{t("overlay.bgFitTile")}</option>
                  </select>
                </label>
              </>
            )}
          </div>
        )}
      </fieldset>

      {/* --- Border --- */}
      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={localSettings.show_border}
            onChange={(e) => update({ ...localSettings, show_border: e.target.checked })}
            className="accent-accent-blue"
          />
          <span className="text-xs text-text-secondary">{t("overlay.borderOutline")}</span>
        </label>
        {localSettings.show_border && (
          <div
            className={`space-y-2 pl-1 ${localSettings.hidden ? "opacity-30 pointer-events-none" : ""}`}
          >
            <ColorSwatch
              color={borderSwatchColor}
              label={t("overlay.borderColor")}
              detail={localSettings.border_color}
              onClick={() =>
                openColorPicker(borderSwatchColor, (c) =>
                  update({ ...localSettings, border_color: c }),
                )
              }
            />
            <NumSlider
              label={t("overlay.borderWidth")}
              unit="px"
              value={localSettings.border_width ?? 2}
              min={1}
              max={8}
              onChange={(v) => update({ ...localSettings, border_width: v })}
            />
          </div>
        )}
      </div>

      <BackgroundAnimationFields localSettings={localSettings} update={update} />
    </div>
  );
}
