/**
 * Full HSV color picker modal styled after Photoshop's picker.
 * Uses the native <dialog> element with .showModal() for proper focus trapping.
 */

import { useRef, useEffect, useState, useCallback } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../../contexts/I18nContext";

// --- HSV / RGB / Hex conversion utilities ---

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r1 = 0,
    g1 = 0,
    b1 = 0;
  if (h < 60) {
    r1 = c;
    g1 = x;
  } else if (h < 120) {
    r1 = x;
    g1 = c;
  } else if (h < 180) {
    g1 = c;
    b1 = x;
  } else if (h < 240) {
    g1 = x;
    b1 = c;
  } else if (h < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = Number.parseInt(clean.substring(0, 2), 16);
  const g = Number.parseInt(clean.substring(2, 4), 16);
  const b = Number.parseInt(clean.substring(4, 6), 16);
  return [r || 0, g || 0, b || 0];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHsv(r, g, b);
}

// --- Preset colors ---

const PRESETS = [
  "#ffffff", "#c0c0c0", "#808080", "#000000", "#ff0000", "#ff8000", "#ffff00", "#80ff00",
  "#00ff00", "#00ff80", "#00ffff", "#0080ff", "#0000ff", "#8000ff", "#ff00ff", "#ff0080",
];

// --- Checkerboard for transparency ---

const checkerboardBg =
  "linear-gradient(45deg, #808080 25%, transparent 25%), " +
  "linear-gradient(-45deg, #808080 25%, transparent 25%), " +
  "linear-gradient(45deg, transparent 75%, #808080 75%), " +
  "linear-gradient(-45deg, transparent 75%, #808080 75%)";

// --- Component ---

interface ColorPickerModalProps {
  readonly color: string;
  readonly opacity?: number;
  readonly showOpacity?: boolean;
  readonly onConfirm: (color: string, opacity?: number) => void;
  readonly onClose: () => void;
}

