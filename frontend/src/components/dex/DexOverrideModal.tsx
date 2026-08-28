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
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
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
import { GenderSelector } from "../pokemon/GenderSelector";
import { ConfirmModal } from "../shared/ConfirmModal";
import type { DexOverride } from "../../utils/dex";
import type { SetOverrideInput } from "../../hooks/useDexOverrides";
import type { CatchMeta } from "../../types";
import type { DexSpecimen, SpecimenInput } from "../../hooks/useDexSpecimens";
import { getAvailableHuntMethods } from "../../utils/huntTypes";
import { getGameName } from "../../utils/games";
import { DexPhaseSpecimenModal, HuntFactsFields, type PhaseDraft } from "./DexPhaseSpecimenModal";
import { nextSpecimenPhaseNumber, specimenPhaseChildren } from "../../utils/specimenPhase";

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
  /** Every specimen, not only this species': a phase usually belongs to another species. */
  readonly specimens?: DexSpecimen[];
  /** Writes one specimen and resolves with the persisted row, so a caller can attach children to a freshly created one. */
  readonly saveSpecimen?: (input: SpecimenInput) => Promise<DexSpecimen>;
  readonly removeSpecimen?: (id: number) => Promise<void>;
  readonly initialSpecimenId?: number;
  /** Called after the close transition finishes; unmount the modal here. */
  readonly onClose: () => void;
  /**
   * Preselects a form/gender scope, e.g. when opened from an existing
   * override row's own edit action rather than the species-level "add
   * manually" entry point. Defaults to the species-level scope (both "").
   */
  readonly initialFormCanonical?: string;
  /** See {@link DexOverrideModalProps.initialFormCanonical}. */
  readonly initialGender?: string;
  /**
   * Opens straight into the details editor instead of the caught/seen
   * picker, for a "edit details" entry point that already knows its scope
   * (an existing override row) and has no reason to show the picker first.
   */
  readonly autoOpenDetails?: boolean;
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
function hasGenderVariance(species: PokemonData | undefined): boolean {
  return species?.gender_rate !== undefined || species?.forms?.some((form) => Boolean(form.gender)) === true;
}

/**
 * Localized display label of a form's own canonical. PokeAPI never names a
 * gender-only pseudo-form (there is no in-game distinct form, just a sprite
 * difference), so the fallback below reuses the exact string PokeAPI's own
 * localization gives the equivalent *named* gender forms (verified against
 * the synced data for pyroar-female/meowstic-female/indeedee-female) rather
 * than leaking the raw PokeAPI slug.
 */
export function formCanonicalLabel(
  f: PokemonForm,
  locale: string,
  t: (key: string) => string,
): string {
  return (
    f.form_names?.[locale] ||
    f.form_names?.en ||
    (f.gender === "female" ? t("dex.genderFormFemale") : f.canonical)
  );
}

/** Localized label of one override row's form scope, resolved against the
 * species' known forms so an already-set override shows a real name instead
 * of its raw PokeAPI canonical. */
