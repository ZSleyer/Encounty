/**
 * frameProcessor.ts — Web Worker for off-main-thread frame processing.
 *
 * Receives ImageBitmaps from the capture loop, performs change detection
 * via pixel sampling, crops to an optional ROI, encodes to JPEG, and
 * returns the binary message (36-byte pokemonID + JPEG payload) ready
 * for WebSocket transmission.
 */
/// <reference lib="webworker" />

interface DetectorRect {
  x: number; y: number; w: number; h: number;
}

interface InitMsg { type: "init"; pokemonId: string; roi: DetectorRect | null; changeThreshold: number }
interface FrameMsg { type: "frame"; bitmap: ImageBitmap }
interface UpdateRoiMsg { type: "updateRoi"; roi: DetectorRect | null }
interface StopMsg { type: "stop" }

type InMsg = InitMsg | FrameMsg | UpdateRoiMsg | StopMsg;

interface EncodedOut { type: "encoded"; data: ArrayBuffer }
interface SkippedOut { type: "skipped" }

type OutMsg = EncodedOut | SkippedOut;

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let roiCanvas: OffscreenCanvas | null = null;
let roiCtx: OffscreenCanvasRenderingContext2D | null = null;
let pokemonId = "";
let roi: DetectorRect | null = null;
let changeThreshold = 0.15;
let prevSample: number[] | null = null;

const SAMPLE_GRID = 8;

/**
 * Sample an 8x8 grid of pixels from the given image data.
 * Returns an array of RGB values (192 entries total).
 */
function samplePixels(imgData: ImageData, w: number, h: number): number[] {
  const sample: number[] = [];
  for (let gy = 0; gy < SAMPLE_GRID; gy++) {
    for (let gx = 0; gx < SAMPLE_GRID; gx++) {
      const px = Math.floor((gx + 0.5) * w / SAMPLE_GRID);
      const py = Math.floor((gy + 0.5) * h / SAMPLE_GRID);
      const i = (py * w + px) * 4;
      sample.push(imgData.data[i], imgData.data[i + 1], imgData.data[i + 2]);
    }
  }
  return sample;
}

/**
 * Compute the normalized mean absolute difference between two
 * pixel samples. Returns a value in [0, 1] where 0 means identical.
 */
function computeDelta(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += Math.abs(a[i] - b[i]);
  }
  return sum / (a.length * 255);
}

/** Process a single video frame: detect changes, crop ROI, encode JPEG. */
async function processFrame(bitmap: ImageBitmap): Promise<void> {
  const w = bitmap.width;
  const h = bitmap.height;

  if (!canvas || canvas.width !== w || canvas.height !== h) {
    canvas = new OffscreenCanvas(w, h);
    ctx = canvas.getContext("2d")!;
  }
  ctx!.drawImage(bitmap, 0, 0);

  // Change detection via pixel sampling
  const imgData = ctx!.getImageData(0, 0, w, h);
  const sample = samplePixels(imgData, w, h);
  if (prevSample) {
    const delta = computeDelta(prevSample, sample);
    if (delta < changeThreshold) {
      prevSample = sample;
      self.postMessage({ type: "skipped" } satisfies OutMsg);
      return;
    }
  }
  prevSample = sample;

  // ROI cropping — only send the region of interest to the backend
  let encodeCanvas: OffscreenCanvas = canvas!;
  if (roi && roi.w > 0 && roi.h > 0) {
    const rw = roi.w;
    const rh = roi.h;
    if (!roiCanvas || roiCanvas.width !== rw || roiCanvas.height !== rh) {
      roiCanvas = new OffscreenCanvas(rw, rh);
      roiCtx = roiCanvas.getContext("2d")!;
    }
    roiCtx!.drawImage(canvas!, roi.x, roi.y, rw, rh, 0, 0, rw, rh);
    encodeCanvas = roiCanvas!;
  }

  // JPEG encode
  const blob = await encodeCanvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
  const jpegBuf = await blob.arrayBuffer();

  // Build binary message: 36-byte UUID (ASCII) + JPEG payload
  const idBytes = new TextEncoder().encode(pokemonId);
  const msg = new Uint8Array(36 + jpegBuf.byteLength);
  msg.set(idBytes.subarray(0, 36), 0);
  msg.set(new Uint8Array(jpegBuf), 36);

  self.postMessage({ type: "encoded", data: msg.buffer } satisfies OutMsg, [msg.buffer]);
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  switch (e.data.type) {
    case "init":
      pokemonId = e.data.pokemonId;
      roi = e.data.roi;
      changeThreshold = e.data.changeThreshold;
      prevSample = null;
      break;
    case "frame":
      await processFrame(e.data.bitmap);
      e.data.bitmap.close();
      break;
    case "updateRoi":
      roi = e.data.roi;
      break;
    case "stop":
      canvas = null;
      ctx = null;
      roiCanvas = null;
      roiCtx = null;
      prevSample = null;
      break;
  }
};
