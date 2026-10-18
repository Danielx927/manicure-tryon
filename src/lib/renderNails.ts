import type { Nail } from "./nails";

export type NailShape = "round" | "square" | "almond";

export type FitSettings = {
  /** Multiplier on the natural nail width and length. */
  size: number;
  /** Extra length past the fingertip, as a fraction of nail length. */
  extension: number;
  shape: NailShape;
};

export const DEFAULT_FIT: FitSettings = { size: 1, extension: 0.2, shape: "round" };

/**
 * Traces the nail outline in local coordinates: origin at the cuticle centre,
 * the nail grows towards negative y, so the tip is at y = -length.
 */
function traceNail(ctx: CanvasRenderingContext2D, w: number, l: number, shape: NailShape) {
  const hw = w / 2;
  const cuticle = Math.min(w * 0.18, l * 0.2);
  ctx.beginPath();
  // Cuticle: a rounded U bulging towards the knuckle, with soft corners.
  ctx.moveTo(-hw, -cuticle);
  ctx.bezierCurveTo(-hw, cuticle * 0.9, hw, cuticle * 0.9, hw, -cuticle);
  if (shape === "square") {
    const r = w * 0.18;
    ctx.lineTo(hw, -l + r);
    ctx.quadraticCurveTo(hw, -l, hw - r, -l);
    ctx.lineTo(-hw + r, -l);
    ctx.quadraticCurveTo(-hw, -l, -hw, -l + r);
  } else if (shape === "almond") {
    ctx.lineTo(hw, -l * 0.55);
    ctx.bezierCurveTo(hw, -l * 0.8, w * 0.12, -l, 0, -l);
    ctx.bezierCurveTo(-w * 0.12, -l, -hw, -l * 0.8, -hw, -l * 0.55);
  } else {
    const r = Math.min(hw, l * 0.5);
    ctx.lineTo(hw, -l + r);
    ctx.bezierCurveTo(hw, -l + r * 0.2, hw * 0.55, -l, 0, -l);
    ctx.bezierCurveTo(-hw * 0.55, -l, -hw, -l + r * 0.2, -hw, -l + r);
  }
  ctx.closePath();
}

/** Draws `design` like CSS object-fit: cover into the rect. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource & { width: number; height: number },
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const scale = Math.max(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/**
 * Paints a flat nail texture for the 3D hand: the design (or a bare nail tint)
 * clipped to the nail shape, tip at the top, transparent outside the nail.
 * Lighting on the 3D model provides the shading, so none is baked in here.
 */
export function paintNailTexture(
  canvas: HTMLCanvasElement,
  design: (CanvasImageSource & { width: number; height: number }) | undefined,
  shape: NailShape,
  aspect: number,
) {
  const w = 256;
  const l = Math.round(w * aspect);
  canvas.width = w;
  canvas.height = l;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, l);
  // The cuticle arc bulges below the origin, so leave room for it.
  const bulge = Math.round(w * 0.14);
  const nl = l - bulge;
  ctx.save();
  ctx.translate(w / 2, nl);
  traceNail(ctx, w, nl, shape);
  ctx.save();
  ctx.clip();
  if (design) {
    drawCover(ctx, design, -w / 2, -nl, w, l);
  } else {
    // Bare nail: pinkish bed with a paler free edge.
    const bed = ctx.createLinearGradient(0, bulge, 0, -nl);
    bed.addColorStop(0, "#f2c7c0");
    bed.addColorStop(0.78, "#f6d3cd");
    bed.addColorStop(0.8, "#fbf1ea");
    bed.addColorStop(1, "#fdf8f3");
    ctx.fillStyle = bed;
    ctx.fillRect(-w / 2, -nl, w, l);
  }
  ctx.restore();
  traceNail(ctx, w, nl, shape);
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.18)";
  ctx.stroke();
  ctx.restore();
}

/**
 * Paints one design onto one nail in a 2D image (the live camera view). Design images are portrait, with the top of
 * the image at the nail tip and the bottom at the cuticle.
 */
export function drawNail(
  ctx: CanvasRenderingContext2D,
  nail: Nail,
  design: CanvasImageSource & { width: number; height: number },
  fit: FitSettings,
) {
  const w = nail.width * fit.size;
  const natural = nail.length * fit.size;
  const l = natural * (1 + fit.extension);
  // Extra length grows past the fingertip, so the cuticle stays put.
  ctx.save();
  ctx.translate(nail.base.x - nail.dir.x * (natural - nail.length), nail.base.y - nail.dir.y * (natural - nail.length));
  // Rotate so local "up" (0, -1) points along nail.dir.
  ctx.rotate(Math.atan2(nail.dir.y, nail.dir.x) + Math.PI / 2);

  // Soft contact shadow so the polish sits on the finger instead of floating.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.28)";
  ctx.shadowBlur = Math.max(2, w * 0.08);
  ctx.shadowOffsetY = w * 0.02;
  traceNail(ctx, w, l, fit.shape);
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fill();
  ctx.restore();

  traceNail(ctx, w, l, fit.shape);
  ctx.save();
  ctx.clip();
  drawCover(ctx, design, -w / 2, -l, w, l);

  // Curvature: darken the side walls and add a glossy highlight streak.
  const side = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  side.addColorStop(0, "rgba(0, 0, 0, 0.28)");
  side.addColorStop(0.22, "rgba(0, 0, 0, 0)");
  side.addColorStop(0.78, "rgba(0, 0, 0, 0)");
  side.addColorStop(1, "rgba(0, 0, 0, 0.32)");
  ctx.fillStyle = side;
  ctx.fillRect(-w / 2, -l, w, l + w);

  const gloss = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
  gloss.addColorStop(0.2, "rgba(255, 255, 255, 0)");
  gloss.addColorStop(0.32, "rgba(255, 255, 255, 0.38)");
  gloss.addColorStop(0.42, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(-w / 2, -l * 0.92, w, l * 0.75);
  ctx.restore();

  // Thin rim to separate the nail edge from skin.
  traceNail(ctx, w, l, fit.shape);
  ctx.lineWidth = Math.max(0.6, w * 0.025);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
  ctx.stroke();
  ctx.restore();
}
