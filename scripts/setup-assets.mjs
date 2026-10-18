// Copies the MediaPipe WASM runtime into public/ and downloads the hand
// landmark and skin segmentation models, so the app never depends on a
// third-party CDN at runtime.
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const wasmSrc = path.join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDest = path.join(root, "public/mediapipe/wasm");
const models = {
  "hand_landmarker.task":
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  // Splits a frame into background, hair, body skin, face skin, clothes and
  // other; the live try-on uses the body-skin layer for a clean hand outline.
  "selfie_multiclass_256x256.tflite":
    "https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite",
};

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

for (const [name, url] of Object.entries(models)) {
  const dest = path.join(root, "public/models", name);
  if (await exists(dest)) continue;
  await mkdir(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Model download failed for ${name}: ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`[setup-assets] downloaded ${name}`);
}
