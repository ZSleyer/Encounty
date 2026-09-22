import { useCallback, useMemo, useRef, useState } from "react";
import { Group, Pokemon } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { isPhaseEntry } from "../../utils/phase";
import { useHotkeyRecorder } from "../../hooks/useHotkeyRecorder";
import { HotkeyRejection, readRejection, writeHotkey } from "./hotkeyActions";
import { HotkeyRecordingBanner, HotkeyRow, HotkeyRowMessage } from "./HotkeyRow";

// --- Row model ---

/** Which backend collection a row writes to. */
type RowKind = "pokemon" | "group";

/** One bindable entry: a running hunt or a group. */
interface HotkeyEntry {
  /** Stable row id, "<kind>:<id>". Also keys the optimistic overrides. */
  rowId: string;
  kind: RowKind;
  id: string;
  name: string;
  /** Combo stored on the entry in the last state snapshot. */
  combo: string;
}

/**
 * A hunt is bindable while it is still being hunted. Finished, failed and
 * frozen phase entries are excluded: their counter no longer moves.
 */
function isRunningHunt(p: Pokemon): boolean {
  return !p.completed_at && !p.failed && !isPhaseEntry(p);
}

function toEntry(kind: RowKind, id: string, name: string, combo?: string): HotkeyEntry {
  return { rowId: `${kind}:${id}`, kind, id, name, combo: combo ?? "" };
}

/** A refused write, pinned to the row that caused it. */
type RowFeedback = HotkeyRejection & { rowId: string };

interface HuntHotkeySettingsProps {
  /** Every Pokémon in the snapshot; the running hunts are picked out here. */
  pokemon: Pokemon[];
  groups: Group[];
}

// --- Section ---

/**
 * HuntHotkeySettings binds one optional hotkey per running hunt and per group.
 * Unlike the global hotkeys these act on their own entry, whatever the current
 * hotkey target happens to be.
 */
export function HuntHotkeySettings({ pokemon, groups }: Readonly<HuntHotkeySettingsProps>) {
  const { t } = useI18n();
  // Written through optimistically: the backend owns the binding, but the
  // snapshot prop only catches up on the next state broadcast.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<RowFeedback | null>(null);
  const recordButtons = useRef(new Map<string, HTMLButtonElement | null>());

  const huntEntries = useMemo(
    () => pokemon.filter(isRunningHunt).map((p) => toEntry("pokemon", p.id, p.name, p.hotkey)),
    [pokemon],
  );
  const groupEntries = useMemo(
    () =>
      [...groups]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((g) => toEntry("group", g.id, g.name, g.hotkey)),
    [groups],
  );
  const allEntries = useMemo(() => [...huntEntries, ...groupEntries], [huntEntries, groupEntries]);

  const apply = useCallback((rowId: string, combo: string) => {
    setOverrides((prev) => ({ ...prev, [rowId]: combo }));
    globalThis.electronAPI?.syncHotkeys?.();
  }, []);

  const commitRecording = useCallback(
    async (rowId: string, combo: string) => {
      setFeedback(null);
      const res = await writeHotkey(endpointFor(rowId), combo);
      if (res.ok) {
        apply(rowId, combo);
        return;
      }
      setFeedback({ rowId, ...(await readRejection(res, t)) });
    },
    [apply, t],
  );

  const { recording, liveModifiers, start, cancel } = useHotkeyRecorder<string>(commitRecording);

  const startRecording = (rowId: string) => {
    setFeedback(null);
    start(rowId);
  };

  const clearBinding = async (rowId: string) => {
    setFeedback(null);
    const res = await writeHotkey(endpointFor(rowId), "");
    if (!res.ok) {
      setFeedback({ rowId, ...(await readRejection(res, t)) });
      return;
    }
    // The clear button unmounts with the binding, so move focus to the record
    // button of the same row while it is still on screen.
    recordButtons.current.get(rowId)?.focus();
    apply(rowId, "");
  };

  const renderRow = (entry: HotkeyEntry) => (
    <HotkeyRow
      key={entry.rowId}
      label={entry.name}
      combo={overrides[entry.rowId] ?? entry.combo}
      isRecording={recording === entry.rowId}
      liveModifiers={liveModifiers}
      recordAriaLabel={t("hotkeys.recordFor", { name: entry.name })}
      cancelAriaLabel={t("hotkeys.cancelFor", { name: entry.name })}
      clearAriaLabel={t("hotkeys.deleteFor", { name: entry.name })}
      recordTitle={t("hotkeys.tooltipRecord")}
      clearTitle={t("hotkeys.tooltipDelete")}
      onRecord={() => startRecording(entry.rowId)}
      onCancel={cancel}
      onClear={() => clearBinding(entry.rowId)}
      recordButtonRef={(el) => {
        recordButtons.current.set(entry.rowId, el);
      }}
      message={
        feedback?.rowId === entry.rowId ? (
          <HotkeyRowMessage conflict={feedback.conflict} text={feedback.text} />
        ) : null
      }
    />
  );

  if (allEntries.length === 0) {
    return <p className="text-xs 2xl:text-sm text-text-muted">{t("hotkeys.huntEmpty")}</p>;
  }

  const recordingName = allEntries.find((e) => e.rowId === recording)?.name ?? "";

  return (
    <div className="space-y-4">
      <p className="text-xs 2xl:text-sm text-text-secondary">{t("hotkeys.huntSectionDesc")}</p>

      {huntEntries.length > 0 && (
        <section aria-labelledby="hunt-hotkeys-hunts" className="space-y-3">
          <h3 id="hunt-hotkeys-hunts" className="text-xs font-semibold text-text-muted uppercase">
            {t("hotkeys.huntsLabel")}
          </h3>
          {huntEntries.map(renderRow)}
        </section>
      )}

      {groupEntries.length > 0 && (
        <section aria-labelledby="hunt-hotkeys-groups" className="space-y-3">
          <h3 id="hunt-hotkeys-groups" className="text-xs font-semibold text-text-muted uppercase">
            {t("hotkeys.groupsLabel")}
          </h3>
          {groupEntries.map(renderRow)}
        </section>
      )}

      {recording && (
        <HotkeyRecordingBanner entryName={recordingName} liveModifiers={liveModifiers} />
      )}
    </div>
  );
}

/** Maps a row id back onto the endpoint that owns that binding. */
function endpointFor(rowId: string): string {
  const separator = rowId.indexOf(":");
  return `/api/hotkeys/${rowId.slice(0, separator)}/${rowId.slice(separator + 1)}`;
}
