import { useState, useCallback, useRef } from "react";
import { apiUrl } from "../utils/api";

interface SnapshotInfo {
  frameCount: number;
  durationSec: number;
  path: string;
}

interface ReplayTimelineState {
  isLoading: boolean;
  snapshot: SnapshotInfo | null;
  currentIndex: number;
  currentFrameUrl: string | null;
}

/**
 * useReplayTimeline manages the lifecycle of a replay snapshot for template creation.
 *
 * Handles creating/deleting snapshots and fetching individual frames on demand.
 */
export function useReplayTimeline(pokemonId: string) {
  const [state, setState] = useState<ReplayTimelineState>({
    isLoading: false,
    snapshot: null,
    currentIndex: 0,
    currentFrameUrl: null,
  });
  const abortRef = useRef<AbortController | null>(null);

  /** Load a specific frame by index. */
  const loadFrame = useCallback(
    async (index: number) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(
          apiUrl(`/api/detector/${pokemonId}/replay/snapshot/${index}`),
          { signal: controller.signal },
        );
        if (!res.ok || controller.signal.aborted) return;
        const blob = await res.blob();
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        setState((s) => {
          // Revoke previous URL to prevent memory leak
          if (s.currentFrameUrl) URL.revokeObjectURL(s.currentFrameUrl);
          return { ...s, currentIndex: index, currentFrameUrl: url };
        });
      } catch {
        // Abort or network error — ignore
      }
    },
    [pokemonId],
  );

  /** Take a snapshot of the current replay buffer. */
  const takeSnapshot = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true }));
    try {
      const res = await fetch(
        apiUrl(`/api/detector/${pokemonId}/replay/snapshot`),
        { method: "POST" },
      );
      if (!res.ok) throw new Error("Snapshot failed");
      const data = (await res.json()) as {
        frame_count: number;
        duration_sec: number;
        path: string;
      };
      setState({
        isLoading: false,
        snapshot: {
          frameCount: data.frame_count,
          durationSec: data.duration_sec,
          path: data.path,
        },
        currentIndex: 0,
        currentFrameUrl: null,
      });
      // Load the first frame
      await loadFrame(0);
    } catch {
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, [pokemonId, loadFrame]);

  /** Delete the current snapshot and close the timeline. */
  const deleteSnapshot = useCallback(async () => {
    abortRef.current?.abort();
    await fetch(apiUrl(`/api/detector/${pokemonId}/replay/snapshot`), {
      method: "DELETE",
    });
    setState((s) => {
      if (s.currentFrameUrl) URL.revokeObjectURL(s.currentFrameUrl);
      return {
        isLoading: false,
        snapshot: null,
        currentIndex: 0,
        currentFrameUrl: null,
      };
    });
  }, [pokemonId]);

  /** Navigate to a specific frame index. */
  const seekTo = useCallback(
    (index: number) => {
      if (!state.snapshot) return;
      const clamped = Math.max(
        0,
        Math.min(index, state.snapshot.frameCount - 1),
      );
      loadFrame(clamped);
    },
    [state.snapshot, loadFrame],
  );

  /** Get the current frame as a Blob for template upload. */
  const getCurrentFrameBlob = useCallback(async (): Promise<Blob | null> => {
    if (!state.snapshot) return null;
    try {
      const res = await fetch(
        apiUrl(
          `/api/detector/${pokemonId}/replay/snapshot/${state.currentIndex}`,
        ),
      );
      if (!res.ok) return null;
      return await res.blob();
    } catch {
      return null;
    }
  }, [pokemonId, state.currentIndex, state.snapshot]);

  return {
    ...state,
    takeSnapshot,
    deleteSnapshot,
    seekTo,
    getCurrentFrameBlob,
  };
}
