import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export type Design = {
  id: string;
  name: string;
  /** Path relative to the data dir, or "seed:<file>" for built-in designs. */
  file: string;
  contentType: string;
  createdAt: string;
};

const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "data");
const INDEX_FILE = path.join(DATA_DIR, "designs.json");
const UPLOAD_DIR = path.join(DATA_DIR, "designs");
const SEED_DIR = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "seed-designs");

const SEEDS: Array<[string, string]> = [
  ["classic-red", "Classic Red"],
  ["french-tip", "French Tip"],
  ["blush-nude", "Blush Nude"],
  ["sunset-ombre", "Sunset Ombre"],
  ["polka-dots", "Polka Dots"],
  ["gold-glitter", "Gold Glitter"],
  ["midnight-marble", "Midnight Marble"],
  ["daisy", "Daisy"],
];

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Serialise writes to the index so concurrent admin actions don't clobber it.
let queue: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

async function readIndex(): Promise<Design[]> {
  try {
    return JSON.parse(await readFile(INDEX_FILE, "utf8")) as Design[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const createdAt = new Date().toISOString();
    return SEEDS.map(([slug, name]) => ({
      id: `seed-${slug}`,
      name,
      file: `seed:${slug}.svg`,
      contentType: "image/svg+xml",
      createdAt,
    }));
  }
}

async function writeIndex(designs: Design[]) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${INDEX_FILE}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(designs, null, 2));
  await rename(tmp, INDEX_FILE);
}

export function listDesigns(): Promise<Design[]> {
  return readIndex();
}

export async function getDesignImage(id: string): Promise<{ data: Buffer; contentType: string } | null> {
  const design = (await readIndex()).find((d) => d.id === id);
  if (!design) return null;
  const filePath = design.file.startsWith("seed:")
    ? path.join(SEED_DIR, path.basename(design.file.slice(5)))
    : path.join(DATA_DIR, design.file);
  try {
    return { data: await readFile(filePath), contentType: design.contentType };
  } catch {
    return null;
  }
}

/** Recognises PNG, JPEG and WebP from their magic bytes; anything else is rejected. */
export function sniffImageType(data: Buffer): { contentType: string; ext: string } | null {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { contentType: "image/png", ext: "png" };
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { contentType: "image/jpeg", ext: "jpg" };
  }
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return { contentType: "image/webp", ext: "webp" };
  }
  return null;
}

export function addDesign(name: string, data: Buffer, type: { contentType: string; ext: string }): Promise<Design> {
  return withLock(async () => {
    const id = randomUUID();
    const file = path.join("designs", `${id}.${type.ext}`);
    await mkdir(UPLOAD_DIR, { recursive: true });
    await writeFile(path.join(DATA_DIR, file), data);
    const design: Design = { id, name, file, contentType: type.contentType, createdAt: new Date().toISOString() };
    const designs = await readIndex();
    await writeIndex([design, ...designs]);
    return design;
  });
}

export function deleteDesign(id: string): Promise<boolean> {
  return withLock(async () => {
    const designs = await readIndex();
    const design = designs.find((d) => d.id === id);
    if (!design) return false;
    await writeIndex(designs.filter((d) => d.id !== id));
    if (!design.file.startsWith("seed:")) {
      await unlink(path.join(DATA_DIR, design.file)).catch(() => undefined);
    }
    return true;
  });
}
