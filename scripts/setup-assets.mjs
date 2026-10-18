// Copies the MediaPipe WASM runtime into public/ and downloads the hand
// landmark model, so the app never depends on a third-party CDN at runtime.
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const wasmSrc = path.join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDest = path.join(root, "public/mediapipe/wasm");
const modelDest = path.join(root, "public/models/hand_landmarker.task");
const modelUrl =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

await mkdir(wasmDest, { recursive: true });
await cp(wasmSrc, wasmDest, { recursive: true });
console.log("[setup-assets] copied MediaPipe wasm");

if (!(await exists(modelDest))) {
  await mkdir(path.dirname(modelDest), { recursive: true });
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`Model download failed: ${res.status}`);
  await writeFile(modelDest, Buffer.from(await res.arrayBuffer()));
  console.log("[setup-assets] downloaded hand_landmarker.task");
}
