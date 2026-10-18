// Builds the "only the hands" mask for the live camera view. It works at low
// resolution and in plain JavaScript, because canvas blur filters aren't
// available in every mobile browser (Safari on iOS ignores ctx.filter).

import type { Point } from "./nails";
import type { SkinMap } from "./skinSegmenter";

/**
 * Width of the mask in pixels, matching the segmentation model's input; it is
 * smoothed when scaled up to the video.
 */
export const MASK_WIDTH = 256;

// Landmarks that outline the palm, and each finger's chain from its knuckle.
const PALM = [0, 1, 2, 5, 9, 13, 17];
const CORE_PALM = [0, 5, 9, 13, 17];
const CHAINS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

/**
 * Fills the palm and strokes every finger, `scale` times the finger width.
 * The core version stays inside the hand: the palm between the knuckles and
 * the wrist only (not the web of the thumb), fingers stopping at their tips.
 */
function paintHandShape(ctx: CanvasRenderingContext2D, pts: Point[], scale: number, core = false) {
  const d = (a: number, b: number) => Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
  const finger = Math.max((d(5, 9) + d(9, 13) + d(13, 17)) / 3, d(7, 8) * 0.9);
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.lineWidth = finger * scale;
  ctx.beginPath();
  (core ? CORE_PALM : PALM).forEach((i, k) => (k ? ctx.lineTo(pts[i].x, pts[i].y) : ctx.moveTo(pts[i].x, pts[i].y)));
  ctx.closePath();
  ctx.fill();
  if (!core) ctx.stroke();
  for (const chain of CHAINS) {
    ctx.beginPath();
    ctx.moveTo(pts[chain[0]].x, pts[chain[0]].y);
    for (const i of chain.slice(1)) ctx.lineTo(pts[i].x, pts[i].y);
    if (!core) {
      // Reach past the tip landmark, which sits on the finger pad.
      const a = pts[chain[2]];
      const b = pts[chain[3]];
      ctx.lineTo(b.x + (b.x - a.x) * 0.3, b.y + (b.y - a.y) * 0.3);
    }
    ctx.stroke();
  }
  if (core) return;
  // A bit of wrist.
  const wrist = pts[0];
  ctx.beginPath();
  ctx.moveTo(wrist.x, wrist.y);
  ctx.lineTo(wrist.x - (pts[9].x - wrist.x) * 0.3, wrist.y - (pts[9].y - wrist.y) * 0.3);
  ctx.lineWidth = finger * scale * 2;
  ctx.stroke();
}

const chroma = (r: number, g: number, b: number): [number, number] => [
  -0.169 * r - 0.331 * g + 0.5 * b,
  0.5 * r - 0.419 * g - 0.081 * b,
];

/**
 * Returns a painter that writes the hand mask into `out` (MASK_WIDTH wide,
 * same aspect as the frame) each frame.
 *
 * The outline comes from the skin segmentation model when it is available: a
 * trained network gives smooth, stable edges, unlike per-pixel colour checks.
 * It is limited to a region around the tracked hand landmarks, so arms and the
 * face stay hidden, and a thin core along the fingers is always shown so a
 * finger never drops out. Without the model, pixels are kept by how close
 * their colour is to the skin on the back of the hand.
 *
 * Successive frames are blended a little so the edge doesn't shimmer.
 */
