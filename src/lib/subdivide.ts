import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * One level of Loop subdivision: every triangle becomes four and the surface
 * is smoothed, so the low-poly hand model loses its faceted outline. Only
 * positions are kept; normals are recomputed afterwards.
 */
export function loopSubdivide(input: THREE.BufferGeometry): THREE.BufferGeometry {
  const src = new THREE.BufferGeometry();
  src.setAttribute("position", input.getAttribute("position"));
  if (input.index) src.setIndex(input.index);
  // UV seams split vertices; weld them so the surface is one connected mesh.
  const geo = mergeVertices(src, 1e-6);
  const pos = geo.getAttribute("position");
  const idx = geo.index!.array;
  const n = pos.count;
  const p = (i: number) => new THREE.Vector3().fromBufferAttribute(pos, i);

  // Edges, keyed "low,high", with the vertices opposite them.
  const edges = new Map<string, { a: number; b: number; opposite: number[]; mid: number }>();
  const neighbours: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = idx[t + k];
      const b = idx[t + ((k + 1) % 3)];
      const c = idx[t + ((k + 2) % 3)];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const e = edges.get(key) ?? { a, b, opposite: [], mid: -1 };
      e.opposite.push(c);
      edges.set(key, e);
      neighbours[a].add(b);
      neighbours[b].add(a);
    }
  }

  const out: number[] = [];
  // Boundary vertices (the cut at the wrist) only follow the boundary.
  const boundary: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges.values()) {
    if (e.opposite.length === 1) {
      boundary[e.a].push(e.b);
      boundary[e.b].push(e.a);
    }
  }
  for (let i = 0; i < n; i++) {
    const v = p(i);
    if (boundary[i].length === 2) {
      v.multiplyScalar(0.75).addScaledVector(p(boundary[i][0]), 0.125).addScaledVector(p(boundary[i][1]), 0.125);
    } else if (boundary[i].length === 0) {
      const k = neighbours[i].size;
      const beta = k === 3 ? 3 / 16 : 3 / (8 * k);
      v.multiplyScalar(1 - k * beta);
      for (const j of neighbours[i]) v.addScaledVector(p(j), beta);
    }
    out.push(v.x, v.y, v.z);
  }
  for (const e of edges.values()) {
    const v = p(e.a).add(p(e.b));
    if (e.opposite.length === 2) {
      v.multiplyScalar(3 / 8).addScaledVector(p(e.opposite[0]), 1 / 8).addScaledVector(p(e.opposite[1]), 1 / 8);
    } else {
      v.multiplyScalar(0.5);
    }
    e.mid = out.length / 3;
    out.push(v.x, v.y, v.z);
  }

  const mid = (a: number, b: number) => edges.get(a < b ? `${a},${b}` : `${b},${a}`)!.mid;
  const faces: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const ab = mid(a, b);
    const bc = mid(b, c);
    const ca = mid(c, a);
    faces.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  result.setIndex(faces);
  return result;
}
