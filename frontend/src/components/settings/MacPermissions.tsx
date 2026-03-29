/**
 * MacPermissions.tsx — macOS permission status and grant UI.
 *
 * Displays the current status of Accessibility and Screen Recording
 * permissions on macOS, with buttons to trigger the system permission
 * dialogs. Only renders content when the platform is darwin.
 */
import { useState, useEffect, useCallback } from "react";
import { Keyboard, Monitor, CheckCircle, AlertTriangle } from "lucide-react";
import { useI18n } from "../../contexts/I18nContext";

interface PermissionStatus {
  accessibility: boolean;
  screen_recording: boolean;
}

/** Row displaying one macOS permission with status badge and optional grant button. */
function PermissionRow({
  icon,
  label,
  description,
  granted,
  permissionKey,
  onGrant,
}: Readonly<{
  icon: React.ReactNode;
  label: string;
  description: string;
  granted: boolean;
  permissionKey: string;
  onGrant: (key: string) => void;
}>) {
  const { t } = useI18n();

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="shrink-0">{icon}</div>
        <div className="min-w-0">
          <p className="text-sm text-text-primary">{label}</p>
          <p className="text-xs text-text-muted mt-0.5">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <output
          className={`inline-flex items-center gap-1.5 text-xs font-medium ${
            granted ? "text-accent-green" : "text-accent-yellow"
          }`}
          aria-label={t("aria.permissionStatus")}
        >
          {granted ? (
            <>
              <CheckCircle className="w-3.5 h-3.5" />
              {t("permissions.granted")}
            </>
          ) : (
            <>
              <AlertTriangle className="w-3.5 h-3.5" />
              {t("permissions.notGranted")}
            </>
          )}
        </output>
        {!granted && (
          <button
            onClick={() => onGrant(permissionKey)}
            className="px-3 py-1.5 rounded-lg bg-accent-blue hover:bg-blue-500 text-white text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-blue"
          >
            {t("permissions.grant")}
          </button>
        )}
      </div>
    </div>
  );
}

/** Displays macOS Accessibility and Screen Recording permission status. */
export function MacPermissions() {
  const { t } = useI18n();
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);

  const fetchPermissions = useCallback(() => {
    globalThis.electronAPI?.getPermissionStatus()
      .then((data) => setPermissions(data))
      .catch(() => {});
  }, []);

  // Poll permission status every 2 seconds
  useEffect(() => {
    if (globalThis.electronAPI?.platform !== "darwin") return;

    fetchPermissions();
    const interval = setInterval(fetchPermissions, 2000);
    return () => clearInterval(interval);
  }, [fetchPermissions]);

  if (globalThis.electronAPI?.platform !== "darwin") return null;

  const handleGrant = (permission: string) => {
    globalThis.electronAPI?.requestPermission(permission).catch(() => {});
  };

  if (!permissions) return null;

  return (
    <div className="space-y-4">
      <PermissionRow
        icon={<Keyboard className="w-4 h-4 text-accent-blue" />}
        label={t("permissions.accessibility")}
        description={t("permissions.accessibilityDesc")}
        granted={permissions.accessibility}
        permissionKey="accessibility"
        onGrant={handleGrant}
      />
      <PermissionRow
        icon={<Monitor className="w-4 h-4 text-accent-purple" />}
        label={t("permissions.screenRecording")}
        description={t("permissions.screenRecordingDesc")}
        granted={permissions.screen_recording}
        permissionKey="screen_recording"
        onGrant={handleGrant}
      />
    </div>
  );
}
