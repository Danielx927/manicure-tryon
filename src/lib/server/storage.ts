import "server-only";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/** Where the design index and uploaded images live. */
export interface Storage {
  readJson<T>(key: string): Promise<T | null>;
  writeJson(key: string, value: unknown): Promise<void>;
  readBytes(key: string): Promise<Buffer | null>;
  writeBytes(key: string, data: Buffer): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Local disk under DATA_DIR (default ./data); for `npm start` on a normal server. */
function fileStorage(): Storage {
  const root = path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR || "data");
  const full = (key: string) => path.join(root, ...key.split("/").map((p) => path.basename(p)));
  const missing = (err: unknown) => (err as NodeJS.ErrnoException).code === "ENOENT";
  return {
    async readJson(key) {
      try {
        return JSON.parse(await readFile(full(key), "utf8"));
      } catch (err) {
        if (missing(err)) return null;
        throw err;
      }
    },
    async writeJson(key, value) {
      const target = full(key);
      await mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(value, null, 2));
      await rename(tmp, target);
    },
    async readBytes(key) {
      try {
        return await readFile(full(key));
      } catch (err) {
        if (missing(err)) return null;
        throw err;
      }
    },
    async writeBytes(key, data) {
      const target = full(key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, data);
    },
    async remove(key) {
      await unlink(full(key)).catch(() => undefined);
    },
  };
}

/** Netlify Blobs; serverless functions have no persistent disk. */
async function netlifyStorage(): Promise<Storage> {
  const { getStore } = await import("@netlify/blobs");
  const store = getStore({ name: "nail-designs", consistency: "strong" });
  return {
    readJson: (key) => store.get(key, { type: "json" }),
    async writeJson(key, value) {
      await store.setJSON(key, value);
    },
    async readBytes(key) {
      const data: ArrayBuffer | null = await store.get(key, { type: "arrayBuffer" });
      return data ? Buffer.from(data) : null;
    },
    async writeBytes(key, data) {
      await store.set(key, new Uint8Array(data).buffer);
    },
    remove: (key) => store.delete(key),
  };
}

let storage: Promise<Storage> | null = null;

export function getStorage(): Promise<Storage> {
  // DESIGN_STORAGE is baked in at build time by next.config.ts.
  storage ??= process.env.DESIGN_STORAGE === "netlify" ? netlifyStorage() : Promise.resolve(fileStorage());
  return storage;
}
