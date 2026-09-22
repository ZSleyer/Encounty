import { useCallback, useMemo, useRef, useState } from "react";
import { EntryHotkeyAction, EntryHotkeys, Group, Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { isPhaseEntry } from "../../utils/phase";
import { useHotkeyRecorder } from "../../hooks/useHotkeyRecorder";
import { HotkeyRejection, readRejection, Translate, writeHotkey } from "./hotkeyActions";
import { HotkeyRecordingBanner, HotkeyRowMessage, HotkeySlot } from "./HotkeyRow";

// --- Entry model ---

/** Which backend collection an entry writes to. */
type EntryKind = "pokemon" | "group";

/** The counter actions a single hunt or group can bind, in display order. */
const ENTRY_ACTIONS: EntryHotkeyAction[] = ["increment", "decrement", "reset"];

/** One bindable action of one entry. */
interface HotkeySlotSpec {
  /** Stable slot id, "<kind>:<id>:<action>". Also keys the overrides. */
  slotId: string;
  /** Localized action name, e.g. "+1 Encounter". */
  actionLabel: string;
  /** "<entry>, <action>", the accessible name the buttons and the banner use. */
  slotName: string;
  /** Combo stored on the entry in the last state snapshot. */
  stored: string;
}

/** One bindable entry: a running hunt or a group, with its three slots. */
interface HotkeyEntry {
  kind: EntryKind;
  id: string;
  name: string;
  slots: HotkeySlotSpec[];
}

/**
 * A hunt is bindable while it is still being hunted. Finished, failed and
 * frozen phase entries are excluded: their counter no longer moves.
 */
function isRunningHunt(p: Pokemon): boolean {
  return !p.completed_at && !p.failed && !isPhaseEntry(p);
}

function toEntry(
  kind: EntryKind,
  id: string,
  name: string,
  hotkeys: EntryHotkeys | undefined,
  t: Translate,
): HotkeyEntry {
  const slots = ENTRY_ACTIONS.map((action) => {
    const actionLabel = t(`hotkeys.${action}`);
    return {
      slotId: `${kind}:${id}:${action}`,
      actionLabel,
      slotName: t("hotkeys.slotName", { name, action: actionLabel }),
      stored: hotkeys?.[action] ?? "",
    };
  });
  return { kind, id, name, slots };
}

/** Maps a slot id back onto the endpoint that owns that binding. */
function endpointFor(slotId: string): string {
  // The id in the middle is opaque, so the kind is read from the front and the
  // action from the back instead of splitting on every separator.
  const kindEnd = slotId.indexOf(":");
  const actionStart = slotId.lastIndexOf(":");
  const kind = slotId.slice(0, kindEnd);
  const id = slotId.slice(kindEnd + 1, actionStart);
  return `/api/hotkeys/${kind}/${id}/${slotId.slice(actionStart + 1)}`;
}

/** A refused write, pinned to the slot that caused it. */
type SlotFeedback = HotkeyRejection & { slotId: string };

// --- Entry card ---

interface HotkeyEntryCardProps {
  entry: HotkeyEntry;
  /** Optimistic combos, keyed by slot id. They outrank the snapshot. */
  overrides: Record<string, string>;
  /** Slot currently capturing, page-wide. */
  recording: string | null;
  liveModifiers: string;
  feedback: SlotFeedback | null;
  onRecord: (slotId: string) => void;
  onCancel: () => void;
  onClear: (slotId: string) => void;
  registerRecordButton: (slotId: string, el: HTMLButtonElement | null) => void;
}

/**
 * One hunt or group as a single card: the entry name once, with its three
 * action slots stacked underneath. Naming the entry once keeps the page short
 * with many hunts, and the group role hands that name to a screen reader when
 * the focus moves into a slot.
 */
function HotkeyEntryCard({
  entry,
  overrides,
  recording,
  liveModifiers,
  feedback,
  onRecord,
  onCancel,
  onClear,
  registerRecordButton,
}: Readonly<HotkeyEntryCardProps>) {
  const { t } = useI18n();
  const headingId = `hotkey-entry-${entry.kind}-${entry.id}`;
  const isRecordingHere = entry.slots.some((slot) => slot.slotId === recording);

  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className={`bg-bg-secondary rounded-lg px-4 py-3 border transition-colors ${
        isRecordingHere ? "border-accent-blue/50" : "border-transparent"
      }`}
    >
      {/* No truncation: a cut-off nickname would hide which hunt a key binds. */}
      <h4 id={headingId} className="text-sm 2xl:text-base font-medium text-text-primary mb-1">
        {entry.name}
      </h4>

      {entry.slots.map((slot) => (
        <HotkeySlot
          key={slot.slotId}
          actionLabel={slot.actionLabel}
          combo={overrides[slot.slotId] ?? slot.stored}
          isRecording={recording === slot.slotId}
          liveModifiers={liveModifiers}
          recordAriaLabel={t("hotkeys.recordFor", { name: slot.slotName })}
          cancelAriaLabel={t("hotkeys.cancelFor", { name: slot.slotName })}
          clearAriaLabel={t("hotkeys.deleteFor", { name: slot.slotName })}
          recordTitle={t("hotkeys.tooltipRecord")}
          clearTitle={t("hotkeys.tooltipDelete")}
          onRecord={() => onRecord(slot.slotId)}
          onCancel={onCancel}
          onClear={() => onClear(slot.slotId)}
          recordButtonRef={(el) => {
            registerRecordButton(slot.slotId, el);
          }}
          message={
            feedback?.slotId === slot.slotId ? (
              <HotkeyRowMessage conflict={feedback.conflict} text={feedback.text} />
            ) : null
          }
        />
      ))}
    </div>
  );
}

