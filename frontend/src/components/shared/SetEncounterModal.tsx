import { useState } from "react";
import { useI18n } from "../../contexts/I18nContext";
import { Pokemon } from "../../types";
import { ModalShell, ModalActions } from "./ModalShell";

interface SetEncounterModalProps {
  readonly pokemon: Pokemon;
  readonly onSave: (count: number) => void;
  readonly onClose: () => void;
}

/** Modal dialog to set the encounter count to an exact value. */
export function SetEncounterModal({ pokemon, onSave, onClose }: Readonly<SetEncounterModalProps>) {
  const { t } = useI18n();
  const [count, setCount] = useState(pokemon.encounters);

  const save = () => onSave(Math.max(0, count));

  return (
    <ModalShell
      title={t("modal.setEncounterTitle")}
      onClose={onClose}
      size="sm"
      footer={(requestClose) => (
        <ModalActions
          onConfirm={save}
          requestClose={requestClose}
          confirmLabel={t("common.save")}
          cancelLabel={t("common.cancel")}
        />
      )}
    >
      {(requestClose: () => void) => (
        <>
          <p className="text-sm text-text-muted mb-4">{pokemon.name}</p>
          <div>
            <label
              htmlFor="encounter-count"
              className="block text-xs text-text-muted mb-1"
            >
              {t("modal.setEncounterLabel")}
            </label>
            <input
              autoFocus
              onFocus={(e) => e.target.select()}
              id="encounter-count"
              type="number"
              min={0}
              value={count}
              onChange={(e) => setCount(Math.max(0, Number.parseInt(e.target.value, 10) || 0))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                  requestClose();
                }
              }}
              className="w-full bg-bg-secondary border border-border-subtle rounded-none px-3 py-2 text-lg text-text-primary outline-none focus:border-accent-blue/50 transition-colors tabular-nums"
            />
          </div>
        </>
      )}
    </ModalShell>
  );
}
