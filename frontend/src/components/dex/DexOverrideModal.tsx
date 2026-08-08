/**
 * DexOverrideModal.tsx: manual caught/seen marking for one Pokédex species.
 *
 * The dex only ever shows a species as caught when an archived catch resolves
 * onto its slot, which leaves no way to record a species caught before this
 * app existed, or on a cartridge that is never going to be logged through it.
 * This modal is that escape hatch: pick a form/gender scope (or leave it at
 * species level) and flip "Caught"/"Seen" independently. Every override this
 * modal writes is global (no game scope), the simplest, most useful default
 * for marking something that was never hunted through the app in the first
 * place; a per-game scope is a real backend capability but there is no
 * "current game" to default it to here, since this modal is deliberately
 * self-contained and does not thread the dex page's game filter down to it.
 */
import { useId, useMemo, useRef, useState } from "react";
import { useI18n } from "../../contexts/I18nContext";
import { ModalShell } from "../shared/ModalShell";
import { SpeciesHeader } from "./DexSpeciesDetail";
import {
  usePokedex,
  formEntriesFor,
  getPkmnName,
  PokemonThumb,
  type PokemonData,
  type PokemonForm,
} from "../pokemon/pokemonPicker";
import { CatchMetaSummary } from "../pokemon/CatchMetaSummary";
import { CatchMetaModal } from "../pokemon/CatchMetaModal";
import type { DexOverride } from "../../utils/dex";
import type { SetOverrideInput } from "../../hooks/useDexOverrides";
import type { CatchMeta } from "../../types";

/** Props for {@link DexOverrideModal}. */
export interface DexOverrideModalProps {
  /** National Dex number of the species being marked. */
  readonly speciesId: number;
  /** English PokéAPI slug of the base species. */
  readonly canonical: string;
  /** Localized species name, used in the header and dialog title. */
  readonly name: string;
  /** Generation the species was introduced in. */
  readonly generation: number;
  /** True when the species already carries at least one real catch. */
  readonly caught: boolean;
  /** Every override of this species, across every form/gender scope. */
  readonly overrides: DexOverride[];
  /** Writes one override; see {@link useDexOverrides}. */
  readonly setOverride: (input: SetOverrideInput) => Promise<void>;
  /** Called after the close transition finishes; unmount the modal here. */
  readonly onClose: () => void;
}

/** One scoping selection: species-level form/gender, always global (no game). */
interface Scope {
  formCanonical: string;
  gender: string;
}

/** Gender options in display order; "" means "not gender-restricted". */
const GENDER_OPTIONS: { value: string; key: string }[] = [
  { value: "", key: "dex.genderAny" },
  { value: "male", key: "dex.genderMale" },
  { value: "female", key: "dex.genderFemale" },
];

/** True when at least one form of the species is gender-restricted. */
function hasGenderVariance(forms: PokemonForm[]): boolean {
  return forms.some((f) => Boolean(f.gender));
}

/**
 * Localized display label of a form's own canonical. PokeAPI never names a
 * gender-only pseudo-form (there is no in-game distinct form, just a sprite
 * difference), so the fallback below reuses the exact string PokeAPI's own
 * localization gives the equivalent *named* gender forms (verified against
 * the synced data for pyroar-female/meowstic-female/indeedee-female) rather
 * than leaking the raw PokeAPI slug.
 */
function formCanonicalLabel(f: PokemonForm, locale: string, t: (key: string) => string): string {
  return (
    f.form_names?.[locale] ||
    f.form_names?.en ||
    (f.gender === "female" ? t("dex.genderFormFemale") : f.canonical)
  );
}

/** Localized label of one override row's form scope, resolved against the
 * species' known forms so an already-set override shows a real name instead
 * of its raw PokeAPI canonical. */
function formLabel(
  o: DexOverride,
  forms: PokemonForm[],
  locale: string,
  t: (key: string) => string,
): string {
  if (!o.formCanonical) return t("dex.defaultForm");
  const form = forms.find((f) => f.canonical === o.formCanonical);
  return form ? formCanonicalLabel(form, locale, t) : o.formCanonical;
}