export function formLabel(
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
export function genderLabel(o: DexOverride, t: (key: string) => string): string {
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
  specimens = [],
  saveSpecimen,
  removeSpecimen,
  onClose,
  initialFormCanonical = "",
  initialGender = "",
  autoOpenDetails = false,
  initialSpecimenId,
}: DexOverrideModalProps) {
  const { t, locale } = useI18n();
  const { allPokemon, games } = usePokedex();
  const sourceSpecimen = specimens.find((candidate) => candidate.id === initialSpecimenId);
  const effectiveSpeciesId = sourceSpecimen?.species_id ?? speciesId;

  // Kept as the full species object, not just its `.forms`, because the
  // sprite-preview strip needs the species' own id/canonical for its
  // "default form" chip too.
  const species = useMemo(
    () => allPokemon.find((p) => p.id === effectiveSpeciesId),
    [allPokemon, effectiveSpeciesId],
  );
  const forms = species?.forms ?? [];
  const showGenderRadio = hasGenderVariance(species);

  const speciesOverrides = useMemo(
    () => overrides.filter((o) => o.speciesId === speciesId),
    [overrides, speciesId],
  );
  const sourceOverride = speciesOverrides.find(
    (o) => o.formCanonical === initialFormCanonical && o.gender === initialGender && o.game === "",
  );

  const [scope, setScope] = useState<Scope>({
    formCanonical: initialFormCanonical,
    gender: initialGender,
  });
  const specimenStoreEnabled = Boolean(saveSpecimen && removeSpecimen);
  const [draftCaught, setDraftCaught] = useState(Boolean(sourceSpecimen || sourceOverride?.caught));
  const [draftSeen, setDraftSeen] = useState(sourceOverride?.seen ?? false);
  const [draftMeta, setDraftMeta] = useState<CatchMeta | undefined>(sourceSpecimen?.meta ?? sourceOverride?.meta);
  const [completedAt, setCompletedAt] = useState(sourceSpecimen?.completed_at ?? "");
  const [game, setGame] = useState(sourceSpecimen?.game ?? "");
  const [huntType, setHuntType] = useState(sourceSpecimen?.hunt_type || "encounter");
  const [encounters, setEncounters] = useState(sourceSpecimen?.encounters ?? 0);
  const [timerMs, setTimerMs] = useState(sourceSpecimen?.timer_accumulated_ms ?? 0);
  const [saving, setSaving] = useState(false);
  const draftKeyPrefix = useId();
  const draftCounter = useRef(0);
  const nextDraftKey = () => `${draftKeyPrefix}-${draftCounter.current++}`;
  // Phases are edited as local drafts and only written on save, so cancelling
  // the modal discards them the same way it discards every other field.
  const [phaseDrafts, setPhaseDrafts] = useState<PhaseDraft[]>(() =>
    specimenPhaseChildren(specimens, sourceSpecimen?.id ?? 0).map((child) => ({
      key: `${draftKeyPrefix}-existing-${child.id}`,
      id: child.id,
      phase_number: child.phase_number ?? 0,
      species_id: child.species_id,
      form_canonical: child.form_canonical ?? "",
      gender: child.gender ?? "",
      completed_at: child.completed_at ?? "",
      encounters: child.encounters ?? 0,
      timer_accumulated_ms: child.timer_accumulated_ms ?? 0,
      meta: child.meta,
    })),
  );
  const [removedPhaseIds, setRemovedPhaseIds] = useState<number[]>([]);
  const [editingPhaseKey, setEditingPhaseKey] = useState<string | null>(null);
  const pendingPhaseRef = useRef<string | null>(null);
  // The body swap unmounts this modal's DOM, so the row that opened the phase
  // editor has to be refocused by hand once we are back.
  const returnFocusKeyRef = useRef<string | null>(null);
  const phaseRowRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());
  // Survives a partial failure: a retry must update the parent it just created
  // instead of posting a second one.
  const savedParentIdRef = useRef<number | undefined>(sourceSpecimen?.id);
  // True while the details sub-view (CatchMetaModal) is showing instead of
  // this modal's own caught/seen editor; see the render function below for
  // why this never stacks a second native <dialog>. Seeded from
  // `autoOpenDetails` so a caller that already knows its scope (an existing
  // override row's own edit action) can skip the picker screen entirely,
  // rather than mounting the picker just to immediately swap away from it.
  const [detailsOpen, setDetailsOpen] = useState(autoOpenDetails);
  // Set right before this modal's own dialog is asked to close so it can
  // reopen the details view instead of unmounting, mirroring the
  // `pendingEditRef` pattern DexDetailModal uses for the same reason: a
  // <dialog> close is animated, so the swap has to wait for that transition
  // to finish instead of happening in the same tick as the click.
  const pendingDetailsRef = useRef(false);
  // Same swap as `detailsOpen`/`pendingDetailsRef`, for the "really remove
  // this?" confirmation: a destructive action needs a real confirm step, and
  // that confirmation is itself a dialog, so it gets the same no-stacking
  // treatment.
  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
  const pendingConfirmRef = useRef(false);

  const toggleCaught = () => {
    const nextCaught = !draftCaught;
    setDraftCaught(nextCaught);
    if (nextCaught) setDraftSeen(true);
  };

  const toggleSeen = () => {
    // Seen is forced on while caught is true (caught implies seen), so this
    // toggle is only actionable in the unchecked-caught state.
    if (draftCaught) return;
    setDraftSeen((seen) => !seen);
  };

  const removeOverride = (o: DexOverride) =>
    setOverride({
      id: o.id,
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
    setDraftMeta(meta);
  };

  /** Persists every pending field together, moving an existing row atomically. */
  const saveOverride = async () => {
    if (saving) return;
    setSaving(true);
    try {
      let parentId = savedParentIdRef.current;
      if (draftCaught && saveSpecimen) {
        const saved = await saveSpecimen({
          id: parentId,
          species_id: effectiveSpeciesId,
          form_canonical: scope.formCanonical,
          gender: scope.gender,
          game,
          completed_at: completedAt,
          hunt_type: huntType,
          encounters,
          timer_accumulated_ms: timerMs,
          meta: draftMeta,
          // A PUT replaces the whole row, so an entry that is itself a phase
          // of another hunt has to carry its link through this edit.
          phase_of: sourceSpecimen?.phase_of,
          phase_number: sourceSpecimen?.phase_number,
        });
        // A caller that resolves with nothing leaves the id unknown; the
        // parent is still saved, only its phases cannot be attached this round.
        parentId = saved?.id ?? parentId;
        savedParentIdRef.current = parentId;
      } else if (sourceSpecimen && removeSpecimen) {
        await removeSpecimen(sourceSpecimen.id);
        parentId = undefined;
        savedParentIdRef.current = undefined;
      }
      if (removeSpecimen && removedPhaseIds.length > 0) {
        for (const id of removedPhaseIds) await removeSpecimen(id);
        setRemovedPhaseIds([]);
      }
      // Sequential, not parallel: the server derives a missing phase number
      // from the rows that already exist, so concurrent writes could hand out
      // the same number twice.
      if (parentId && saveSpecimen) {
        for (const draft of phaseDrafts) {
          if (draft.species_id === 0) continue;
          await saveSpecimen({
            id: draft.id,
            species_id: draft.species_id,
            form_canonical: draft.form_canonical,
            gender: draft.gender,
            game,
            completed_at: draft.completed_at,
            hunt_type: huntType,
            encounters: draft.encounters,
            timer_accumulated_ms: draft.timer_accumulated_ms,
            meta: draft.meta,
            phase_of: parentId,
            phase_number: draft.phase_number,
          });
        }
      }
      await setOverride({
        id: sourceOverride?.id,
        speciesId,
        formCanonical: scope.formCanonical,
        gender: scope.gender,
        game: "",
        caught: specimenStoreEnabled ? false : draftCaught,
        seen: draftSeen,
        meta: specimenStoreEnabled && draftCaught ? undefined : draftMeta,
      });
      onClose();
    } catch {
      setSaving(false);
    }
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

  /** Same close-then-reopen swap as {@link openDetails}, for one phase editor. */
  const openPhase = (key: string, requestClose: () => void) => {
    pendingPhaseRef.current = key;
    returnFocusKeyRef.current = key;
    requestClose();
  };

  /** Appends an empty draft with the next free number and opens its editor. */
  const addPhase = (requestClose: () => void) => {
    const key = nextDraftKey();
    const highest = phaseDrafts.reduce((max, draft) => Math.max(max, draft.phase_number), 0);
    setPhaseDrafts((drafts) => [
      ...drafts,
      {
        key,
        phase_number: highest + 1,
        species_id: 0,
        form_canonical: "",
        gender: "",
        completed_at: "",
        encounters: 0,
        timer_accumulated_ms: 0,
      },
    ]);
    openPhase(key, requestClose);
  };

  /** Drops a draft locally; an already persisted row is deleted on save.
   * Remaining phases keep their frozen numbers, so gaps stay, exactly as
   * undoing a real phase leaves the numbering of its siblings alone. */
  const removePhase = (key: string) => {
    const draft = phaseDrafts.find((entry) => entry.key === key);
    if (draft?.id) setRemovedPhaseIds((ids) => [...ids, draft.id!]);
    setPhaseDrafts((drafts) => drafts.filter((entry) => entry.key !== key));
  };

  useEffect(() => {
    if (editingPhaseKey || !returnFocusKeyRef.current) return;
    const target = phaseRowRefs.current.get(returnFocusKeyRef.current);
    returnFocusKeyRef.current = null;
    target?.focus();
  }, [editingPhaseKey]);

  /** Writes an edited draft back and returns to this modal. */
  const savePhaseDraft = (draft: PhaseDraft) => {
    setPhaseDrafts((drafts) => drafts.map((entry) => (entry.key === draft.key ? draft : entry)));
    setEditingPhaseKey(null);
  };

  /** Leaves the phase editor. A draft that never got a species is discarded,
   * so an abandoned "add" leaves no half-empty row behind. */
  const closePhaseEditor = (key: string) => {
    setPhaseDrafts((drafts) => drafts.filter((entry) => entry.key !== key || entry.species_id !== 0));
    setEditingPhaseKey(null);
  };

  /** Same close-then-reopen swap as {@link openDetails}, for the removal
   * confirmation instead of the details editor. */
  const openConfirmRemove = (requestClose: () => void) => {
    pendingConfirmRef.current = true;
    requestClose();
  };

  /**
   * ModalShell's onClose for this modal's own dialog. A close request that
   * was only meant to make room for the details view or the removal
   * confirmation reopens into whichever one instead of unmounting; every
   * other close request (Escape, backdrop, the header button) is the real
   * thing and runs the outer `onClose` prop.
   */
  const handleShellClose = () => {
    if (pendingDetailsRef.current) {
      pendingDetailsRef.current = false;
      setDetailsOpen(true);
      return;
    }
    if (pendingConfirmRef.current) {
      pendingConfirmRef.current = false;
      setConfirmRemoveOpen(true);
      return;
    }
    if (pendingPhaseRef.current) {
      const key = pendingPhaseRef.current;
      pendingPhaseRef.current = null;
      setEditingPhaseKey(key);
      return;
    }
    onClose();
  };

  /** Removes the current scope's override and closes the whole modal: once
   * it is gone there is nothing left here to keep editing. */
  const confirmRemove = async () => {
    if (!sourceOverride) return;
    await removeOverride(sourceOverride);
    setConfirmRemoveOpen(false);
    onClose();
  };

  // Only one native <dialog> is ever open at a time: while `detailsOpen` is
  // true this modal renders CatchMetaModal instead of its own ModalShell,
  // the same body-swap DexDetailModal uses for its own summary/full-list
  // toggle. Unlike DexDetailModal this component itself never unmounts
  // across the swap (it owns no parent-level "which modal is open" state to
  // hand this off to), so `scope` survives the round trip and the caught/seen
  // editor comes back exactly where the hunter left it.
  if (editingPhaseKey) {
    const draft = phaseDrafts.find((entry) => entry.key === editingPhaseKey);
    if (draft) {
      return (
        <DexPhaseSpecimenModal
          draft={draft}
          parentGame={game}
          parentHuntType={huntType}
          onSave={savePhaseDraft}
          onClose={() => closePhaseEditor(draft.key)}
        />
      );
    }
  }

  if (detailsOpen) {
    return (
      <CatchMetaModal
        pokemon={{
          id: `override:${speciesId}:${scope.formCanonical}:${scope.gender}`,
          name,
          // The metadata view gates its pickers on the game (ball availability,
          // Sword/Shield only fields), so it needs the one picked above.
          game,
          canonical_name: scope.formCanonical || species?.canonical || canonical,
          catch: draftMeta,
        }}
        mode="edit"
        onSubmit={handleMetaSubmit}
        onClose={() => setDetailsOpen(false)}
      />
    );
  }

  if (confirmRemoveOpen) {
    return (
      <ConfirmModal
        title={t("dex.confirmRemoveTitle")}
        message={t("dex.confirmRemoveMessage", { name })}
        isDestructive
        onConfirm={() => void confirmRemove()}
        onClose={() => setConfirmRemoveOpen(false)}
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
              <GenderSelector
                value={(scope.gender || undefined) as "male" | "female" | "genderless" | undefined}
                genderRate={species?.gender_rate}
                onChange={(gender) => setScope((s) => ({ ...s, gender: gender ?? "" }))}
              />
            </div>
          )}

          <div className="flex gap-2">
            <OverrideToggle
              label={t("dex.overrideCaught")}
              ariaLabel={t("aria.dexOverrideToggleCaught")}
              pressed={draftCaught}
              onClick={toggleCaught}
            />
            <OverrideToggle
              label={t("dex.overrideSeen")}
              ariaLabel={t("aria.dexOverrideToggleSeen")}
              pressed={draftSeen}
              disabled={draftCaught}
              onClick={toggleSeen}
            />
          </div>

          {draftCaught && (
            <div className="flex flex-col gap-3 border-t border-border-subtle pt-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="manual-catch-game" className="block text-xs text-text-muted mb-1">
                    {t("modal.game")}
                  </label>
                  <div className="t-select-wrap">
                    <select
                      id="manual-catch-game"
                      value={game}
                      onChange={(event) => {
                        const nextGame = event.target.value;
                        setGame(nextGame);
                        const methods = getAvailableHuntMethods(nextGame);
                        if (!methods.some((method) => method.key === huntType)) setHuntType(methods[0]?.key ?? "");
                      }}
                      className="t-select"
                    >
                      <option value="">{t("modal.noGame")}</option>
                      {games.map((entry) => (
                        <option key={entry.key} value={entry.key}>{getGameName(entry, [locale, "en"])}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label htmlFor="manual-catch-method" className="block text-xs text-text-muted mb-1">
                    {t("huntType.label")}
                  </label>
                  <div className="t-select-wrap">
                    <select id="manual-catch-method" value={huntType} onChange={(event) => setHuntType(event.target.value)} className="t-select">
                      {getAvailableHuntMethods(game).map((method) => (
                        <option key={method.key} value={method.key}>{t(`huntType.${method.key}`)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <HuntFactsFields
                completedAt={completedAt}
                onCompletedAt={setCompletedAt}
                encounters={encounters}
                onEncounters={setEncounters}
                timerMs={timerMs}
                onTimerMs={setTimerMs}
              />

              {specimenStoreEnabled && (
                <div className="flex flex-col gap-2 border-t border-border-subtle pt-3">
                  <h3 className="text-xs uppercase tracking-wider text-text-muted">{t("phase.historyTitle")}</h3>
                  {phaseDrafts.length === 0 ? (
                    <p className="text-xs text-text-faint">{t("phase.manualEmpty")}</p>
                  ) : (
                    <ul role="list" aria-label={t("aria.phaseList")} className="flex flex-col gap-1.5">
                      {phaseDrafts.map((draft) => {
                        const phaseSpecies = allPokemon.find((entry) => entry.id === draft.species_id);
                        const phaseForm = phaseSpecies?.forms?.find((form) => form.canonical === draft.form_canonical);
                        const label = phaseSpecies
                          ? getPkmnName(phaseForm ?? phaseSpecies, locale, t("dex.genderFormFemale"))
                          : "";
                        return (
                          <li key={draft.key} className="flex items-center gap-2 text-xs text-text-secondary">
                            <span className="t-label t-label--accent">{t("phase.badge", { number: draft.phase_number })}</span>
                            <span className="truncate">{label}</span>
                            <span className="tabular-nums text-text-faint">{draft.encounters}</span>
                            <button
                              type="button"
                              ref={(node) => { phaseRowRefs.current.set(draft.key, node); }}
                              onClick={() => openPhase(draft.key, requestClose)}
                              aria-label={t("aria.phaseEdit", { number: draft.phase_number })}
                              className="relative ml-auto min-h-[24px] min-w-[24px] text-text-muted hover:text-text-primary transition-colors after:absolute after:-inset-2 after:content-['']"
                            >
                              <Pencil size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={() => removePhase(draft.key)}
                              aria-label={t("aria.phaseRemoveEntry", { number: draft.phase_number })}
                              className="relative min-h-[24px] min-w-[24px] text-text-muted hover:text-accent-red transition-colors after:absolute after:-inset-2 after:content-['']"
                            >
                              <X size={12} />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <button
                    type="button"
                    onClick={() => addPhase(requestClose)}
                    className="self-start t-label min-h-[24px] px-2 text-text-muted hover:text-text-primary transition-colors"
                  >
                    {t("phase.addManual")}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Hidden rather than disabled while unset: a manual entry with no
              caught/seen flag has no override row to attach details to, and
              CatchMetaSummary's onEdit is already optional-hides-the-button,
              so gating it this way needs no change to that shared component. */}
          <CatchMetaSummary
            meta={draftMeta}
            gender={scope.gender as "male" | "female" || undefined}
            originCanonical={scope.formCanonical || canonical}
            onEdit={(sourceOverride || sourceSpecimen || draftCaught || draftSeen) ? () => openDetails(requestClose) : undefined}
          />

          {/* Every other manually marked scope of this species is listed on
              its own card in the species panel, each with its own edit icon
              (which opens this modal already scoped to it). Removing one
              only ever happens from there, not from a second list bundled
              into this "add a new one" dialog. */}
          <div className="flex gap-2">
            {sourceOverride && (
              <button
                type="button"
                onClick={() => openConfirmRemove(requestClose)}
                className="t-cut min-h-[32px] flex-1 border border-border-subtle px-3 py-2 text-xs text-text-muted transition-colors hover:border-accent-red hover:text-accent-red"
              >
                {t("dex.overrideRemove")}
              </button>
            )}
            <button
              type="button"
              onClick={() => void saveOverride()}
              disabled={saving}
              className="t-cut min-h-[32px] flex-1 border border-accent-blue/50 bg-accent-blue/10 px-3 py-2 text-xs text-accent-blue transition-colors hover:bg-accent-blue/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("common.save")}
            </button>
          </div>
        </div>
      )}
    </ModalShell>
  );
}
