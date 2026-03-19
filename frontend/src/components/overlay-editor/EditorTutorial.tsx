/**
 * EditorTutorial.tsx — Step-based tooltip overlay that guides first-time users
 * through the Overlay Editor. Highlights key areas of the UI using
 * data-tutorial attributes placed on target containers.
 */
import { useState, useEffect, useRef } from "react";

type Props = Readonly<{
  onComplete: () => void;
}>;

interface TutorialStep {
  target: string;
  title: string;
  text: string;
}

const STEPS: TutorialStep[] = [
  {
    target: "canvas",
    title: "Vorschau",
    text: "Das ist deine Overlay-Vorschau. So sieht es in OBS aus.",
  },
  {
    target: "layers",
    title: "Ebenen",
    text: "Hier kannst du Elemente ein-/ausblenden und deren Reihenfolge ändern.",
  },
  {
    target: "properties",
    title: "Eigenschaften",
    text: "Wähle ein Element aus, um Stil, Animation und Position hier anzupassen.",
  },
  {
    target: "toolbar",
    title: "Werkzeugleiste",
    text: "Zoom, Rückgängig, Raster und Werkzeuge findest du hier.",
  },
  {
    target: "canvas",
    title: "Elemente",
    text: "Ziehe Elemente zum Verschieben. Nutze die Griffe zum Skalieren. Leertaste gedrückt halten = Hand-Werkzeug zum Schwenken.",
  },
];

export function EditorTutorial({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = document.querySelector(`[data-tutorial="${STEPS[step].target}"]`);
    if (el) {
      setRect(el.getBoundingClientRect());
    }
  }, [step]);

  // Recalculate on resize
  useEffect(() => {
    const handler = () => {
      const el = document.querySelector(`[data-tutorial="${STEPS[step].target}"]`);
      if (el) setRect(el.getBoundingClientRect());
    };
    globalThis.addEventListener("resize", handler);
    return () => globalThis.removeEventListener("resize", handler);
  }, [step]);

  const next = () => {
    if (step < STEPS.length - 1) {
      setStep(step + 1);
    } else {
      onComplete();
    }
  };

  const skip = () => onComplete();

  const current = STEPS[step];
  const pad = 8;

  // Tooltip positioning: place below the target, or above if near bottom
  const tooltipStyle: React.CSSProperties = rect
    ? {
        position: "fixed",
        left: Math.min(rect.left, globalThis.innerWidth - 340),
        top: rect.bottom + pad + 8 > globalThis.innerHeight - 100
          ? rect.top - pad - 120
          : rect.bottom + pad + 8,
        zIndex: 10002,
        width: 320,
      }
    : { display: "none" };

  return (
    <div ref={overlayRef} className="fixed inset-0" style={{ zIndex: 10000 }}>
      {/* Semi-transparent backdrop with cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ zIndex: 10000 }}>
        <defs>
          <mask id="tutorial-mask">
            <rect width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - pad}
                y={rect.top - pad}
                width={rect.width + pad * 2}
                height={rect.height + pad * 2}
                rx={12}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.6)"
          mask="url(#tutorial-mask)"
        />
      </svg>

      {/* Highlight border */}
      {rect && (
        <div
          className="absolute border-2 border-accent-blue rounded-xl pointer-events-none"
          style={{
            left: rect.left - pad,
            top: rect.top - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            zIndex: 10001,
            boxShadow: "0 0 0 4px rgba(90, 171, 255, 0.2)",
          }}
        />
      )}

      {/* Tooltip */}
      <div style={tooltipStyle}>
        <div className="bg-bg-secondary border border-border-subtle rounded-xl shadow-lg p-4">
          <p className="text-sm font-semibold text-text-primary mb-1">
            {current.title}
          </p>
          <p className="text-xs text-text-secondary mb-3">
            {current.text}
          </p>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-faint">
              {step + 1}/{STEPS.length}
            </span>
            <div className="flex gap-2">
              <button
                onClick={skip}
                className="px-3 py-1 rounded text-xs text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
              >
                Überspringen
              </button>
              <button
                onClick={next}
                className="px-3 py-1 rounded text-xs bg-accent-blue text-white hover:bg-accent-blue/80 transition-colors"
              >
                {step < STEPS.length - 1 ? "Weiter" : "Fertig"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
