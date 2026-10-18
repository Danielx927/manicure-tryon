// Builds the "only the hands" mask for the live camera view. It works at low
// resolution and in plain JavaScript, because canvas blur filters aren't
// available in every mobile browser (Safari on iOS ignores ctx.filter).

import type { Point } from "./nails";

/** Width of the mask in pixels; it is smoothed when scaled up to the video. */
export const MASK_WIDTH = 200;

// Landmarks that outline the palm, and each finger's chain from its knuckle.
const PALM = [0, 1, 2, 5, 9, 13, 17];
const CHAINS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

/** Fills the palm and strokes every finger, `scale` times the finger width. */
function paintHandShape(ctx: CanvasRenderingContext2D, pts: Point[], scale: number) {
  const d = (a: number, b: number) => Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
  const finger = Math.max((d(5, 9) + d(9, 13) + d(13, 17)) / 3, d(7, 8) * 0.9);
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.lineWidth = finger * scale;
  ctx.beginPath();
  PALM.forEach((i, k) => (k ? ctx.lineTo(pts[i].x, pts[i].y) : ctx.moveTo(pts[i].x, pts[i].y)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (const chain of CHAINS) {
    ctx.beginPath();
    ctx.moveTo(pts[chain[0]].x, pts[chain[0]].y);
    for (const i of chain.slice(1)) ctx.lineTo(pts[i].x, pts[i].y);
    // Reach past the tip landmark, which sits on the finger pad.
    const a = pts[chain[2]];
    const b = pts[chain[3]];
    ctx.lineTo(b.x + (b.x - a.x) * 0.3, b.y + (b.y - a.y) * 0.3);
    ctx.stroke();
  }
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
 * Paints the mask into `out` (MASK_WIDTH wide, same aspect as the frame).
 * `frame` holds the mirrored camera image at that size; `hands` are landmark
 * points in full-size frame pixels.
 *
 * Two layers: a tight shape along the fingers and palm that is always shown,
 * so fingers never disappear, and a wider shape in which a pixel is shown only
 * if its colour is close to the skin colour sampled from the back of the hand.
 * That keeps the real outline of the fingers and drops the background between
 * them, whatever the light or skin tone.
 */
export function paintHandMask(
  out: CanvasRenderingContext2D,
  frame: CanvasRenderingContext2D,
  hands: Point[][],
  fullWidth: number,
) {
  const { width: w, height: h } = out.canvas;
  const s = w / fullWidth;
  const scaled = hands.map((pts) => pts.map((p) => ({ x: p.x * s, y: p.y * s })));

  out.clearRect(0, 0, w, h);
  out.fillStyle = out.strokeStyle = "#f00"; // red: tight core
  for (const pts of scaled) paintHandShape(out, pts, 0.4);
  out.globalCompositeOperation = "destination-over";
  out.fillStyle = out.strokeStyle = "#00f"; // blue: wider region checked by colour
  for (const pts of scaled) paintHandShape(out, pts, 1.3);
  out.globalCompositeOperation = "source-over";

  const shape = out.getImageData(0, 0, w, h);
  const img = frame.getImageData(0, 0, w, h).data;

  // Skin colour per hand, from points on the back of the hand.
  const skins = scaled.map((pts) => {
    const cbs: number[] = [];
    const crs: number[] = [];
    const spots = [
      [0, 9, 0.5],
      [0, 5, 0.6],
      [0, 13, 0.6],
      [0, 17, 0.55],
      [5, 6, 0.5],
      [9, 10, 0.5],
      [13, 14, 0.5],
    ];
    for (const [a, b, t] of spots) {
      const x = Math.round(pts[a].x + (pts[b].x - pts[a].x) * t);
      const y = Math.round(pts[a].y + (pts[b].y - pts[a].y) * t);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 4;
      const [cb, cr] = chroma(img[i], img[i + 1], img[i + 2]);
      cbs.push(cb);
      crs.push(cr);
    }
    const mid = (v: number[]) => v.sort((m, n) => m - n)[v.length >> 1];
    return cbs.length ? ([mid(cbs), mid(crs)] as [number, number]) : null;
  });
  const skin = skins.find(Boolean) ?? null;

  const alpha = new Float32Array(w * h);
  const sd = shape.data;
  for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
    if (sd[i + 3] === 0) continue;
    if (sd[i] > sd[i + 2]) {
      alpha[p] = 1;
      continue;
    }
    if (!skin) continue;
    const [cb, cr] = chroma(img[i], img[i + 1], img[i + 2]);
    const dist = Math.hypot(cb - skin[0], cr - skin[1]);
    // Fully shown within 7 chroma units of the skin colour, gone past 14.
    alpha[p] = dist < 7 ? 1 : dist > 14 ? 0 : (14 - dist) / 7;
  }

  // A 3×3 box blur fills speckles; the edge is then tightened again below so
  // the background doesn't bleed in around the fingers.
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

  for (let p = 0, i = 0; p < alpha.length; p++, i += 4) {
    sd[i] = sd[i + 1] = sd[i + 2] = 255;
    const t = Math.min(1, Math.max(0, (blurred[p] - 0.3) / 0.45));
    sd[i + 3] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  out.putImageData(shape, 0, 0);
}
