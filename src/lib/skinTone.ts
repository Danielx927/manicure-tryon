// Turns camera pixels from the hand scan into a skin colour for the 3D hand.
//
// Raw pixels are a poor guide on their own: front cameras indoors usually
// underexpose the hand, shadows and knuckle creases pull a plain median down,
// and room lighting tints everything. So each sampled frame keeps only the
// evenly lit skin, then is corrected for exposure and white balance using the
// brightest part of the same frame as a reference.

export type RGB = [number, number, number];

/** What one scanned frame contributes: skin pixels and the frame's brightest colour. */
export type SkinSample = { skin: RGB[]; white: RGB };

const luma = ([r, g, b]: RGB) => 0.299 * r + 0.587 * g + 0.114 * b;

function mean(pixels: RGB[]): RGB {
  const sum = [0, 0, 0];
  for (const p of pixels) for (let i = 0; i < 3; i++) sum[i] += p[i];
  return sum.map((v) => v / Math.max(1, pixels.length)) as RGB;
}

/** Average of the pixels between two brightness percentiles (0 to 1). */
function band(pixels: RGB[], from: number, to: number): RGB {
  const sorted = [...pixels].sort((a, b) => luma(a) - luma(b));
  const a = Math.floor(sorted.length * from);
  const b = Math.max(a + 1, Math.ceil(sorted.length * to));
  return mean(sorted.slice(a, b));
}

/**
 * The colour of the brightest ~2% of a frame (RGBA bytes, `width` pixels
 * wide), leaving out the hand's box: usually a wall, clothing or a lamp, and
 * a good stand-in for how the camera renders white.
 */
export function frameWhite(
  rgba: Uint8ClampedArray,
  width: number,
  hand?: { x0: number; y0: number; x1: number; y1: number },
): RGB {
  const pixels: RGB[] = [];
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    const x = p % width;
    const y = Math.floor(p / width);
    if (hand && x >= hand.x0 && x <= hand.x1 && y >= hand.y0 && y <= hand.y1) continue;
    pixels.push([rgba[i], rgba[i + 1], rgba[i + 2]]);
  }
  return pixels.length ? band(pixels, 0.98, 1) : [255, 255, 255];
}

/**
 * Corrects one frame's skin colour. Exposure: the brightest part of the frame
 * is assumed to be near white, so a dim frame is brightened (up to 2.2×, and
 * never so far that the skin clips). White balance: applied only when that
 * reference is roughly grey (otherwise it is probably a coloured object) and
 * limited to moderate per-channel changes.
 */
function correct(sample: SkinSample): RGB | null {
  if (sample.skin.length < 8) return null;
  // Skip the darkest 40% (shadows, creases, gaps) and the brightest 8% (shine).
  const skin = band(sample.skin, 0.4, 0.92);
  const white = sample.white;
  const top = Math.max(...white, 1);
  // Warm indoor light makes white look orange, so allow a fair tint, but not
  // one so strong that the reference is probably something coloured.
  const neutral = Math.min(...white) / top > 0.6;
  const balance = white.map((c) => (neutral ? Math.min(1.35, Math.max(0.8, top / Math.max(c, 1))) : 1));
  const balanced = skin.map((c, i) => c * balance[i]) as RGB;
  const exposure = Math.min(2.2, Math.max(1, 240 / (neutral ? top : Math.max(top, 200))), 245 / Math.max(...balanced, 1));
  return balanced.map((c) => Math.min(255, c * Math.max(1, exposure))) as RGB;
}

const toHex = (rgb: RGB) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("")}`;

export const DEFAULT_SKIN = "#e3b38f";

/** The skin colour of a scan: the median of the corrected frames, by brightness. */
export function estimateSkinTone(samples: SkinSample[]): string {
  const colours = samples.map(correct).filter((c): c is RGB => c !== null);
  if (colours.length === 0) return DEFAULT_SKIN;
  colours.sort((a, b) => luma(a) - luma(b));
  // Average the middle half so one odd frame can't decide the colour.
  const a = Math.floor(colours.length / 4);
  return toHex(mean(colours.slice(a, Math.max(a + 1, colours.length - a))));
}

/**
 * Makes a colour lighter (positive steps) or darker (negative), keeping its
 * hue: each step scales it by about 8% in linear light.
 */
export function shiftTone(hex: string, steps: number): string {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const k = Math.min(1.08 ** steps, 1 / Math.max(...linear, 1e-4));
  return toHex(
    linear.map((c) => {
      const v = Math.min(1, c * k);
      return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
    }) as RGB,
  );
}