/** Localized label of one override row's gender scope. */
function genderLabel(o: DexOverride, t: (key: string) => string): string {
  const option = GENDER_OPTIONS.find((g) => g.value === o.gender);
  return t(option?.key ?? "dex.genderAny");
}

interface GenderRadioGroupProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/**
 * Three-way gender scope as a real radio group: one tab stop, arrow keys move
 * and select. Mirrors the roving-tabindex pattern of the dex page's own
 * caught-state filter.
 */
function GenderRadioGroup({ value, onChange }: GenderRadioGroupProps) {
  const { t } = useI18n();

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const current = GENDER_OPTIONS.findIndex((option) => option.value === value);
    const next = (current + step + GENDER_OPTIONS.length) % GENDER_OPTIONS.length;
    onChange(GENDER_OPTIONS[next].value);
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("aria.genderSelector")}
      onKeyDown={handleKeyDown}
      className="flex flex-wrap items-center gap-1.5"
    >
      {GENDER_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value || "any"}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={`t-label min-h-[24px] px-2 transition-colors ${
              active ? "t-label--accent" : "hover:text-text-primary"
            }`}
          >
            {t(option.key)}
          </button>
        );
      })}
    </div>
  );
}

interface FormChipProps {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly label: string;
  readonly spriteId: number;
  readonly canonical: string;
  readonly spriteSlug?: string;
  readonly gender?: "male" | "female";
}

/**
 * One form-strip chip: sprite thumbnail plus label, active state carried by
 * both the border/background and `aria-pressed` (never colour alone).
 * Mirrors the chip markup of `PokemonSearchPicker`'s own form strip exactly,
 * since the user asked for "the same as the Pokédex catch modal".
 */
