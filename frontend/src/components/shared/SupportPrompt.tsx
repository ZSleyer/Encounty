/**
 * SupportPrompt.tsx — the deferred "Support Encounty" nudge shown once at app
 * start (never mid-hunt). It is persistent: no auto-dismiss timer, it stays
 * until the user acts or closes it. Modal-leaning but non-blocking — it does not
 * gray out or trap the rest of the app.
 *
 * Two variants:
 *   - "star": one-time GitHub star prompt (Star on GitHub / Already did).
 *   - "recommend": recurring, subtle word-of-mouth nudge (Recommend).
 */
import { Star, Share2, X } from "lucide-react";

import { useI18n } from "../../contexts/I18nContext";
import { useToast } from "../../contexts/ToastContext";
import { REPO_URL, markStarDone, shareEncounty, type PromptVariant } from "../../utils/supportPrompt";
import { useModalA11y } from "../../hooks/useModalA11y";

/** Props for the SupportPrompt card. */
interface SupportPromptProps {
  variant: PromptVariant;
  onClose: () => void;
}

/**
 * SupportPrompt renders the star or recommend nudge card. `onClose` is called
 * for every exit path; stage-1 handling (markStarDone) happens on the star
 * actions before closing.
 */
export function SupportPrompt({ variant, onClose }: Readonly<SupportPromptProps>) {
  const { t } = useI18n();
  const { push: pushToast } = useToast();
  const containerRef = useModalA11y<HTMLDivElement>({ isOpen: true, onClose });

  const recommend = async () => {
    const result = await shareEncounty(t("support.recommendBody"));
    if (result === "copied") {
      pushToast({ type: "info", title: t("support.copied") });
    }
    onClose();
  };

  const handleStar = () => {
    markStarDone();
    onClose();
  };

  const isStar = variant === "star";
  const titleId = "support-prompt-title";

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed bottom-4 right-4 z-90 w-[28rem] max-w-[calc(100vw-2rem)]"
    >
      <div className="t-panel p-5 shadow-2xl anim-t-crt-in relative">
        <button
          onClick={onClose}
          aria-label={t("aria.supportClose")}
          className="absolute top-2.5 right-2.5 p-1 rounded-none text-text-faint hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-start gap-3 pr-5">
          <div className="w-9 h-9 shrink-0 rounded-full border border-accent-blue/40 flex items-center justify-center">
            {isStar ? (
              <Star className="w-4.5 h-4.5 text-accent-blue" />
            ) : (
              <Share2 className="w-4.5 h-4.5 text-accent-blue" />
            )}
          </div>
          <div className="space-y-1 min-w-0">
            <p id={titleId} className="text-xl font-semibold text-text-primary">
              {isStar ? t("support.starTitle") : t("support.recommendTitle")}
            </p>
            <p className="text-base text-text-muted leading-relaxed">
              {isStar ? t("support.starBody") : t("support.recommendBody")}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 mt-4">
          {isStar ? (
            <>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleStar}
                aria-label={t("aria.supportStar")}
                className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-none bg-accent-blue hover:bg-accent-blue/80 text-white text-base font-semibold whitespace-nowrap transition-colors"
              >
                <Star className="w-4 h-4 shrink-0" />
                {t("support.star")}
              </a>
              <button
                onClick={handleStar}
                className="px-3 py-2.5 rounded-none border border-border-subtle text-text-muted hover:bg-bg-hover text-base font-medium whitespace-nowrap transition-colors"
              >
                {t("support.alreadyDone")}
              </button>
            </>
          ) : (
            <button
              onClick={recommend}
              aria-label={t("aria.supportRecommend")}
              className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-none bg-accent-blue hover:bg-accent-blue/80 text-white text-base font-semibold whitespace-nowrap transition-colors"
            >
              <Share2 className="w-4 h-4 shrink-0" />
              {t("support.recommend")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
