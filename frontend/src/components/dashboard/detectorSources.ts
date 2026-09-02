/**
 * detectorSources.ts: Persistence of detector configs and capture sources.
 */

import { DetectorConfig, Pokemon } from "../../types";
import { apiUrl } from "../../utils/api";
import { type GroupCaptureSource } from "../../utils/captureSourceMemory";

/** Resolve a remembered source against devices that still exist on this machine. */
export async function resolveGroupSource(
  source: GroupCaptureSource,
): Promise<GroupCaptureSource | null> {
  if (source.type === "browser_display") {
    const sources = (await globalThis.electronAPI?.getCaptureSources()) ?? [];
    const match =
      sources.find((item) => item.id === source.sourceId) ??
      sources.find(
        (item) =>
          !!source.sourceLabel &&
          item.name.toLowerCase().includes(source.sourceLabel.toLowerCase()),
      );
    return match ? { type: source.type, sourceId: match.id, sourceLabel: match.name } : null;
  }
  const devices = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
  const cameras = devices.filter((device) => device.kind === "videoinput");
  const match =
    cameras.find((device) => device.deviceId === source.sourceId) ??
    cameras.find(
      (device) =>
        !!source.sourceLabel &&
        device.label.toLowerCase().includes(source.sourceLabel.toLowerCase()),
    );
  return match ? { type: source.type, sourceId: match.deviceId, sourceLabel: match.label } : null;
}

/** Saves a detector configuration for a Pokemon via the API. */
export async function saveDetectorConfig(
  pokemonId: string,
  cfg: DetectorConfig | null,
): Promise<void> {
  await fetch(apiUrl(`/api/detector/${pokemonId}/config`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg ?? {}),
  });
}

/** Keep each detector panel's source selector in sync with a group selection. */
export function saveGroupSourceType(
  members: Pokemon[],
  sourceType: "browser_display" | "browser_camera",
): void {
  void Promise.all(
    members.map((pokemon) =>
      saveDetectorConfig(pokemon.id, { ...pokemon.detector_config!, source_type: sourceType }),
    ),
  ).catch(() => {});
}
