/**
 * GroupAndTagsSection.tsx: Group dropdown and tag input of the Pokemon form.
 *
 * Fully controlled: every value and its setter come from the form, so the
 * section holds no state of its own beyond the anchor of its suggestion list.
 */
import { useI18n } from "../../contexts/I18nContext";
import { anchoredMenuStyle, anchorTriggerStyle, useAnchorName } from "../../utils/anchoredMenu";
import { TagChip } from "../shared/TagChip";
import type { GroupOption } from "./PokemonFormModal";

interface GroupAndTagsSectionProps {
  readonly groups: readonly GroupOption[];
  readonly availableTags: readonly string[];
  readonly onManageGroups?: () => void;
  readonly groupId: string;
  readonly onGroupChange: (id: string) => void;
  readonly tags: string[];
  readonly onTagsChange: (tags: string[]) => void;
  readonly tagDraft: string;
  readonly onTagDraftChange: (v: string) => void;
  readonly selectClass: string;
  readonly inputClass: string;
}

/**
 * Group dropdown + tag input section for the Pokémon form.
 *
 * Kept as a standalone component so it stays out of the large main modal
 * function and can be snapshot-tested independently if needed.
 */
export function GroupAndTagsSection({
  groups,
  availableTags,
  onManageGroups,
  groupId,
  onGroupChange,
  tags,
  onTagsChange,
  tagDraft,
  onTagDraftChange,
  selectClass,
  inputClass,
}: GroupAndTagsSectionProps) {
  const { t } = useI18n();
  const tagAnchor = useAnchorName("tag-suggest");

  // Autocomplete suggestions: show tags from the pool that match the current
  // draft (case-insensitive prefix) and are not already attached.
  const draft = tagDraft.trim().toLowerCase();
  const suggestions = draft
    ? availableTags
        .filter((a) => a.toLowerCase().startsWith(draft) && !tags.includes(a))
        .slice(0, 5)
    : [];

  const addTag = (raw: string) => {
    const v = raw.trim().toLowerCase();
    if (!v || tags.includes(v)) return;
    onTagsChange([...tags, v]);
    onTagDraftChange("");
  };

  const removeTag = (tag: string) => {
    onTagsChange(tags.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagDraft);
    } else if (e.key === "Backspace" && !tagDraft && tags.length > 0) {
      // Convenience: Backspace on empty input removes the last tag.
      removeTag(tags[tags.length - 1]);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label
          htmlFor="group-select-form"
          className="flex items-center justify-between text-xs text-text-muted mb-1"
        >
          <span>{t("group.title")}</span>
          {onManageGroups && (
            <button
              type="button"
              onClick={onManageGroups}
              className="text-[11px] text-accent-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue rounded-none px-1"
            >
              {t("group.manage")}
            </button>
          )}
        </label>
        <div className="t-select-wrap">
          <select
            id="group-select-form"
            value={groupId}
            onChange={(e) => onGroupChange(e.target.value)}
            className={selectClass}
          >
            <option value="">{t("sidebar.noGroup")}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div className="block text-xs text-text-muted mb-1">{t("tag.filter")}</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {tags.map((tag) => (
            <TagChip key={tag} tag={tag} active removable onRemove={() => removeTag(tag)} />
          ))}
        </div>
        <div className="relative">
          <input
            type="text"
            value={tagDraft}
            onChange={(e) => onTagDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("tag.placeholder")}
            aria-label={t("tag.add")}
            style={anchorTriggerStyle(tagAnchor)}
            className={inputClass}
          />
          {suggestions.length > 0 && (
            // Fixed + anchored instead of absolute: this list lives inside a
            // native <dialog> whose own scroll box clipped it away.
            <div
              style={anchoredMenuStyle(tagAnchor, "below-start", true)}
              className="fixed z-20 bg-bg-secondary border border-border-subtle rounded-none shadow-lg overflow-y-auto"
            >
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => addTag(s)}
                  className="flex items-center w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-bg-primary transition-colors"
                >
                  <TagChip tag={s} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
