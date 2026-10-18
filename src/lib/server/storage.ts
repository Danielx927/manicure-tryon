import "server-only";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/** Where design records and uploaded images live. */
export interface Storage {
  readJson<T>(key: string): Promise<T | null>;
  writeJson(key: string, value: unknown): Promise<void>;
  readBytes(key: string): Promise<Buffer | null>;
  writeBytes(key: string, data: Buffer): Promise<void>;
  remove(key: string): Promise<void>;
  /** Keys starting with `prefix` (a "folder/" prefix). */
  list(prefix: string): Promise<string[]>;
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
    async list(prefix) {
      try {
        const names = await readdir(full(prefix));
        return names.filter((n) => !n.endsWith(".tmp")).map((n) => `${prefix}${n}`);
      } catch (err) {
        if (missing(err)) return [];
        throw err;
      }
    },
  };
}

/** Netlify Blobs; serverless functions have no persistent disk. */
async function netlifyStorage(): Promise<Storage> {
  const { getStore } = await import("@netlify/blobs");
  type Store = ReturnType<typeof getStore>;
  // Reads prefer strong consistency so a new upload shows up straight away.
  // That needs an uncached edge URL that Netlify doesn't always provide; when
  // it's missing every strong read throws, so fall back to the default
  // (eventual) mode, where changes can take up to a minute to appear.
  const strong = getStore({ name: "nail-designs", consistency: "strong" });
  const eventual = getStore({ name: "nail-designs" });
  let strongAvailable = true;
  async function read<T>(op: (store: Store) => Promise<T>): Promise<T> {
    if (strongAvailable) {
      try {
        return await op(strong);
      } catch (err) {
        if (!String((err as Error)?.message).includes("uncachedEdgeURL")) throw err;
        strongAvailable = false;
        console.warn("[designs] Netlify Blobs strong consistency unavailable; using eventual consistency");
      }
    }
    return op(eventual);
  }
  return {
    readJson: (key) => read((store) => store.get(key, { type: "json" })),
    async writeJson(key, value) {
      await eventual.setJSON(key, value);
    },
    async readBytes(key) {
      const data: ArrayBuffer | null = await read((store) => store.get(key, { type: "arrayBuffer" }));
      return data ? Buffer.from(data) : null;
    },
    async writeBytes(key, data) {
      await eventual.set(key, new Uint8Array(data).buffer);
    },
    remove: (key) => eventual.delete(key),
    async list(prefix) {
      const { blobs } = await read((store) => store.list({ prefix }));
      return blobs.map((b) => b.key);
    },
  };
}

let storage: Promise<Storage> | null = null;

export function getStorage(): Promise<Storage> {
  // DESIGN_STORAGE is baked in at build time by next.config.ts.
  storage ??= process.env.DESIGN_STORAGE === "netlify" ? netlifyStorage() : Promise.resolve(fileStorage());
  return storage;
}