// --- Section ---

interface HuntHotkeySettingsProps {
  /** Every Pokémon in the snapshot; the running hunts are picked out here. */
  pokemon: Pokemon[];
  groups: Group[];
}

/**
 * HuntHotkeySettings binds the increment, decrement and reset hotkeys of every
 * running hunt and every group. Unlike the global hotkeys these act on their
 * own entry, whatever the current hotkey target happens to be.
 */
export function HuntHotkeySettings({ pokemon, groups }: Readonly<HuntHotkeySettingsProps>) {
  const { t } = useI18n();
  // Written through optimistically: the backend owns the binding, but the
  // snapshot prop only catches up on the next state broadcast.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<SlotFeedback | null>(null);
  const recordButtons = useRef(new Map<string, HTMLButtonElement | null>());

  const huntEntries = useMemo(
    () => pokemon.filter(isRunningHunt).map((p) => toEntry("pokemon", p.id, p.name, p.hotkeys, t)),
    [pokemon, t],
  );
  const groupEntries = useMemo(
    () =>
      [...groups]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((g) => toEntry("group", g.id, g.name, g.hotkeys, t)),
    [groups, t],
  );
  const allSlots = useMemo(
    () => [...huntEntries, ...groupEntries].flatMap((entry) => entry.slots),
    [huntEntries, groupEntries],
  );

  const apply = useCallback((slotId: string, combo: string) => {
    setOverrides((prev) => ({ ...prev, [slotId]: combo }));
    globalThis.electronAPI?.syncHotkeys?.();
  }, []);

  const commitRecording = useCallback(
    async (slotId: string, combo: string) => {
      setFeedback(null);
      const res = await writeHotkey(endpointFor(slotId), combo);
      if (res.ok) {
        apply(slotId, combo);
        return;
      }
      setFeedback({ slotId, ...(await readRejection(res, t)) });
    },
    [apply, t],
  );

  const { recording, liveModifiers, start, cancel } = useHotkeyRecorder<string>(commitRecording);

  const startRecording = useCallback(
    (slotId: string) => {
      setFeedback(null);
      start(slotId);
    },
    [start],
  );

  const clearBinding = useCallback(
    async (slotId: string) => {
      setFeedback(null);
      const res = await writeHotkey(endpointFor(slotId), "");
      if (!res.ok) {
        setFeedback({ slotId, ...(await readRejection(res, t)) });
        return;
      }
      // The clear button unmounts with the binding, so move focus to the record
      // button of the same slot while it is still on screen.
      recordButtons.current.get(slotId)?.focus();
      apply(slotId, "");
    },
    [apply, t],
  );

  const registerRecordButton = useCallback((slotId: string, el: HTMLButtonElement | null) => {
    recordButtons.current.set(slotId, el);
  }, []);

  const renderEntry = (entry: HotkeyEntry) => (
    <HotkeyEntryCard
      key={`${entry.kind}:${entry.id}`}
      entry={entry}
      overrides={overrides}
      recording={recording}
      liveModifiers={liveModifiers}
      feedback={feedback}
      onRecord={startRecording}
      onCancel={cancel}
      onClear={clearBinding}
      registerRecordButton={registerRecordButton}
    />
  );

  if (huntEntries.length === 0 && groupEntries.length === 0) {
    return <p className="text-xs 2xl:text-sm text-text-muted">{t("hotkeys.huntEmpty")}</p>;
  }

  const recordingName = allSlots.find((slot) => slot.slotId === recording)?.slotName ?? "";

  return (
    <div className="space-y-4">
      <p className="text-xs 2xl:text-sm text-text-secondary">{t("hotkeys.huntSectionDesc")}</p>

      {huntEntries.length > 0 && (
        <section aria-labelledby="hunt-hotkeys-hunts" className="space-y-3">
          <h3 id="hunt-hotkeys-hunts" className="text-xs font-semibold text-text-muted uppercase">
            {t("hotkeys.huntsLabel")}
          </h3>
          {huntEntries.map(renderEntry)}
        </section>
      )}

      {groupEntries.length > 0 && (
        <section aria-labelledby="hunt-hotkeys-groups" className="space-y-3">
          <h3 id="hunt-hotkeys-groups" className="text-xs font-semibold text-text-muted uppercase">
            {t("hotkeys.groupsLabel")}
          </h3>
          {groupEntries.map(renderEntry)}
        </section>
      )}

      {recording && (
        <HotkeyRecordingBanner entryName={recordingName} liveModifiers={liveModifiers} />
      )}
    </div>
  );
}
