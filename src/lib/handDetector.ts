"use client";

import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import type { Point } from "./nails";

export type DetectedHand = {
  /** 21 landmarks in pixel coordinates of the analysed image. */
  landmarks: Point[];
  handedness?: string;
  score: number;
};

let landmarkerPromise: Promise<HandLandmarker> | null = null;

async function createLandmarker(): Promise<HandLandmarker> {
  // Both are self-hosted under public/ (see scripts/setup-assets.mjs).
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: "/models/hand_landmarker.task", delegate },
    runningMode: "IMAGE" as const,
    numHands: 4,
    minHandDetectionConfidence: 0.4,
    minHandPresenceConfidence: 0.4,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    return HandLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

/** Loads the model once and reuses it for every photo. */
export function getHandLandmarker(): Promise<HandLandmarker> {
  if (!landmarkerPromise) {
    landmarkerPromise = createLandmarker().catch((err) => {
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

export async function detectHands(image: HTMLCanvasElement): Promise<DetectedHand[]> {
  const landmarker = await getHandLandmarker();
  const result = landmarker.detect(image);
  return result.landmarks.map((points, i) => {
    const category = result.handedness[i]?.[0];
    return {
      landmarks: points.map((p) => ({ x: p.x * image.width, y: p.y * image.height })),
      handedness: category?.categoryName,
      score: category?.score ?? 0,
    };
  });
}
