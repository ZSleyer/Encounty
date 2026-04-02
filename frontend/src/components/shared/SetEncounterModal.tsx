import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";
import { Pokemon } from "../../types";

interface SetEncounterModalProps {
  readonly pokemon: Pokemon;
  readonly onSave: (count: number) => void;
  readonly onClose: () => void;
}

/** Modal dialog to set the encounter count to an exact value. */
export function SetEncounterModal({ pokemon, onSave, onClose }: Readonly<SetEncounterModalProps>) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();
  const [count, setCount] = useState(pokemon.encounters);

  useEffect(() => {
    dialogRef.current?.showModal();
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleCancel = () => {
    dialogRef.current?.close();
    onClose();
  };

  const handleSave = () => {
    onSave(Math.max(0, count));
    handleCancel();
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={handleCancel}
      onClick={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
      className="m-auto bg-bg-card border border-border-subtle rounded-2xl p-6 w-full max-w-sm animate-slide-in backdrop:bg-black/70"
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-text-primary">
          {t("modal.setEncounterTitle")}
        </h2>
        <button
          onClick={handleCancel}
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <p className="text-sm text-text-muted mb-4">{pokemon.name}</p>

      <div className="mb-6">
        <label
          htmlFor="encounter-count"
          className="block text-xs text-text-muted mb-1"
        >
          {t("modal.setEncounterLabel")}
        </label>
        <input
          ref={inputRef}
          id="encounter-count"
          type="number"
          min={0}
          value={count}
          onChange={(e) => setCount(Math.max(0, Number.parseInt(e.target.value, 10) || 0))}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSave(); } }}
          className="w-full bg-bg-secondary border border-border-subtle rounded-lg px-3 py-2 text-lg text-text-primary outline-none focus:border-accent-blue/50 transition-colors tabular-nums"
        />
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleCancel}
          className="flex-1 py-2 rounded-lg border border-border-subtle text-text-muted hover:text-text-primary hover:border-text-muted transition-colors text-sm"
        >
          {t("modal.cancel")}
        </button>
        <button
          onClick={handleSave}
          className="flex-1 py-2 rounded-lg bg-accent-blue hover:bg-accent-blue/80 text-white font-semibold text-sm transition-colors"
        >
          {t("modal.save")}
        </button>
      </div>
    </dialog>
  );
}
