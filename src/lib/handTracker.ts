"use client";

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

let trackerPromise: Promise<HandLandmarker> | null = null;

async function createTracker(): Promise<HandLandmarker> {
  // The runtime and model are self-hosted under public/ (see scripts/setup-assets.mjs).
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: "/models/hand_landmarker.task", delegate },
    runningMode: "VIDEO" as const,
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    return HandLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

/** Loads the hand tracking model once; it runs entirely in the browser. */
export function getHandTracker(): Promise<HandLandmarker> {
  if (!trackerPromise) {
    trackerPromise = createTracker().catch((err) => {
      trackerPromise = null;
      throw err;
    });
  }
  return trackerPromise;
}
