import * as THREE from "three";

// Realistic-looking skin without texture files: the colour varies over the
// hand (redder knuckles and fingertips, a lighter palm), and the surface gets
// fine detail in the shader (pores, slight unevenness and creases over the
// finger joints), plus a soft reddish glow at grazing angles where
// light scatters through real skin.

export type SkinJoints = {
  /** Finger joints whose skin creases when the finger bends (knuckles, middle and end joints). */
  joints: { at: THREE.Vector3; axis: THREE.Vector3; radius: number; knuckle: boolean }[];
  /** Fingertip positions. */
  tips: THREE.Vector3[];
  /** Direction out of the back of the hand. */
  back: THREE.Vector3;
};

const gauss = (d: number, sigma: number) => Math.exp(-(d * d) / (2 * sigma * sigma));

/**
 * Adds per-vertex colour (as a multiplier on the skin tone) and crease data to
 * a hand mesh with normals. Distances are in the model's units (metres).
 */
export function paintSkinDetail(geometry: THREE.BufferGeometry, data: SkinJoints) {
  const pos = geometry.getAttribute("position");
  const nrm = geometry.getAttribute("normal");
  const colours = new Float32Array(pos.count * 3);
  const crease = new Float32Array(pos.count);
  const creaseAxis = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nrm, i);
    const dorsal = THREE.MathUtils.smoothstep(n.dot(data.back), -0.1, 0.5);
    const palm = THREE.MathUtils.smoothstep(-n.dot(data.back), 0.1, 0.7);
    let redness = 0;
    let best = 0;
    for (const j of data.joints) {
      d.subVectors(p, j.at);
      const along = d.dot(j.axis);
      const across = Math.sqrt(Math.max(0, d.lengthSq() - along * along));
      // Knuckles are redder and their skin wrinkles over a wider band.
      const near = gauss(along, j.knuckle ? 0.007 : 0.0045) * gauss(Math.max(0, across - j.radius * 0.6), 0.004);
      redness = Math.max(redness, near * dorsal * (j.knuckle ? 0.8 : 1));
      // Knuckle skin is redder but its wrinkles are too fine to show well.
      const w = j.knuckle ? 0 : near * dorsal;
      if (w > best) {
        best = w;
        creaseAxis.set([j.axis.x, j.axis.y, j.axis.z], i * 3);
      }
    }
    crease[i] = best;
    let tip = 0;
    for (const t of data.tips) tip = Math.max(tip, gauss(p.distanceTo(t), 0.011));
    redness = Math.max(redness, tip * 0.9);
    // Multipliers on the skin tone (linear light): redder means less green/blue.
    const r = 1 + palm * 0.06;
    const g = (1 - redness * 0.25) * (1 + palm * 0.02);
    const b = (1 - redness * 0.3) * (1 + palm * 0.01);
    colours.set([r, g, b], i * 3);
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute("crease", new THREE.BufferAttribute(crease, 1));
  geometry.setAttribute("creaseAxis", new THREE.BufferAttribute(creaseAxis, 3));
}

const NOISE = /* glsl */ `
float skinHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float skinNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(skinHash(i), skinHash(i + vec3(1, 0, 0)), f.x),
                 mix(skinHash(i + vec3(0, 1, 0)), skinHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(skinHash(i + vec3(0, 0, 1)), skinHash(i + vec3(1, 0, 1)), f.x),
                 mix(skinHash(i + vec3(0, 1, 1)), skinHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Cellular pores: small dips at random points of a grid.
float skinPores(vec3 x) {
  vec3 i = floor(x);
  float d = 1.0;
  for (int k = 0; k < 8; k++) {
    vec3 c = i + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 o = vec3(skinHash(c), skinHash(c + 7.1), skinHash(c + 3.7));
    d = min(d, length(x - c - o));
  }
  return smoothstep(0.0, 0.35, d);
}
`;

export function setSkinTone(material: THREE.MeshPhysicalMaterial, color: string) {
  material.color.set(color);
}

/** A physical material for the hand, with the skin detail added in its shaders. */
export function createSkinMaterial(envMap: THREE.Texture) {
  const material = new THREE.MeshPhysicalMaterial({
    envMap,
    vertexColors: true,
    roughness: 0.52,
    metalness: 0,
    specularIntensity: 0.45,
    envMapIntensity: 0.2,
    sheen: 0.1,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color("#ff9a7a"),
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
attribute float crease;
attribute vec3 creaseAxis;
varying vec3 vSkinPos;
varying float vCrease;
varying vec3 vCreaseAxis;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vSkinPos = position;
vCrease = crease;
vCreaseAxis = creaseAxis;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vSkinPos;
varying float vCrease;
varying vec3 vCreaseAxis;
${NOISE}`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
{
  // Surface height in metres; detail fades out where it would be smaller
  // than a pixel, so it never shimmers.
  vec3 sp = vSkinPos;
  float px = length(fwidth(sp));
  float h = 0.0;
  float poreFade = 1.0 - smoothstep(0.00004, 0.0001, px);
  h -= (1.0 - skinPores(sp * 2600.0)) * 0.000022 * poreFade;
  float grainFade = 1.0 - smoothstep(0.0002, 0.0005, px);
  h += (skinNoise(sp * 700.0) - 0.5) * 0.000015 * grainFade;
  // Creases across the finger over each joint.
  float creaseFade = 1.0 - smoothstep(0.0005, 0.0012, px);
  if (vCrease > 0.02) {
    // A few soft folds, slightly wavy and of uneven depth.
    float s = dot(sp, normalize(vCreaseAxis)) * 2600.0 + skinNoise(sp * 180.0) * 1.0;
    float line = pow(1.0 - abs(sin(s)), 3.0) * (0.6 + 0.4 * skinNoise(sp * 400.0));
    h -= line * vCrease * 0.00005 * creaseFade;
  }
  vec3 dpx = dFdx(-vViewPosition);
  vec3 dpy = dFdy(-vViewPosition);
  vec3 r1 = cross(dpy, normal);
  vec3 r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  normal = normalize(abs(det) * normal - grad);
  // Darken the bottom of the creases a little.
  diffuseColor.rgb *= 1.0 - clamp(-h / 0.00006, 0.0, 1.0) * 0.18 * vCrease;
}`,
      )
      .replace(
        "#include <opaque_fragment>",
        `{
  // Light scattering through skin: a warm glow towards the silhouette.
  float rim = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
  outgoingLight += diffuseColor.rgb * vec3(0.55, 0.14, 0.08) * rim * 0.6;
}
#include <opaque_fragment>`,
      );
  };
  return material;
}
