/**
 * GroupManagementModal.tsx — CRUD dialog for sidebar groups.
 *
 * Lets users create, rename, recolour, reorder (via Up/Down buttons) and
 * delete groups. All mutations hit the REST API directly; the resulting
 * WebSocket `state_update` broadcast replaces the Zustand store so this
 * dialog does not need to maintain any derived state of its own.
 */
import { useRef, useState } from "react";
import { Plus, ArrowUp, ArrowDown, Trash2, Check } from "lucide-react";
import type { Group } from "../../types";
import { useI18n } from "../../contexts/I18nContext";
import { useToast } from "../../contexts/ToastContext";
import {
  createGroup,
  deleteGroup,
  updateGroup,
} from "../../utils/groupsApi";
import { ConfirmModal } from "./ConfirmModal";
import { ModalShell } from "./ModalShell";

interface GroupManagementModalProps {
  readonly groups: readonly Group[];
  readonly onClose: () => void;
}

/** Default colour palette offered in the colour picker (Tailwind-ish hues). */
const COLOR_PALETTE = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16",
  "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6",
  "#6366f1", "#8b5cf6", "#d946ef", "#ec4899",
  "#6b7280",
] as const;

/** Swaps two groups' sort_orders via the backend. Silently ignores failures. */
async function swap(a: Group, b: Group): Promise<void> {
  await Promise.all([
    updateGroup(a.id, { sort_order: b.sort_order }),
    updateGroup(b.id, { sort_order: a.sort_order }),
  ]);
}

/**
 * Modal dialog for managing sidebar groups. Renders one editable row per
 * group plus a "create" row at the bottom. Reorder is done with Up/Down
 * buttons (no drag-and-drop per scope constraints).
 */
