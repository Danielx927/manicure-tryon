// Pure geometry: turns MediaPipe hand landmarks (in pixel space) into one
// oriented rectangle per fingernail. No DOM or MediaPipe imports, so it can be
// unit-tested and reused for the live camera later.

export type Point = { x: number; y: number };

export const FINGERS = ["thumb", "index", "middle", "ring", "pinky"] as const;
export type Finger = (typeof FINGERS)[number];

// MediaPipe hand landmark indices per finger: [base knuckle, middle joint,
// last joint, tip]. For the thumb these are CMC, MCP, IP, TIP.
const FINGER_LANDMARKS: Record<Finger, [number, number, number, number]> = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

// Relative nail width per finger, as a fraction of the knuckle spacing.
const WIDTH_FACTOR: Record<Finger, number> = {
  thumb: 0.78,
  index: 0.62,
  middle: 0.64,
  ring: 0.6,
  pinky: 0.5,
};

// Nail length as a fraction of the last finger segment (last joint -> tip).
const LENGTH_FACTOR: Record<Finger, number> = {
  thumb: 0.72,
  index: 0.78,
  middle: 0.78,
  ring: 0.78,
  pinky: 0.76,
};

export type Nail = {
  finger: Finger;
  /** Centre of the cuticle edge, in pixels. */
  base: Point;
  /** Unit vector pointing from the cuticle towards the fingertip. */
  dir: Point;
  /** Natural nail width and length in pixels (before user adjustments). */
  width: number;
  length: number;
  /** False when the finger looks curled, so its nail is probably hidden. */
  visible: boolean;
};

export type HandSide = "back" | "palm" | "unknown";

export type HandNails = {
  nails: Nail[];
  /** Which side of the hand faces the camera; nails only show on the back. */
  side: HandSide;
};

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: Point) => Math.hypot(v.x, v.y);
const norm = (v: Point): Point => {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
};
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;

/**
 * @param landmarks 21 hand landmarks in pixel coordinates.
 * @param handedness MediaPipe's label ("Left" | "Right"), used only to tell
 *   palm from back: in 2D a right palm looks like a left back, so the
 *   landmark geometry alone can't separate them.
 */
export function computeHandNails(landmarks: Point[], handedness?: string): HandNails {
  const knuckleSpacing =
    (len(sub(landmarks[5], landmarks[9])) +
      len(sub(landmarks[9], landmarks[13])) +
      len(sub(landmarks[13], landmarks[17]))) /
    3;

  const nails = FINGERS.map((finger): Nail => {
    const [mcp, pip, dip, tip] = FINGER_LANDMARKS[finger].map((i) => landmarks[i]);
    const segment = sub(tip, dip);
    const segLen = len(segment);
    const dir = norm(segment);

    // A finger is treated as curled (nail hidden) when its last segment bends
    // sharply away from its first segment, or its tip folds back towards the
    // wrist. The thumb's joints don't fold that way, so only the angle applies.
    const firstDir = norm(sub(pip, mcp));
    const wrist = landmarks[0];
    const foldedBack = finger !== "thumb" && len(sub(tip, wrist)) < len(sub(pip, wrist));
    const visible = dot(firstDir, dir) > 0.25 && !foldedBack;

    // When the hand is seen edge-on the knuckle spacing collapses; fall back to
    // the segment length so nails never shrink to nothing.
    const widthBasis = Math.max(knuckleSpacing, segLen * 0.9);
    const width = widthBasis * WIDTH_FACTOR[finger];
    const length = Math.max(segLen * LENGTH_FACTOR[finger], width * 0.6);

    // The tip landmark sits on the fingertip pad, slightly past the nail's
    // free edge, so pull the nail back a little.
    const tipEdge = { x: tip.x - dir.x * segLen * 0.06, y: tip.y - dir.y * segLen * 0.06 };
    const base = { x: tipEdge.x - dir.x * length, y: tipEdge.y - dir.y * length };

    return { finger, base, dir, width, length, visible };
  });

  return { nails, side: handSide(landmarks, handedness) };
}

function handSide(landmarks: Point[], handedness?: string): HandSide {
  if (handedness !== "Left" && handedness !== "Right") return "unknown";
  const a = sub(landmarks[5], landmarks[0]);
  const b = sub(landmarks[17], landmarks[0]);
  const cross = a.x * b.y - a.y * b.x;
  if (Math.abs(cross) < 1e-6) return "unknown";
  // With y pointing down, a right hand seen from the back has cross > 0.
  // Verified on unmirrored sample photos: MediaPipe's label matches the real
  // hand there (backs of hands -> "back", palms -> "palm").
  const backFacing = handedness === "Right" ? cross > 0 : cross < 0;
  return backFacing ? "back" : "palm";
}
