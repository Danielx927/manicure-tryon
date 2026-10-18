import { FINGERS, type Finger } from "./fingers";

/**
 * A user's hand as measured by the guided scan. Lengths are relative to the
 * palm length (wrist to middle knuckle), so they don't depend on how far the
 * hand was from the camera. Everything stays on the user's device.
 */
export type HandProfile = {
  version: 1;
  hand: "left" | "right";
  /** Per finger, the three segment lengths (base to tip) divided by palm length. */
  segments: Record<Finger, [number, number, number]>;
  /** Knuckle span (index to pinky) divided by palm length. */
  palmWidth: number;
  skinTone: string;
  capturedAt: string;
};

type P3 = { x: number; y: number; z: number };

/**
 * What the scan measures on the built-in 3D hand itself (rendered, turned in
 * front of a simulated camera). Comparing a user's scan with this cancels out
 * the tracker's own biases, e.g. its fingertip point sitting at the very end
 * of the finger while the model's tip joint is inside it.
 */
export const REFERENCE_PROFILE: Pick<HandProfile, "segments" | "palmWidth"> = {
  segments: {
    thumb: [0.326, 0.35, 0.297],
    index: [0.271, 0.293, 0.321],
    middle: [0.384, 0.335, 0.379],
    ring: [0.291, 0.318, 0.344],
    pinky: [0.235, 0.305, 0.243],
  },
  palmWidth: 0.507,
};

/** MediaPipe landmark indices for each finger, base to tip. */
export const LANDMARK_CHAINS: Record<Finger, [number, number, number, number]> = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

const dist = (a: P3, b: P3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Unit normal of the back/palm plane from 3D landmarks. */
export function palmNormal(lm: P3[]): P3 {
  const a = { x: lm[5].x - lm[0].x, y: lm[5].y - lm[0].y, z: lm[5].z - lm[0].z };
  const b = { x: lm[17].x - lm[0].x, y: lm[17].y - lm[0].y, z: lm[17].z - lm[0].z };
  const n = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  const l = Math.hypot(n.x, n.y, n.z) || 1;
  return { x: n.x / l, y: n.y / l, z: n.z / l };
}

export function angleBetween(a: P3, b: P3): number {
  const d = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z));
  return (Math.acos(d) * 180) / Math.PI;
}

/**
 * Whether the back of the hand faces the camera, from 2D image landmarks
 * (y down) and MediaPipe's handedness label, which matches the real hand on
 * unmirrored camera frames.
 */
export function backFacing(lm: { x: number; y: number }[], handedness: string | undefined): boolean {
  const ax = lm[5].x - lm[0].x;
  const ay = lm[5].y - lm[0].y;
  const bx = lm[17].x - lm[0].x;
  const by = lm[17].y - lm[0].y;
  const cross = ax * by - ay * bx;
  return handedness === "Right" ? cross > 0 : cross < 0;
}

/** Turns the 3D landmark frames collected during a scan into a profile. */
export function buildProfile(
  worldFrames: P3[][],
  handednessVotes: string[],
  skinSamples: [number, number, number][],
): HandProfile {
  const ratio = (f: (lm: P3[]) => number) => median(worldFrames.map((lm) => f(lm) / dist(lm[0], lm[9])));
  const segments = {} as Record<Finger, [number, number, number]>;
  for (const finger of FINGERS) {
    const c = LANDMARK_CHAINS[finger];
    segments[finger] = [0, 1, 2].map((i) => ratio((lm) => dist(lm[c[i]], lm[c[i + 1]]))) as [number, number, number];
  }
  const rights = handednessVotes.filter((h) => h === "Right").length;
  return {
    version: 1,
    hand: rights >= handednessVotes.length / 2 ? "right" : "left",
    segments,
    palmWidth: ratio((lm) => dist(lm[5], lm[17])),
    skinTone: skinToHex(skinSamples),
    capturedAt: new Date().toISOString(),
  };
}

function skinToHex(samples: [number, number, number][]): string {
  if (samples.length === 0) return "#e3b38f";
  const channel = (i: number) => Math.round(median(samples.map((s) => s[i])));
  return `#${[channel(0), channel(1), channel(2)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const STORAGE_KEY = "nail-tryon.hand-profile";

export function loadProfile(): HandProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const p = raw ? (JSON.parse(raw) as HandProfile) : null;
    return p?.version === 1 ? p : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: HandProfile | null) {
  try {
    if (profile) localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing or storage disabled: the scan still works for this visit.
  }
}
