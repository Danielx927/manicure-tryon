import "server-only";
import { randomUUID } from "node:crypto";
import { getStorage } from "./storage";

export type Design = {
  id: string;
  name: string;
  /** Storage key of the uploaded image, or "seed:<file>" for built-in designs in public/seed-designs. */
  file: string;
  contentType: string;
  createdAt: string;
  /** Optional shop page where customers can buy this design. */
  purchaseUrl?: string;
};

/**
 * Each design is stored as its own record under meta/<id>.json, so there is no
 * shared index that two writes could overwrite (Netlify Blobs is eventually
 * consistent). Built-in designs only get a record once an admin edits or
 * removes them; the record then holds just the changes.
 */
type StoredRecord = Partial<Design> & { deleted?: boolean };

const META_PREFIX = "meta/";
const metaKey = (id: string) => `${META_PREFIX}${id}.json`;

const SEED_CREATED_AT = "2026-10-17T00:00:00.000Z";
const SEEDS: Design[] = (
  [
    ["classic-red", "Classic Red"],
    ["french-tip", "French Tip"],
    ["blush-nude", "Blush Nude"],
    ["sunset-ombre", "Sunset Ombre"],
    ["polka-dots", "Polka Dots"],
    ["gold-glitter", "Gold Glitter"],
    ["midnight-marble", "Midnight Marble"],
    ["daisy", "Daisy"],
  ] as const
).map(([slug, name]) => ({
  id: `seed-${slug}`,
  name,
  file: `seed:${slug}.svg`,
  contentType: "image/svg+xml",
  createdAt: SEED_CREATED_AT,
}));

// Netlify Functions cap request bodies at about 6 MB, and multipart encoding adds overhead.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

/** The shape sent to browsers: no file paths. */
export function toPublicDesign(d: Design) {
  return {
    id: d.id,
    name: d.name,
    createdAt: d.createdAt,
    // Built-in designs are static files; uploads are served by the API.
    imageUrl: d.file.startsWith("seed:") ? `/seed-designs/${d.file.slice(5)}` : `/api/designs/${d.id}/image`,
    purchaseUrl: d.purchaseUrl ?? null,
  };
}

async function readRecords(): Promise<Map<string, StoredRecord>> {
  const storage = await getStorage();
  const keys = await storage.list(META_PREFIX);
  const entries = await Promise.all(
    keys.map(async (key) => [key.slice(META_PREFIX.length, -".json".length), await storage.readJson<StoredRecord>(key)] as const),
  );
  return new Map(entries.filter((e): e is [string, StoredRecord] => e[1] !== null));
}

function isComplete(r: StoredRecord): r is Design {
  return Boolean(r.id && r.name && r.file && r.contentType && r.createdAt);
}

/** Newest uploads first, then the built-in designs in their usual order. */
export async function listDesigns(): Promise<Design[]> {
  const records = await readRecords();
  const uploads = [...records.values()]
    .filter((r) => !r.deleted && isComplete(r) && !r.file!.startsWith("seed:"))
    .map((r) => r as Design)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const seeds = SEEDS.flatMap((seed) => {
    const override = records.get(seed.id);
    if (override?.deleted) return [];
    const merged: Design = { ...seed, ...override, id: seed.id, file: seed.file, contentType: seed.contentType };
    if (!merged.purchaseUrl) delete merged.purchaseUrl;
    return [merged];
  });
  return [...uploads, ...seeds];
}

async function getDesign(id: string): Promise<Design | null> {
  const seed = SEEDS.find((s) => s.id === id);
  const record = await (await getStorage()).readJson<StoredRecord>(metaKey(id));
  if (record?.deleted) return null;
  if (seed) return { ...seed, ...record, id: seed.id, file: seed.file, contentType: seed.contentType };
  return record && isComplete(record) ? record : null;
}

export async function getDesignImage(id: string): Promise<{ data: Buffer; contentType: string } | null> {
  const design = await getDesign(id);
  if (!design || design.file.startsWith("seed:")) return null;
  const data = await (await getStorage()).readBytes(design.file);
  return data ? { data, contentType: design.contentType } : null;
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

/** Accepts only absolute http(s) URLs; returns the normalised URL or null. */
export function parsePurchaseUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function addDesign(
  name: string,
  data: Buffer,
  type: { contentType: string; ext: string },
  purchaseUrl?: string,
): Promise<Design> {
  const storage = await getStorage();
  const id = randomUUID();
  const file = `designs/${id}.${type.ext}`;
  await storage.writeBytes(file, data);
  const design: Design = {
    id,
    name,
    file,
    contentType: type.contentType,
    createdAt: new Date().toISOString(),
    ...(purchaseUrl ? { purchaseUrl } : {}),
  };
  await storage.writeJson(metaKey(id), design);
  return design;
}

export async function deleteDesign(id: string): Promise<boolean> {
  const design = await getDesign(id);
  if (!design) return false;
  const storage = await getStorage();
  if (design.file.startsWith("seed:")) {
    await storage.writeJson(metaKey(id), { deleted: true } satisfies StoredRecord);
  } else {
    await storage.remove(metaKey(id));
    await storage.remove(design.file);
  }
  return true;
}

export async function updateDesign(
  id: string,
  changes: { name?: string; purchaseUrl?: string | null },
): Promise<Design | null> {
  const design = await getDesign(id);
  if (!design) return null;
  if (changes.name !== undefined) design.name = changes.name;
  if (changes.purchaseUrl === null) delete design.purchaseUrl;
  else if (changes.purchaseUrl !== undefined) design.purchaseUrl = changes.purchaseUrl;
  const storage = await getStorage();
  if (design.file.startsWith("seed:")) {
    const override: StoredRecord = { name: design.name, ...(design.purchaseUrl ? { purchaseUrl: design.purchaseUrl } : {}) };
    await storage.writeJson(metaKey(id), override);
  } else {
    await storage.writeJson(metaKey(id), design);
  }
  return design;
}