export function GroupManagementModal({ groups, onClose }: GroupManagementModalProps) {
  const { t } = useI18n();
  const { push: pushToast } = useToast();
  const newInputRef = useRef<HTMLInputElement>(null);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(COLOR_PALETTE[7]); // blue by default
  const [pendingDelete, setPendingDelete] = useState<Group | null>(null);
  const [saving, setSaving] = useState(false);
  // One picker at a time. "new" = create row, "" = none, otherwise a group id.
  const [expandedColor, setExpandedColor] = useState<string>("");

  // Groups are mirrored into local state only for inline name-edit debouncing.
  // Other mutations go straight to the backend and rely on WS to refresh.
  const [nameDraft, setNameDraft] = useState<Record<string, string>>({});

  const sorted = [...groups].sort((a, b) => a.sort_order - b.sort_order);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    try {
      await createGroup(name, newColor);
      setNewName("");
      newInputRef.current?.focus();
    } catch {
      pushToast({ type: "error", title: t("group.new") });
    } finally {
      setSaving(false);
    }
  };

  const handleRename = async (group: Group) => {
    const draft = nameDraft[group.id];
    if (draft === undefined) return;
    const name = draft.trim();
    if (!name || name === group.name) {
      setNameDraft((d) => {
        const next = { ...d };
        delete next[group.id];
        return next;
      });
      return;
    }
    await updateGroup(group.id, { name });
    setNameDraft((d) => {
      const next = { ...d };
      delete next[group.id];
      return next;
    });
  };

  const handleColor = async (group: Group, color: string) => {
    await updateGroup(group.id, { color });
  };

  const handleMoveUp = async (idx: number) => {
    if (idx <= 0) return;
    await swap(sorted[idx], sorted[idx - 1]);
  };
  const handleMoveDown = async (idx: number) => {
    if (idx >= sorted.length - 1) return;
    await swap(sorted[idx], sorted[idx + 1]);
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    await deleteGroup(pendingDelete.id);
    setPendingDelete(null);
  };

  return (
    <>
      <ModalShell title={t("group.title")} onClose={onClose} size="lg">
        {/* Existing groups */}
        <ul className="flex flex-col gap-2 max-h-80 overflow-y-auto overflow-x-visible">
          {sorted.length === 0 && (
            <li className="text-xs text-text-muted px-2 py-6 text-center italic">
              {t("group.noneYet")}
            </li>
          )}
          {sorted.map((group, idx) => {
            const draft = nameDraft[group.id];
            const value = draft ?? group.name;
            const isExpanded = expandedColor === group.id;
            return (
              <li
                key={group.id}
                className="flex flex-col gap-2 bg-bg-secondary rounded-none px-2 py-1.5"
              >
                <div className="flex items-center gap-2">
                  <ColorSwatch
                    color={group.color}
                    expanded={isExpanded}
                    onToggle={() =>
                      setExpandedColor(isExpanded ? "" : group.id)
                    }
                  />
                  <input
                    type="text"
                    value={value}
                    onChange={(e) =>
                      setNameDraft((d) => ({ ...d, [group.id]: e.target.value }))
                    }
                    onBlur={() => handleRename(group)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    aria-label={t("group.name")}
                    className="flex-1 bg-transparent text-sm text-text-primary border-b border-transparent focus:border-accent-blue/50 outline-none px-1"
                  />
                  <button
                    type="button"
                    onClick={() => handleMoveUp(idx)}
                    disabled={idx === 0}
                    className="p-1.5 rounded-none text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
                    aria-label={t("group.moveUp")}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveDown(idx)}
                    disabled={idx === sorted.length - 1}
                    className="p-1.5 rounded-none text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
                    aria-label={t("group.moveDown")}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(group)}
                    className="p-1.5 rounded-none text-text-faint hover:text-accent-red hover:bg-bg-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
                    aria-label={t("group.delete")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                {isExpanded && (
                  <ColorPalette
                    current={group.color}
                    onSelect={(c) => {
                      void handleColor(group, c);
                      setExpandedColor("");
                    }}
                  />
                )}
              </li>
            );
          })}
        </ul>

        {/* Create new group */}
        <div className="mt-5 pt-4 border-t border-border-subtle">
          <label htmlFor="new-group-name" className="block text-xs text-text-muted mb-1.5">
            {t("group.new")}
          </label>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <ColorSwatch
                color={newColor}
                expanded={expandedColor === "new"}
                onToggle={() =>
                  setExpandedColor(expandedColor === "new" ? "" : "new")
                }
              />
              <input
                autoFocus
                id="new-group-name"
                ref={newInputRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleCreate();
                  }
                }}
                placeholder={t("group.name")}
                className="flex-1 bg-bg-secondary border border-border-subtle rounded-none px-3 py-2 text-sm text-text-primary placeholder-text-faint outline-none focus:border-accent-blue/50 transition-colors"
              />
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!newName.trim() || saving}
                aria-label={t("group.create")}
                className="flex items-center gap-1.5 px-3 py-2 rounded-none bg-accent-blue hover:bg-accent-blue/80 text-white font-semibold text-xs transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue"
              >
                <Plus className="w-3.5 h-3.5" />
                {t("group.create")}
              </button>
            </div>
            {expandedColor === "new" && (
              <ColorPalette
                current={newColor}
                onSelect={(c) => {
                  setNewColor(c);
                  setExpandedColor("");
                }}
              />
            )}
          </div>
        </div>
      </ModalShell>

      {pendingDelete && (
        <ConfirmModal
          title={t("group.delete")}
          message={t("group.deleteConfirm", { name: pendingDelete.name })}
          isDestructive
          onConfirm={() => void handleConfirmDelete()}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}

interface ColorSwatchProps {
  readonly color: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
}

/** Square swatch button that reveals/hides the inline palette for a row. */
function ColorSwatch({ color, expanded, onToggle }: ColorSwatchProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={t("group.color")}
      aria-expanded={expanded}
      className="w-6 h-6 rounded-none border border-black/30 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue shrink-0"
      style={{ backgroundColor: color }}
    />
  );
}

interface ColorPaletteProps {
  readonly current: string;
  readonly onSelect: (c: string) => void;
}

/** Inline palette strip rendered below the row that owns it. */
function ColorPalette({ current, onSelect }: ColorPaletteProps) {
  const { t } = useI18n();
  return (
    <div
      role="group"
      aria-label={t("group.color")}
      className="flex flex-wrap gap-1.5 px-1 pb-1"
    >
      {COLOR_PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onSelect(c)}
          aria-label={c}
          className="w-6 h-6 rounded-none border border-black/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue flex items-center justify-center"
          style={{ backgroundColor: c }}
        >
          {c === current && <Check className="w-3 h-3 text-white drop-shadow" />}
        </button>
      ))}
    </div>
  );
}
