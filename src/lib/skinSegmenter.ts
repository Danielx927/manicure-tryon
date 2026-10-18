"use client";

import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";

let segmenterPromise: Promise<ImageSegmenter> | null = null;

async function createSegmenter(): Promise<ImageSegmenter> {
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: "/models/selfie_multiclass_256x256.tflite", delegate },
    runningMode: "VIDEO" as const,
    outputConfidenceMasks: true,
    outputCategoryMask: false,
  });
  try {
    return await ImageSegmenter.createFromOptions(fileset, options("GPU"));
  } catch {
    return ImageSegmenter.createFromOptions(fileset, options("CPU"));
  }
}

/** Loads the skin segmentation model once; it runs entirely in the browser. */
export function getSkinSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = createSegmenter().catch((err) => {
      segmenterPromise = null;
      throw err;
    });
  }
  return segmenterPromise;
}

/** Index of the "body-skin" layer in the multiclass selfie model's output. */
const BODY_SKIN = 2;

/**
 * Skin confidence (0 to 1) for a square crop of the frame: `data` is
 * `width`×`height`, covering the square at (`x`, `y`) of side `side` in
 * full-frame pixels.
 */
export type SkinMap = { data: Float32Array; width: number; height: number; x: number; y: number; side: number };

/**
 * Segments the skin in `crop`, a square cut out of the frame around the
 * hands. Cropping first gives the model its full resolution on the hands,
 * which keeps the gaps between fingers open.
 */
export function segmentSkin(
  segmenter: ImageSegmenter,
  crop: HTMLCanvasElement,
  area: { x: number; y: number; side: number },
  timestamp: number,
): SkinMap | null {
  let out: SkinMap | null = null;
  // The masks only live inside the callback, so copy the one we need.
  segmenter.segmentForVideo(crop, timestamp, (result) => {
    const mask = result.confidenceMasks?.[BODY_SKIN];
    if (mask) out = { data: mask.getAsFloat32Array().slice(), width: mask.width, height: mask.height, ...area };
  });
  return out;
}
