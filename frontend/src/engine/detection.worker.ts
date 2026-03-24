/**
 * detection.worker.ts — Web Worker for CPU-based template matching.
 *
 * Receives video frames as ImageBitmap from the main thread and runs
 * the full CPUDetector pipeline (NCC, hybrid metrics, region matching)
 * off the main thread to prevent UI jank during detection.
 */
import { CPUDetector } from "./CPUDetector";
import type { TemplateData } from "./WebGPUDetector";

// Worker global scope typed manually to avoid requiring the WebWorker lib
const ctx = globalThis as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage: (msg: unknown) => void;
};

let detector: CPUDetector | null = null;
const templates: Map<number, TemplateData> = new Map();

// --- Message handler ---------------------------------------------------------

ctx.onmessage = async (e: MessageEvent) => {
  const msg = e.data;

  switch (msg.cmd) {
    case "init":
      detector = new CPUDetector();
      ctx.postMessage({ cmd: "init", ok: true });
      break;

    case "loadTemplate": {
      if (!detector) {
        ctx.postMessage({ cmd: "loadTemplate", id: msg.id, ok: false });
        break;
      }
      const tmpl = detector.loadTemplate(msg.imageData, msg.regions);
      if (tmpl) {
        templates.set(msg.id, tmpl);
      }
      ctx.postMessage({ cmd: "loadTemplate", id: msg.id, ok: tmpl !== null });
      break;
    }

    case "detect": {
      if (!detector) {
        ctx.postMessage({ cmd: "detect", error: "not initialized" });
        break;
      }
      try {
        const tmplArray = Array.from(templates.values());
        const result = await detector.detect(msg.frame, tmplArray, msg.config);
        // Close the transferred ImageBitmap to free GPU memory
        msg.frame.close();
        ctx.postMessage({ cmd: "detect", result });
      } catch (err) {
        msg.frame.close();
        ctx.postMessage({ cmd: "detect", error: String(err) });
      }
      break;
    }

    case "clearTemplates":
      templates.clear();
      ctx.postMessage({ cmd: "clearTemplates", ok: true });
      break;

    case "destroy":
      detector?.destroy();
      detector = null;
      templates.clear();
      ctx.postMessage({ cmd: "destroy", ok: true });
      break;
  }
};
