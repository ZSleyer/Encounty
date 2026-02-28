import { useRef, useEffect, useMemo, useState } from "react";
import { Pokemon, OverlaySettings } from "../types";
import { useCounterStore } from "../hooks/useCounterState";

interface Props {
  previewSettings?: OverlaySettings;
  previewPokemon?: Pokemon;
}

export function Overlay({ previewSettings, previewPokemon }: Props) {
  const { appState } = useCounterStore();
  const [animationClass, setAnimationClass] = useState("");
  const [triggerId, setTriggerId] = useState(0);
  const prevCount = useRef<number | undefined>(undefined);

  const activePokemon: Pokemon | null = useMemo(() => {
    return (
      previewPokemon ||
      (appState
        ? (appState.pokemon.find((p) => p.id === appState.active_id) ?? null)
        : null)
    );
  }, [previewPokemon, appState]);

  const settings: OverlaySettings | null = useMemo(() => {
    return previewSettings || appState?.settings.overlay || null;
  }, [previewSettings, appState]);

  // Handle Animation Triggering
  useEffect(() => {
    if (!activePokemon || !settings) return;

    if (
      prevCount.current !== undefined &&
      activePokemon.encounters !== prevCount.current
    ) {
      let anim = "";
      if (activePokemon.encounters === 0) {
        anim = settings.animation_reset;
      } else if (activePokemon.encounters > prevCount.current) {
        anim = settings.animation_increment;
      } else {
        anim = settings.animation_decrement;
      }

      if (anim && anim !== "none") {
        setAnimationClass(`animate-${anim}`);
        setTriggerId(Date.now());
      }
    }
    prevCount.current = activePokemon.encounters;
  }, [activePokemon?.encounters, settings]);

  const nameStyle = useMemo(() => {
    if (!settings) return {};
    const getFont = (family: string, custom: string) => {
      if (family === "pokemon") return "'Press Start 2P', cursive";
      if (family === "sans") return "'Inter', sans-serif";
      if (family === "serif") return "serif";
      return custom || "'Inter'";
    };

    const style: any = {
      fontFamily: getFont(settings.name_font_family, settings.name_custom_font),
      fontSize: `${settings.name_size}px`,
      color: settings.name_color,
      "--outline-color": settings.name_outline_color,
      "--outline-width": `${settings.name_outline_width}px`,
      WebkitTextStroke: `${settings.name_outline_width}px ${settings.name_outline_color}`,
      paintOrder: "stroke fill",
      transition: "all 0.3s ease",
    };

    if (settings.name_gradient_enabled) {
      style.background = `linear-gradient(to bottom, ${settings.name_color}, ${settings.name_gradient_color})`;
      style.WebkitBackgroundClip = "text";
      style.WebkitTextFillColor = "transparent";
    }

    return style;
  }, [settings]);

  const counterStyle = useMemo(() => {
    if (!settings) return {};
    const getFont = (family: string, custom: string) => {
      if (family === "pokemon") return "'Press Start 2P', cursive";
      if (family === "sans") return "'Inter', sans-serif";
      if (family === "serif") return "serif";
      return custom || "'Inter'";
    };

    const style: any = {
      fontFamily: getFont(settings.font_family, settings.custom_font),
      fontSize: `${settings.font_size}px`,
      color: settings.text_color,
      "--outline-color": settings.outline_color,
      "--outline-width": `${settings.outline_width}px`,
      WebkitTextStroke: `${settings.outline_width}px ${settings.outline_color}`,
      paintOrder: "stroke fill",
      transition: "all 0.3s ease",
    };

    if (settings.gradient_enabled) {
      style.background = `linear-gradient(to bottom, ${settings.text_color}, ${settings.gradient_color})`;
      style.WebkitBackgroundClip = "text";
      style.WebkitTextFillColor = "transparent";
    }

    return style;
  }, [settings]);

  const order = settings?.layer_order || ["sprite", "name", "counter"];
  const outer = settings?.outer_element || "none";

  const renderSingleElement = (type: string) => {
    if (!activePokemon || !settings) return null;

    if (type === "sprite" && settings.sprite_position !== "hidden") {
      const spriteAnimClass =
        settings.animation_target === "both" ||
        settings.animation_target === "sprite"
          ? animationClass
          : "";
      return (
        <div
          key="sprite"
          style={{
            width: `${settings.sprite_size}px`,
            height: `${settings.sprite_size}px`,
            zIndex: settings.sprite_on_top ? 20 : 10,
            transition: "all 0.3s ease",
          }}
          className="flex items-center justify-center relative"
        >
          <div
            key={`anim-sprite-${triggerId}`}
            className={spriteAnimClass}
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {settings.show_sprite_glow && (
              <div className="absolute inset-x-0 inset-y-0 bg-white/10 rounded-full blur-3xl animate-pulse" />
            )}
            <img
              src={activePokemon.sprite_url}
              alt={activePokemon.name}
              className="w-full h-full object-contain relative z-10 drop-shadow-[0_10px_20px_rgba(0,0,0,0.5)]"
              style={{ imageRendering: "pixelated" }}
            />
          </div>
        </div>
      );
    }
    if (type === "name" && settings.show_name) {
      return (
        <span
          key="name"
          className="uppercase font-bold tracking-widest whitespace-nowrap"
          style={nameStyle}
        >
          {activePokemon.name}
        </span>
      );
    }
    if (type === "counter" && settings.show_encounter) {
      const countAnimClass =
        settings.animation_target === "both" ||
        settings.animation_target === "counter"
          ? animationClass
          : "";
      return (
        <div key={`anim-counter-${triggerId}`} className={countAnimClass}>
          <span
            className="font-black tabular-nums leading-none"
            style={counterStyle}
          >
            {activePokemon.encounters}
          </span>
        </div>
      );
    }
    return null;
  };

  const elements = useMemo(() => {
    if (!activePokemon || !settings) return null;

    if (outer === "none") {
      return order.map((type) => renderSingleElement(type));
    }

    const innerTypes = order.filter((t) => t !== outer);
    let innerGroupRendered = false;
    const finalElements: (JSX.Element | null)[] = [];

    order.forEach((type) => {
      if (type === outer) {
        finalElements.push(renderSingleElement(type));
      } else if (!innerGroupRendered) {
        finalElements.push(
          <div
            key="inner-group"
            style={{
              display: "flex",
              flexDirection:
                settings.inner_layout === "vertical"
                  ? ("column" as const)
                  : ("row" as const),
              alignItems: "center",
              justifyContent: "center",
              gap: `${settings.gap}px`,
              transition: "all 0.3s ease",
            }}
          >
            {innerTypes.map((it) => renderSingleElement(it))}
          </div>,
        );
        innerGroupRendered = true;
      }
    });

    return finalElements;
  }, [
    order,
    outer,
    settings,
    activePokemon,
    triggerId,
    animationClass,
    nameStyle,
    counterStyle,
  ]);

  // FINAL CHECK: If no state yet and not in preview, show a loading placeholder or NOTHING.
  // But call all hooks above this!
  if (!activePokemon || !settings) {
    return (
      <div className="overlay-page min-h-screen flex items-center justify-center bg-transparent">
        <div className="text-white/20 text-xs font-bold uppercase tracking-[0.3em] animate-pulse">
          Warten auf Daten...
        </div>
      </div>
    );
  }

  return (
    <div className="overlay-page min-h-screen flex items-center justify-center bg-transparent">
      <div
        style={{
          backgroundColor: `${settings.background_color}${Math.round(
            settings.opacity * 255,
          )
            .toString(16)
            .padStart(2, "0")}`,
          borderWidth: settings.show_border ? "2px" : "0px",
          borderColor: "rgba(255,255,255,0.1)",
          backdropFilter: `blur(${settings.blur}px)`,
          display: "flex",
          flexDirection:
            settings.layout === "vertical"
              ? ("column" as const)
              : ("row" as const),
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          borderRadius: "2.5rem",
          gap: `${settings.gap}px`,
          transition: "all 0.3s ease",
        }}
        className="transition-all duration-300"
      >
        {elements}
      </div>
    </div>
  );
}