export function createHandMasker() {
  let prev: Float32Array | null = null;

  return function paint(
    out: CanvasRenderingContext2D,
    frame: CanvasRenderingContext2D,
    hands: Point[][],
    fullWidth: number,
    skinMap: SkinMap | null,
  ) {
    const { width: w, height: h } = out.canvas;
    const s = w / fullWidth;
    const scaled = hands.map((pts) => pts.map((p) => ({ x: p.x * s, y: p.y * s })));

    out.clearRect(0, 0, w, h);
    out.fillStyle = out.strokeStyle = "#f00"; // red: core, always shown
    for (const pts of scaled) paintHandShape(out, pts, 0.3, true);
    out.globalCompositeOperation = "destination-over";
    out.fillStyle = out.strokeStyle = "#00f"; // blue: region where skin may show
    for (const pts of scaled) paintHandShape(out, pts, skinMap ? 1.4 : 1.3);
    out.globalCompositeOperation = "source-over";

    const shape = out.getImageData(0, 0, w, h);
    const sd = shape.data;
    const alpha = new Float32Array(w * h);
    const skinAt = skinMap ? skinSampler(skinMap, s) : colourSampler(frame, scaled, w, h);

    for (let y = 0, p = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p++) {
        const i = p * 4;
        if (sd[i + 3] === 0) continue;
        alpha[p] = sd[i] > sd[i + 2] ? 1 : skinAt(x, y);
      }
    }

    // Soften with a 3×3 box blur, then blend with the previous frame.
    const blurred = new Float32Array(alpha.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        let n = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
            sum += alpha[yy * w + xx];
            n++;
          }
        }
        blurred[y * w + x] = sum / n;
      }
    }
    if (prev && prev.length === blurred.length) {
      for (let p = 0; p < blurred.length; p++) blurred[p] = prev[p] * 0.25 + blurred[p] * 0.75;
    }
    prev = blurred;

    for (let p = 0, i = 0; p < blurred.length; p++, i += 4) {
      sd[i] = sd[i + 1] = sd[i + 2] = 255;
      const t = Math.min(1, Math.max(0, (blurred[p] - 0.45) / 0.35));
      sd[i + 3] = Math.round(t * t * (3 - 2 * t) * 255);
    }
    out.putImageData(shape, 0, 0);
  };
}

/** Bilinear lookup of the model's skin confidence at mask pixel (x, y). */
function skinSampler(map: SkinMap, maskScale: number) {
  const k = map.width / map.side;
  return (x: number, y: number) => {
    // Mask pixel -> full-frame pixel -> pixel of the segmented crop.
    const fx = ((x + 0.5) / maskScale - map.x) * k - 0.5;
    const fy = ((y + 0.5) / maskScale - map.y) * k - 0.5;
    if (fx < 0 || fy < 0 || fx > map.width - 1 || fy > map.height - 1) return 0;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(map.width - 1, x0 + 1);
    const y1 = Math.min(map.height - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const d = map.data;
    const top = d[y0 * map.width + x0] * (1 - tx) + d[y0 * map.width + x1] * tx;
    const bottom = d[y1 * map.width + x0] * (1 - tx) + d[y1 * map.width + x1] * tx;
    return top * (1 - ty) + bottom * ty;
  };
}

/** Fallback: closeness to the skin colour sampled from the back of the hand. */
function colourSampler(frame: CanvasRenderingContext2D, hands: Point[][], w: number, h: number) {
  const img = frame.getImageData(0, 0, w, h).data;
  const spots = [
    [0, 9, 0.5],
    [0, 5, 0.6],
    [0, 13, 0.6],
    [0, 17, 0.55],
    [5, 6, 0.5],
    [9, 10, 0.5],
    [13, 14, 0.5],
  ];
  const cbs: number[] = [];
  const crs: number[] = [];
  for (const pts of hands) {
    for (const [a, b, t] of spots) {
      const x = Math.round(pts[a].x + (pts[b].x - pts[a].x) * t);
      const y = Math.round(pts[a].y + (pts[b].y - pts[a].y) * t);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 4;
      const [cb, cr] = chroma(img[i], img[i + 1], img[i + 2]);
      cbs.push(cb);
      crs.push(cr);
    }
  }
  if (cbs.length === 0) return () => 0;
  const mid = (v: number[]) => v.sort((m, n) => m - n)[v.length >> 1];
  const skinCb = mid(cbs);
  const skinCr = mid(crs);
  return (x: number, y: number) => {
    const i = (y * w + x) * 4;
    const [cb, cr] = chroma(img[i], img[i + 1], img[i + 2]);
    const dist = Math.hypot(cb - skinCb, cr - skinCr);
    // Fully shown within 7 chroma units of the skin colour, gone past 14.
    return dist < 7 ? 1 : dist > 14 ? 0 : (14 - dist) / 7;
  };
}