/** Photoshop-style HSV color picker rendered inside a native dialog. */
export function ColorPickerModal({
  color,
  opacity: initialOpacity = 1,
  showOpacity = false,
  onConfirm,
  onClose,
}: ColorPickerModalProps) {
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const satAreaRef = useRef<HTMLButtonElement>(null);
  const hueBarRef = useRef<HTMLDivElement>(null);
  const opacityBarRef = useRef<HTMLDivElement>(null);

  // Parse initial color into HSV
  const [initH, initS, initV] = hexToHsv(color);
  const [h, setH] = useState(initH);
  const [s, setS] = useState(initS);
  const [v, setV] = useState(initV);
  const [opacity, setOpacity] = useState(initialOpacity);
  const [hexInput, setHexInput] = useState(color.replace("#", "").toUpperCase());

  // Open dialog on mount
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  // Sync hex input when h/s/v changes (but not when user is typing)
  const syncFromHsv = useCallback(
    (newH: number, newS: number, newV: number) => {
      const hex = hsvToHex(newH, newS, newV);
      setHexInput(hex.replace("#", "").toUpperCase());
    },
    [],
  );

  // --- Drag helpers ---

  /** Creates a drag handler that calls `onMove` with the pointer position relative to `elRef`. */
  const useDrag = (
    elRef: React.RefObject<HTMLElement | null>,
    onMove: (x: number, y: number, rect: DOMRect) => void,
  ) => {
    return useCallback(
      (e: React.MouseEvent) => {
        e.preventDefault();
        const el = elRef.current;
        if (!el) return;

        const update = (clientX: number, clientY: number) => {
          const rect = el.getBoundingClientRect();
          const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
          const y = Math.max(0, Math.min(clientY - rect.top, rect.height));
          onMove(x, y, rect);
        };

        update(e.clientX, e.clientY);

        const handleMouseMove = (ev: MouseEvent) => update(ev.clientX, ev.clientY);
        const handleMouseUp = () => {
          globalThis.removeEventListener("mousemove", handleMouseMove);
          globalThis.removeEventListener("mouseup", handleMouseUp);
        };
        globalThis.addEventListener("mousemove", handleMouseMove);
        globalThis.addEventListener("mouseup", handleMouseUp);
      },
      [elRef, onMove],
    );
  };

  // Saturation/Brightness drag
  const onSatBrightMove = useCallback(
    (x: number, y: number, rect: DOMRect) => {
      const newS = x / rect.width;
      const newV = 1 - y / rect.height;
      setS(newS);
      setV(newV);
      syncFromHsv(h, newS, newV);
    },
    [h, syncFromHsv],
  );
  const handleSatMouseDown = useDrag(satAreaRef, onSatBrightMove);

  // Hue drag
  const onHueMove = useCallback(
    (x: number, _y: number, rect: DOMRect) => {
      const newH = (x / rect.width) * 360;
      setH(newH);
      syncFromHsv(newH, s, v);
    },
    [s, v, syncFromHsv],
  );
  const handleHueMouseDown = useDrag(hueBarRef, onHueMove);

  // Opacity drag
  const onOpacityMove = useCallback(
    (x: number, _y: number, rect: DOMRect) => {
      setOpacity(x / rect.width);
    },
    [],
  );
  const handleOpacityMouseDown = useDrag(opacityBarRef, onOpacityMove);

  // Hex input handler
  const handleHexChange = (val: string) => {
    const cleaned = val.replaceAll(/[^0-9a-fA-F]/g, "").slice(0, 6);
    setHexInput(cleaned.toUpperCase());
    if (cleaned.length === 6) {
      const [nh, ns, nv] = hexToHsv("#" + cleaned);
      setH(nh);
      setS(ns);
      setV(nv);
    }
  };

  // Preset click
  const handlePreset = (preset: string) => {
    const [nh, ns, nv] = hexToHsv(preset);
    setH(nh);
    setS(ns);
    setV(nv);
    setHexInput(preset.replace("#", "").toUpperCase());
  };

  const handleCancel = () => {
    dialogRef.current?.close();
    onClose();
  };

  // Close on backdrop click (imperative to avoid onClick on non-interactive <dialog>).
  // We listen for `mousedown` (not `click`) on the document and only close if the
  // press *originates* outside the dialog rectangle. This prevents drags that
  // start inside the sat/hue/opacity sliders and end over the backdrop from
  // being misinterpreted as a backdrop click — the click event in that case has
  // `target === dialog`, which would otherwise fire a false-positive close.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleDocMouseDown = (e: MouseEvent) => {
      const rect = dialog.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!inside) handleCancel();
    };

    document.addEventListener("mousedown", handleDocMouseDown);
    return () => document.removeEventListener("mousedown", handleDocMouseDown);
  }, [handleCancel]);

  const handleConfirm = () => {
    const finalHex = hsvToHex(h, s, v);
    onConfirm(finalHex, showOpacity ? opacity : undefined);
    dialogRef.current?.close();
    onClose();
  };

  const currentHex = hsvToHex(h, s, v);
  const hueColor = `hsl(${h}, 100%, 50%)`;

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      className="m-auto bg-bg-card border border-border-subtle rounded-2xl p-6 w-full max-w-xs animate-slide-in backdrop:bg-black/70"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-text-primary">Farbauswahl</h2>
        <button
          title={t("tooltip.common.close")}
          onClick={handleCancel}
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Saturation / Brightness area */}
      <button
        type="button"
        ref={satAreaRef}
        aria-label="Color saturation and brightness picker"
        onMouseDown={handleSatMouseDown}
        className="appearance-none p-0 m-0 block relative w-full rounded border border-border-subtle cursor-crosshair select-none"
        style={{
          height: 256,
          background: `
            linear-gradient(to bottom, transparent, black),
            linear-gradient(to right, white, ${hueColor})
          `,
        }}
      >
        {/* Indicator */}
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${s * 100}%`,
            top: `${(1 - v) * 100}%`,
            width: 12,
            height: 12,
            borderRadius: "50%",
            border: "2px solid white",
            boxShadow: "0 0 2px rgba(0,0,0,0.6)",
            transform: "translate(-50%, -50%)",
          }}
        />
      </button>

      {/* Hue slider */}
      <div
        ref={hueBarRef}
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuenow={Math.round(h)}
        aria-valuemin={0}
        aria-valuemax={360}
        onMouseDown={handleHueMouseDown}
        className="relative w-full rounded mt-3 cursor-pointer select-none border border-border-subtle"
        style={{
          height: 16,
          background:
            "linear-gradient(to right, #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%)",
        }}
      >
        <div
          className="absolute top-0 pointer-events-none"
          style={{
            left: `${(h / 360) * 100}%`,
            width: 6,
            height: "100%",
            borderRadius: 2,
            border: "2px solid white",
            boxShadow: "0 0 2px rgba(0,0,0,0.6)",
            transform: "translateX(-50%)",
          }}
        />
      </div>

      {/* Opacity slider */}
      {showOpacity && (
        <div
          ref={opacityBarRef}
          role="slider"
          tabIndex={0}
          aria-label="Opacity"
          aria-valuenow={Math.round(opacity * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          onMouseDown={handleOpacityMouseDown}
          className="relative w-full rounded mt-2 cursor-pointer select-none border border-border-subtle overflow-hidden"
          style={{ height: 16 }}
        >
          {/* Checkerboard layer */}
          <div
            className="absolute inset-0"
            style={{
              background: checkerboardBg,
              backgroundSize: "8px 8px",
              backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0px",
            }}
          />
          {/* Gradient layer */}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to right, transparent, ${currentHex})`,
            }}
          />
          {/* Indicator */}
          <div
            className="absolute top-0 pointer-events-none"
            style={{
              left: `${opacity * 100}%`,
              width: 6,
              height: "100%",
              borderRadius: 2,
              border: "2px solid white",
              boxShadow: "0 0 2px rgba(0,0,0,0.6)",
              transform: "translateX(-50%)",
            }}
          />
        </div>
      )}

      {/* Hex input + old/new preview */}
      <div className="flex items-stretch gap-3 mt-3">
        {/* Hex input */}
        <div className="flex items-center border border-border-subtle rounded overflow-hidden bg-bg-primary flex-1">
          <span className="pl-2 text-xs text-text-muted select-none">#</span>
          <input
            type="text"
            value={hexInput}
            onChange={(e) => handleHexChange(e.target.value)}
            maxLength={6}
            className="flex-1 min-w-0 bg-transparent text-xs text-text-primary px-1 py-1.5 outline-none font-mono"
          />
        </div>

        {/* Old vs New preview */}
        <div className="flex rounded overflow-hidden border border-border-subtle w-16 shrink-0" style={{ height: 32 }}>
          <div className="flex-1" style={{ background: color }} title="Vorher" />
          <div className="flex-1" style={{ background: currentHex }} title="Nachher" />
        </div>
      </div>

      {/* Opacity value display */}
      {showOpacity && (
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-text-muted">Deckkraft</span>
          <span className="text-[10px] text-text-secondary font-mono">
            {Math.round(opacity * 100)}%
          </span>
        </div>
      )}

      {/* Preset swatches */}
      <div className="mt-3">
        <span className="text-[10px] text-text-muted block mb-1">Voreinstellungen</span>
        <div className="grid grid-cols-8 gap-1">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => handlePreset(preset)}
              className="w-full aspect-square rounded border border-border-subtle hover:border-text-muted transition-colors"
              style={{ background: preset }}
              title={preset}
            />
          ))}
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-3 mt-4">
        <button
          title={t("tooltip.common.cancel")}
          onClick={handleCancel}
          className="flex-1 py-2 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-sm"
        >
          {t("tooltip.common.cancel")}
        </button>
        <button
          title={t("tooltip.common.apply")}
          onClick={handleConfirm}
          className="flex-1 py-2 rounded-lg bg-accent-blue hover:bg-accent-blue/80 text-white font-semibold text-sm transition-colors shadow-sm"
        >
          {t("tooltip.common.apply")}
        </button>
      </div>
    </dialog>
  );
}