function FormChip({ active, onClick, label, spriteId, canonical, spriteSlug, gender }: FormChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-1.5 min-h-[24px] px-2 py-1 rounded-none border text-xs transition-colors ${
        active
          ? "border-accent-blue/40 bg-accent-blue/10 text-accent-blue"
          : "border-border-subtle text-text-muted hover:text-text-primary"
      }`}
    >
      <PokemonThumb
        spriteId={spriteId}
        canonical={canonical}
        spriteSlug={spriteSlug}
        gender={gender}
        alt=""
        className="h-6 w-6 object-contain shrink-0"
      />
      <span className="capitalize truncate max-w-[10rem]">{label}</span>
    </button>
  );
}

interface FormStripProps {
  readonly species: PokemonData;
  readonly value: string;
  readonly onChange: (formCanonical: string) => void;
}

/**
 * Sprite-preview form picker, replacing a plain `<select>` with the same
 * chip-strip interaction as `PokemonSearchPicker`'s form strip: a leading
 * "default form" chip (the species' own sprite) followed by one chip per
 * game-filtered form. No active game is known inside this modal, so
 * `formEntriesFor` is called with `""`/`[]`, which is also what the removed
 * `<select>` passed to `isFormAvailableForGame` before.
 */
function FormStrip({ species, value, onChange }: FormStripProps) {
  const { t, locale } = useI18n();
  const forms = useMemo(() => formEntriesFor(species, "", [], locale), [species, locale]);
  if (forms.length === 0) return null;

  return (
    <div>
      <span className="block text-xs text-text-muted mb-1">{t("dex.overrideForm")}</span>
      <div className="flex flex-wrap gap-1.5">
        <FormChip
          active={value === ""}
          onClick={() => onChange("")}
          label={t("dex.defaultForm")}
          spriteId={species.id}
          canonical={species.canonical}
        />
        {forms.map((f) => (
          <FormChip
            key={f.canonical}
            active={value === f.canonical}
            onClick={() => onChange(f.canonical)}
            label={f.formName || getPkmnName(f, locale, t("dex.genderFormFemale"))}
            spriteId={f.spriteId}
            canonical={f.canonical}
            spriteSlug={f.spriteSlug}
            gender={f.gender}
          />
        ))}
      </div>
    </div>
  );
}

interface OverrideToggleProps {
  readonly label: string;
  readonly ariaLabel: string;
  readonly pressed: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

/** One independent caught/seen toggle button, mirroring the dex mode switch. */
function OverrideToggle({ label, ariaLabel, pressed, disabled, onClick }: OverrideToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={`min-h-[32px] flex-1 rounded-none border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        pressed
          ? "border-accent-blue/50 bg-accent-blue/10 text-accent-blue"
          : "border-border-subtle text-text-muted hover:text-text-primary"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Manual caught/seen marking for one species, inside the shared modal shell.
 *
 * Every write goes through `setOverride`, which persists to the backend and
 * updates the caller's override list optimistically, so the toggle states and
 * the "already set" list below stay in sync without a refetch.
 */
export function DexOverrideModal({
  speciesId,
  canonical,
  name,
  generation,
  caught,
  overrides,
  setOverride,
  onClose,
}: DexOverrideModalProps) {
  const { t, locale } = useI18n();
  const { allPokemon } = usePokedex();
  const existingHeadingId = useId();

  // Kept as the full species object, not just its `.forms`, because the
  // sprite-preview strip needs the species' own id/canonical for its
  // "default form" chip too.
  const species = useMemo(
    () => allPokemon.find((p) => p.id === speciesId),
    [allPokemon, speciesId],
  );
  const forms = species?.forms ?? [];
  const showGenderRadio = hasGenderVariance(forms);

  const [scope, setScope] = useState<Scope>({ formCanonical: "", gender: "" });
  // True while the details sub-view (CatchMetaModal) is showing instead of
  // this modal's own caught/seen editor; see the render function below for
  // why this never stacks a second native <dialog>.
  const [detailsOpen, setDetailsOpen] = useState(false);
  // Set right before this modal's own dialog is asked to close so it can
  // reopen the details view instead of unmounting, mirroring the
  // `pendingEditRef` pattern DexDetailModal uses for the same reason: a
  // <dialog> close is animated, so the swap has to wait for that transition
  // to finish instead of happening in the same tick as the click.
  const pendingDetailsRef = useRef(false);

  const speciesOverrides = useMemo(
    () => overrides.filter((o) => o.speciesId === speciesId),
    [overrides, speciesId],
  );
  const current = speciesOverrides.find(
    (o) => o.formCanonical === scope.formCanonical && o.gender === scope.gender && o.game === "",
  );
  const isCaught = current?.caught ?? false;
  const isSeen = current?.seen ?? false;

  // setOverride rethrows on a failed save (see useDexOverrides), so it can be
  // awaited by a caller that wants to react to the failure. This modal has no
  // such reaction beyond the hook's own `error` state, and none of these
  // handlers are awaited by their callers, so an uncaught rejection here
  // would surface as an unhandled promise rejection instead.
  const toggleCaught = async () => {
    const nextCaught = !isCaught;
    await setOverride({
      speciesId,
      formCanonical: scope.formCanonical,
      gender: scope.gender,
      game: "",
      caught: nextCaught,
      // Caught implies seen; unchecking caught leaves an independently set
      // seen flag alone.
      seen: nextCaught || isSeen,
    }).catch(() => {});
  };

  const toggleSeen = async () => {
    // Seen is forced on while caught is true (caught implies seen), so this
    // toggle is only actionable in the unchecked-caught state.
    if (isCaught) return;
    await setOverride({
      speciesId,
      formCanonical: scope.formCanonical,
      gender: scope.gender,
      game: "",
      caught: false,
      seen: !isSeen,
    }).catch(() => {});
  };

  const removeOverride = (o: DexOverride) =>
    setOverride({
      speciesId,
      formCanonical: o.formCanonical,
      gender: o.gender,
      game: o.game,
      caught: false,
      seen: false,
    }).catch(() => {});

  /**
   * Persists the details editor's submission alongside the caught/seen flags
   * already set for the current scope, so editing details never changes
   * them. `id` is the synthetic pokemon id CatchMetaModal was seeded with; it
   * carries no meaning here, the real target is `scope`.
   */
  const handleMetaSubmit = async (_id: string, meta: CatchMeta) => {
    await setOverride({
      speciesId,
      formCanonical: scope.formCanonical,
      gender: scope.gender,
      game: "",
      caught: isCaught,
      seen: isSeen,
      meta,
    });
  };

  /**
   * Requests this modal's own dialog to close and marks the pending reason as
   * "reopen into the details view" rather than "close for good". The actual
   * swap happens once `requestClose`'s animation finishes and this modal's
   * own onClose fires, see `handleShellClose` below.
   */
  const openDetails = (requestClose: () => void) => {
    pendingDetailsRef.current = true;
    requestClose();
  };

  /**
   * ModalShell's onClose for this modal's own dialog. A close request that
   * was only meant to make room for the details view reopens into it instead
   * of unmounting; every other close request (Escape, backdrop, the header
   * button) is the real thing and runs the outer `onClose` prop.
   */
  const handleShellClose = () => {
    if (pendingDetailsRef.current) {
      pendingDetailsRef.current = false;
      setDetailsOpen(true);
      return;
    }
    onClose();
  };

  // Only one native <dialog> is ever open at a time: while `detailsOpen` is
  // true this modal renders CatchMetaModal instead of its own ModalShell,
  // the same body-swap DexDetailModal uses for its own summary/full-list
  // toggle. Unlike DexDetailModal this component itself never unmounts
  // across the swap (it owns no parent-level "which modal is open" state to
  // hand this off to), so `scope` survives the round trip and the caught/seen
  // editor comes back exactly where the hunter left it.
  if (detailsOpen) {
    return (
      <CatchMetaModal
        pokemon={{
          id: `override:${speciesId}:${scope.formCanonical}:${scope.gender}`,
          game: "",
          catch: current?.meta,
        }}
        mode="edit"
        onSubmit={handleMetaSubmit}
        onClose={() => setDetailsOpen(false)}
      />
    );
  }

  return (
    <ModalShell title={t("dex.overrideModalTitle", { name })} onClose={handleShellClose}>
      {(requestClose) => (
        <div className="flex flex-col gap-4">
          <SpeciesHeader id={speciesId} canonical={canonical} name={name} generation={generation} caught={caught} />

          {species && (
            <FormStrip
              species={species}
              value={scope.formCanonical}
              onChange={(formCanonical) => setScope((s) => ({ ...s, formCanonical }))}
            />
          )}

          {showGenderRadio && (
            <div>
              <span className="block text-xs text-text-muted mb-1">{t("dex.overrideGender")}</span>
              <GenderRadioGroup
                value={scope.gender}
                onChange={(gender) => setScope((s) => ({ ...s, gender }))}
              />
            </div>
          )}

          <div className="flex gap-2">
            <OverrideToggle
              label={t("dex.overrideCaught")}
              ariaLabel={t("aria.dexOverrideToggleCaught")}
              pressed={isCaught}
              onClick={() => void toggleCaught()}
            />
            <OverrideToggle
              label={t("dex.overrideSeen")}
              ariaLabel={t("aria.dexOverrideToggleSeen")}
              pressed={isSeen}
              disabled={isCaught}
              onClick={() => void toggleSeen()}
            />
          </div>

          {/* Hidden rather than disabled while unset: a manual entry with no
              caught/seen flag has no override row to attach details to, and
              CatchMetaSummary's onEdit is already optional-hides-the-button,
              so gating it this way needs no change to that shared component. */}
          <CatchMetaSummary
            meta={current?.meta}
            onEdit={current ? () => openDetails(requestClose) : undefined}
          />

          {speciesOverrides.length > 0 && (
            <section aria-labelledby={existingHeadingId} className="flex flex-col gap-2">
              <h3 id={existingHeadingId} className="t-label w-fit">
                {t("dex.overrideExisting")}
              </h3>
              <ul role="list" className="flex flex-col gap-1.5">
                {speciesOverrides.map((o) => (
                  <li
                    key={`${o.formCanonical}|${o.gender}|${o.game}`}
                    className="flex items-center justify-between gap-2 bg-bg-secondary px-3 py-1.5 text-xs text-text-secondary"
                  >
                    <span className="truncate">
                      {formLabel(o, forms, locale, t)} · {genderLabel(o, t)} ·{" "}
                      {o.caught ? t("dex.overrideCaught") : t("dex.overrideSeen")}
                    </span>
                    <button
                      type="button"
                      onClick={() => void removeOverride(o)}
                      className="t-cut shrink-0 border border-border-subtle px-2 py-1 text-[11px] text-text-muted transition-colors hover:border-accent-red hover:text-accent-red"
                    >
                      {t("dex.overrideRemove")}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </ModalShell>
  );
}
