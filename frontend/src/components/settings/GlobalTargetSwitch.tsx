/**
 * GlobalTargetSwitch.tsx, the explicit "global hotkeys act on" control at the
 * top of the global hotkey section. It shows the current target and switches
 * it among the running hunts and the groups, the same way the globe buttons
 * in the sidebar do.
 */
import { useId, useState } from "react";
import type { Group, Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { KeyCombo } from "../shared/KeyCombo";
import { sidebarSpriteUrl } from "../dashboard/presentation";
import { huntIdentity, isRunningHunt } from "./hotkeyActions";

/** A chosen target, or null for "no target". */
export type GlobalTarget = { kind: "pokemon" | "group"; id: string } | null;

interface GlobalTargetSwitchProps {
  pokemon: Pokemon[];
  groups: Group[];
  /** Hunt currently targeted, empty when none or when a group is. */
  activeId: string;
  /** Group currently targeted, empty when none or when a hunt is. */
  activeGroupId: string;
  /** Combo bound to "Next Pokémon", the keyboard way to cycle the target. */
  nextPokemonCombo: string;
  onSelect: (target: GlobalTarget) => void;
}

/** Encodes the current target as a select value. */
function currentValue(activeId: string, activeGroupId: string): string {
  if (activeId) return `pokemon:${activeId}`;
  if (activeGroupId) return `group:${activeGroupId}`;
  return "";
}

/** Decodes a select value back into a target. */
function parseValue(value: string): GlobalTarget {
  const sep = value.indexOf(":");
  if (sep === -1) return null;
  const kind = value.slice(0, sep) === "group" ? "group" : "pokemon";
  return { kind, id: value.slice(sep + 1) };
}

/**
 * GlobalTargetSwitch is a native select, grouped into hunts and groups, with
 * the target's sprite or colour next to it. A hunt option carries the game,
 * so two hunts of the same species stay distinguishable. The current target
 * is listed even when it is no longer a running hunt, so the select never
 * shows a value that differs from the real state.
 */
export function GlobalTargetSwitch({
  pokemon,
  groups,
  activeId,
  activeGroupId,
  nextPokemonCombo,
  onSelect,
}: Readonly<GlobalTargetSwitchProps>) {
  const { t } = useI18n();
  const selectId = useId();
  const [imgError, setImgError] = useState<Record<string, string>>({});

  const hunts = pokemon.filter((p) => isRunningHunt(p) || p.id === activeId);
  const sortedGroups = [...groups].sort((a, b) => a.sort_order - b.sort_order);
  const activeHunt = pokemon.find((p) => p.id === activeId);
  const activeGroup = groups.find((g) => g.id === activeGroupId);
  const spriteSrc = activeHunt ? sidebarSpriteUrl(activeHunt, imgError) : "";

  return (
    <div className="bg-bg-secondary rounded-lg px-3 py-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <label htmlFor={selectId} className="text-sm 2xl:text-base text-text-secondary">
          {t("hotkeys.targetLabel")}
        </label>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Decorative: the select already names the target. */}
          {activeHunt && (
            <img
              src={spriteSrc}
              alt=""
              onError={() => setImgError({ [activeHunt.id]: spriteSrc })}
              className="pokemon-sprite w-8 h-8 object-contain shrink-0"
            />
          )}
          {activeGroup && (
            <span className="w-8 h-8 flex items-center justify-center shrink-0" aria-hidden="true">
              <span
                className="w-2.5 h-2.5 rounded-sm border border-black/20"
                style={{ backgroundColor: activeGroup.color || "#6b7280" }}
              />
            </span>
          )}
          <select
            id={selectId}
            value={currentValue(activeId, activeGroupId)}
            onChange={(e) => onSelect(parseValue(e.target.value))}
            className="min-w-0 flex-1 max-w-sm h-9 bg-bg-primary border border-border-input rounded-md px-2 text-sm text-text-primary hover:border-border-default transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
          >
            <option value="">{t("hotkeys.targetNone")}</option>
            {hunts.length > 0 && (
              <optgroup label={t("hotkeys.huntsLabel")}>
                {hunts.map((p) => {
                  const { name, meta } = huntIdentity(p);
                  return (
                    <option key={p.id} value={`pokemon:${p.id}`}>
                      {meta ? `${name} · ${meta}` : name}
                    </option>
                  );
                })}
              </optgroup>
            )}
            {sortedGroups.length > 0 && (
              <optgroup label={t("hotkeys.groupsLabel")}>
                {sortedGroups.map((g) => (
                  <option key={g.id} value={`group:${g.id}`}>
                    {g.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
      </div>

      <p className="text-xs 2xl:text-sm text-text-muted flex flex-wrap items-center gap-1.5">
        {nextPokemonCombo ? (
          <>
            {t("hotkeys.targetCycle")}
            <KeyCombo combo={nextPokemonCombo} size="sm" kind="global" />
          </>
        ) : (
          t("hotkeys.targetCycleUnbound")
        )}
      </p>
      <p className="text-xs 2xl:text-sm text-text-muted">{t("hotkeys.bothKindsNote")}</p>
    </div>
  );
}
