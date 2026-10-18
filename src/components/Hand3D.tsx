"use client";

import { Canvas, useLoader, useThree } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { FINGERS, type Finger } from "@/lib/fingers";
import { REFERENCE_PROFILE, type HandProfile } from "@/lib/handProfile";
import { nailOutline, paintNailTexture, type FitSettings } from "@/lib/renderNails";
import { createSkinMaterial, paintSkinDetail, setSkinTone, type SkinJoints } from "@/lib/skinMaterial";
import { loopSubdivide } from "@/lib/subdivide";

// Generic right hand from @webxr-input-profiles/assets (MIT, see public/hand/LICENSE.txt).
const HAND_URL = "/hand/right.glb";

const DISTAL_BONES: Record<Finger, [string, string]> = {
  thumb: ["thumb-phalanx-distal", "thumb-tip"],
  index: ["index-finger-phalanx-distal", "index-finger-tip"],
  middle: ["middle-finger-phalanx-distal", "middle-finger-tip"],
  ring: ["ring-finger-phalanx-distal", "ring-finger-tip"],
  pinky: ["pinky-finger-phalanx-distal", "pinky-finger-tip"],
};

/** Bones matching MediaPipe's landmarks for each finger, base joint to tip. */
const FINGER_BONES: Record<Finger, [string, string, string, string]> = {
  thumb: ["thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip"],
  index: ["index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip"],
  middle: ["middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip"],
  ring: ["ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip"],
  pinky: ["pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip"],
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Reshapes the model's skeleton to a scanned hand: knuckles spread to the
 * scanned palm width and each finger stretched to the scanned length, both
 * compared with what the scan measures on this model. Whole-finger lengths
 * are used because single segments are too noisy to trust. The model's joints
 * are all direct children of the armature, so each bone can be moved on its
 * own; a bone is scaled along the finger to stretch the skin bound to it.
 */
function fitToProfile(scene: THREE.Object3D, profile: HandProfile) {
  scene.updateMatrixWorld(true);
  const bone = (name: string) => {
    const b = scene.getObjectByName(name);
    if (!b) throw new Error(`Hand model is missing ${name}`);
    return b;
  };
  const pos = (name: string) => bone(name).getWorldPosition(new THREE.Vector3());
  const targets = new Map<string, THREE.Vector3>();
  const stretch = new Map<string, { axis: THREE.Vector3; factor: number }>();

  const middleKnuckle = pos("middle-finger-phalanx-proximal");
  const across = pos("index-finger-phalanx-proximal").sub(pos("pinky-finger-phalanx-proximal")).normalize();
  const spread = clamp(profile.palmWidth / REFERENCE_PROFILE.palmWidth, 0.85, 1.15);
  const total = (segs: number[]) => segs.reduce((a, b) => a + b, 0);

  for (const finger of FINGERS) {
    const names = FINGER_BONES[finger];
    const joints = names.map(pos);
    const factor = clamp(total(profile.segments[finger]) / total(REFERENCE_PROFILE.segments[finger]), 0.8, 1.25);
    // Spread the knuckles sideways around the middle finger.
    const offset = across.clone().multiplyScalar(joints[0].clone().sub(middleKnuckle).dot(across) * (spread - 1));
    if (finger !== "thumb") {
      const meta = names[0].replace("phalanx-proximal", "metacarpal");
      targets.set(meta, pos(meta).addScaledVector(offset, 0.5));
    }
    const fitted = [joints[0].clone().add(offset)];
    for (let k = 0; k < 3; k++) {
      const seg = joints[k + 1].clone().sub(joints[k]);
      fitted.push(fitted[k].clone().addScaledVector(seg, factor));
      stretch.set(names[k], { axis: seg.normalize(), factor });
    }
    names.forEach((n, k) => targets.set(n, fitted[k]));
  }

  for (const [name, target] of targets) {
    const b = bone(name);
    b.position.copy(b.parent!.worldToLocal(target.clone()));
  }
  // Stretch along whichever local axis of the bone runs along its segment.
  const q = new THREE.Quaternion();
  for (const [name, { axis, factor }] of stretch) {
    const b = bone(name);
    b.getWorldQuaternion(q);
    const local = axis.clone().applyQuaternion(q.invert());
    const comps = [Math.abs(local.x), Math.abs(local.y), Math.abs(local.z)];
    const i = comps.indexOf(Math.max(...comps));
    b.scale.setComponent(i, b.scale.getComponent(i) * factor);
  }
  scene.updateMatrixWorld(true);
}

/**
 * A soft studio room as an environment map, for reflections: what makes gel
 * polish look glossy. Set per material, since skin needs far less of it.
 */
function useStudioEnvironment() {
  const gl = useThree((state) => state.gl);
  const env = useMemo(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    return texture;
  }, [gl]);
  useEffect(() => () => env.dispose(), [env]);
  return env;
}

type FingerFrame = { base: THREE.Vector3; tip: THREE.Vector3; up: THREE.Vector3 };

type PreparedHand = {
  geometry: THREE.BufferGeometry;
  /** Per finger, the skin around its last segment, for placing the nail. */
  surfaces: Record<Finger, THREE.Mesh>;
  fingers: Record<Finger, FingerFrame>;
};

/**
 * Bakes the skinned glTF hand into a static mesh, oriented so the fingers
 * point up (+Y) and the back of the hand faces the camera (+Z), centred at
 * the origin. The same mesh is used to raycast nails onto the skin.
 */
function prepareHand(scene: THREE.Group): PreparedHand {
  scene.updateMatrixWorld(true);
  let skinned: THREE.SkinnedMesh | undefined;
  scene.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = o as THREE.SkinnedMesh;
  });
  if (!skinned) throw new Error("Hand model has no skinned mesh");

  const src = skinned.geometry;
  const pos = src.getAttribute("position");
  const baked = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    skinned.applyBoneTransform(i, v);
    v.applyMatrix4(skinned.matrixWorld);
    baked.set([v.x, v.y, v.z], i * 3);
  }
  const bakedGeometry = new THREE.BufferGeometry();
  bakedGeometry.setAttribute("position", new THREE.BufferAttribute(baked, 3));
  if (src.index) bakedGeometry.setIndex(src.index.clone());

  const world = (name: string) => {
    const bone = scene.getObjectByName(name);
    if (!bone) throw new Error(`Hand model is missing ${name}`);
    return bone.getWorldPosition(new THREE.Vector3());
  };

  // Hand frame: fingers along +Y, back of the hand along +Z (right hand).
  const wrist = world("wrist");
  const along = world("middle-finger-tip").sub(wrist).normalize();
  const across = world("index-finger-phalanx-proximal").sub(world("pinky-finger-phalanx-proximal"));
  const back = new THREE.Vector3().crossVectors(along, across).normalize();
  const side = new THREE.Vector3().crossVectors(along, back).normalize();
  const basis = new THREE.Matrix4().makeBasis(side, along, back);
  const toView = basis.clone().invert();

  bakedGeometry.applyMatrix4(toView);
  bakedGeometry.computeBoundingBox();
  const center = bakedGeometry.boundingBox!.getCenter(new THREE.Vector3());
  bakedGeometry.translate(-center.x, -center.y, -center.z);
  const place = (p: THREE.Vector3) => p.applyMatrix4(toView).sub(center);
  // The model is low-poly; smoothing it removes the faceted outline.
  const geometry = loopSubdivide(bakedGeometry);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  // The model follows WebXR joint conventions: each bone's +Y axis points out
  // of the back of the finger, i.e. where the nail sits.
  const fingers = {} as Record<Finger, FingerFrame>;
  for (const finger of FINGERS) {
    const [baseName, tipName] = DISTAL_BONES[finger];
    const base = place(world(baseName));
    const tip = place(world(tipName));
    const dir = tip.clone().sub(base).normalize();
    const boneRotation = scene.getObjectByName(baseName)!.getWorldQuaternion(new THREE.Quaternion());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(boneRotation).transformDirection(toView);
    up.addScaledVector(dir, -up.dot(dir)).normalize();
    fingers[finger] = { base, tip, up: centreOnFingerTop(geometry, base, dir, up) };
  }

  const joints: SkinJoints["joints"] = [];
  for (const finger of FINGERS) {
    const names = FINGER_BONES[finger];
    // The thumb's first bone is inside the palm; its creases are at the next two joints.
    for (let k = finger === "thumb" ? 1 : 0; k < 3; k++) {
      const at = place(world(names[k]));
      const next = place(world(names[k + 1]));
      joints.push({ at, axis: next.sub(at).normalize(), radius: 0.009, knuckle: k === 0 });
    }
  }
  paintSkinDetail(geometry, {
    joints,
    tips: FINGERS.map((f) => place(world(DISTAL_BONES[f][1]))),
    back: new THREE.Vector3(0, 0, 1),
  });

  // Raycasting against the whole smoothed hand for every nail vertex is slow,
  // so each nail only looks at the skin near its fingertip.
  const surfaces = {} as Record<Finger, THREE.Mesh>;
  const skinPos = geometry.getAttribute("position");
  const tri = geometry.index!.array;
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const finger of FINGERS) {
    const { base, tip } = fingers[finger];
    const centre = base.clone().lerp(tip, 0.5);
    const reach = base.distanceTo(tip) + 0.03;
    const near = (i: number) => new THREE.Vector3().fromBufferAttribute(skinPos, i).distanceTo(centre) < reach;
    const keep: number[] = [];
    for (let t = 0; t < tri.length; t += 3) {
      if (near(tri[t]) || near(tri[t + 1]) || near(tri[t + 2])) keep.push(tri[t], tri[t + 1], tri[t + 2]);
    }
    const part = new THREE.BufferGeometry();
    part.setAttribute("position", skinPos);
    part.setIndex(keep);
    part.computeBoundingSphere();
    surfaces[finger] = new THREE.Mesh(part, material);
    surfaces[finger].updateMatrixWorld(true);
  }
  return { geometry, surfaces, fingers };
}

/**
 * The bone's "up" axis can be rolled a little relative to the modelled finger,
 * which pushes the nail off to one side (most visible on the thumb). Re-centre
 * it on the average skin normal of the top of the last finger segment.
 */
function centreOnFingerTop(geometry: THREE.BufferGeometry, base: THREE.Vector3, dir: THREE.Vector3, up: THREE.Vector3) {
  const pos = geometry.getAttribute("position");
  const nrm = geometry.getAttribute("normal");
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const sum = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).sub(base);
    const t = p.dot(dir);
    if (t < 0 || t > 0.03) continue;
    const radial = p.addScaledVector(dir, -t);
    if (radial.length() > 0.014 || radial.dot(up) <= 0) continue;
    n.fromBufferAttribute(nrm, i);
    if (n.dot(up) > 0.25) sum.add(n);
  }
  sum.addScaledVector(dir, -sum.dot(dir));
  return sum.lengthSq() > 0 ? sum.normalize() : up;
}

/**
 * Builds a nail patch that hugs the finger: a grid laid over the last finger
 * segment, with each vertex dropped onto the skin by raycasting.
 */
function buildNail(hand: PreparedHand, finger: Finger, fit: FitSettings, design: boolean) {
  const { base, tip, up } = hand.fingers[finger];
  const along = tip.clone().sub(base);
  const segLen = along.length();
  along.normalize();
  const side = new THREE.Vector3().crossVectors(along, up).normalize();
  const ray = new THREE.Raycaster();
  const hitsFrom = (origin: THREE.Vector3, dir: THREE.Vector3) => {
    ray.set(origin, dir);
    return ray.intersectObject(hand.surfaces[finger], false);
  };

  // The tip joint sits inside the finger; find where the skin actually ends.
  const end = hitsFrom(base, along)[0];
  const reachToTip = end && end.distance < segLen * 2 ? end.distance : segLen;

  // Fingertips taper, so measure the width at two points along the nail and
  // use the narrower one; otherwise the nail overhangs the side (the thumb).
  // Rays go outwards from the bone, which sits inside the finger; casting
  // inwards from outside would hit the neighbouring fingers.
  const widthAt = (t: number) => {
    const at = base.clone().addScaledVector(along, reachToTip * t);
    const a = hitsFrom(at, side)[0];
    const b = hitsFrom(at, side.clone().negate())[0];
    return a && b && a.distance + b.distance < segLen * 2.5 ? a.distance + b.distance : Infinity;
  };
  const measured = Math.min(widthAt(0.45), widthAt(0.75));
  const fingerWidth = Number.isFinite(measured) ? measured : segLen * 1.3;

  const width = fingerWidth * (finger === "thumb" ? 0.7 : 0.74) * fit.size;
  const natural = reachToTip * 0.78 * fit.size;
  const length = natural * (1 + fit.extension);
  // The free edge of a natural-length nail lines up with the fingertip.
  const start = base.clone().addScaledVector(along, reachToTip - natural);
  const tipLimit = natural - reachToTip * 0.25;

  // The nail is cut to its shape and given real thickness, like a gel or
  // acrylic nail: thicker along the middle, thinner at the cuticle and sides.
  const outline = nailOutline(fit.shape, length / width);
  const firstRow = outline.findIndex(Boolean);
  const lastRow = outline.length - 1 - [...outline].reverse().findIndex(Boolean);
  const vFrom = (firstRow + 0.5) / outline.length;
  const vTo = (lastRow + 0.5) / outline.length;
  const edges = (v: number) => {
    const r = Math.round(v * outline.length - 0.5);
    for (let d = 0; d < outline.length; d++) {
      const o = outline[Math.max(firstRow, Math.min(lastRow, r - d))] ?? outline[Math.max(firstRow, Math.min(lastRow, r + d))];
      if (o) return o;
    }
    return [0, 1] as [number, number];
  };
  const thickness = (design ? 0.0007 : 0.00035) * fit.size;

  const rows = 24;
  const cols = 14;
  const under: THREE.Vector3[] = [];
  const top: THREE.Vector3[] = [];
  const uvs: number[] = [];
  const lastHeight: number[] = new Array(cols + 1).fill(NaN);
  const lift = 0.0003;
  const above = 0.04;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const v = vFrom + (vTo - vFrom) * t;
    const [uL, uR] = edges(v);
    const centre = start.clone().addScaledVector(along, v * length);
    for (let j = 0; j <= cols; j++) {
      const s = j / cols;
      const u = uL + (uR - uL) * s;
      const p = centre.clone().addScaledVector(side, (u - 0.5) * width);
      const hit = hitsFrom(p.clone().addScaledVector(up, above), up.clone().negate())[0];
      let h = hit && hit.distance < above * 2 ? above - hit.distance : lastHeight[j];
      // Past the fingertip the skin curves away; keep the free edge straight.
      if (v * length > tipLimit && !Number.isNaN(lastHeight[j])) h = Math.max(Number.isNaN(h) ? -Infinity : h, lastHeight[j]);
      if (Number.isNaN(h)) h = 0;
      lastHeight[j] = h;
      p.addScaledVector(up, h + lift);
      under.push(p);
      const profile =
        (0.35 + 0.65 * Math.sin(Math.PI * s) ** 0.6) *
        (0.35 + 0.65 * THREE.MathUtils.smoothstep(t, 0, 0.2)) *
        (1 - 0.35 * THREE.MathUtils.smoothstep(t, 0.8, 1));
      top.push(p.clone().addScaledVector(up, thickness * profile));
      uvs.push(u, v);
    }
  }

  // Vertices: the top surface, the underside, then the edge wall (its own
  // copies, so the rim gets its own shading).
  const n = (rows + 1) * (cols + 1);
  const at = (i: number, j: number) => i * (cols + 1) + j;
  const loop: number[] = [];
  for (let j = 0; j < cols; j++) loop.push(at(0, j));
  for (let i = 0; i < rows; i++) loop.push(at(i, cols));
  for (let j = cols; j > 0; j--) loop.push(at(rows, j));
  for (let i = rows; i > 0; i--) loop.push(at(i, 0));
  const positions: number[] = [];
  const uv: number[] = [];
  for (const p of top) positions.push(p.x, p.y, p.z);
  for (const p of under) positions.push(p.x, p.y, p.z);
  uv.push(...uvs, ...uvs);
  for (const k of loop) {
    positions.push(top[k].x, top[k].y, top[k].z, under[k].x, under[k].y, under[k].z);
    uv.push(uvs[k * 2], uvs[k * 2 + 1], uvs[k * 2], uvs[k * 2 + 1]);
  }
  const index: number[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const k = at(i, j);
      index.push(k, k + 1, k + cols + 1, k + 1, k + cols + 2, k + cols + 1);
      index.push(n + k, n + k + cols + 1, n + k + 1, n + k + 1, n + k + cols + 1, n + k + cols + 2);
    }
  }
  const wall = 2 * n;
  for (let w = 0; w < loop.length; w++) {
    const a = wall + w * 2;
    const b = wall + ((w + 1) % loop.length) * 2;
    index.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return { geometry, aspect: length / width };
}

function Nail(props: { hand: PreparedHand; finger: Finger; design?: HTMLImageElement; fit: FitSettings; env: THREE.Texture }) {
  const { hand, finger, design, fit, env } = props;
  const hasDesign = Boolean(design);
  const { geometry, aspect } = useMemo(() => buildNail(hand, finger, fit, hasDesign), [hand, finger, fit, hasDesign]);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    paintNailTexture(canvas, design, aspect);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }, [design, aspect]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh geometry={geometry}>
      {/* Gel polish: a glossy top coat over the colour; a bare nail is satin. */}
      <meshPhysicalMaterial
        map={texture}
        envMap={env}
        envMapIntensity={0.5}
        side={THREE.DoubleSide}
        roughness={hasDesign ? 0.28 : 0.45}
        clearcoat={hasDesign ? 1 : 0.35}
        clearcoatRoughness={hasDesign ? 0.04 : 0.25}
        polygonOffset
        polygonOffsetFactor={-2}
      />
    </mesh>
  );
}

function HandModel(props: {
  designs: Partial<Record<Finger, HTMLImageElement>>;
  fit: FitSettings;
  skinTone: string;
  profile?: HandProfile | null;
}) {
  const { profile } = props;
  const gltf = useLoader(GLTFLoader, HAND_URL);
  const hand = useMemo(() => {
    if (!profile) return prepareHand(gltf.scene);
    // The loaded model is shared, so reshape a copy of it.
    const copy = cloneSkinned(gltf.scene) as THREE.Group;
    fitToProfile(copy, profile);
    return prepareHand(copy);
  }, [gltf, profile]);
  const env = useStudioEnvironment();
  const skin = useMemo(() => createSkinMaterial(env), [env]);
  useEffect(() => setSkinTone(skin, props.skinTone), [skin, props.skinTone]);
  useEffect(() => () => skin.dispose(), [skin]);
  // The model is a right hand; a scanned left hand is its mirror image.
  return (
    <group scale={[profile?.hand === "left" ? -1 : 1, 1, 1]}>
      <mesh geometry={hand.geometry} material={skin} />
      {FINGERS.map((f) => (
        <Nail key={f} hand={hand} finger={f} design={props.designs[f]} fit={props.fit} env={env} />
      ))}
    </group>
  );
}

export default function Hand3D(props: {
  designs: Partial<Record<Finger, HTMLImageElement>>;
  fit: FitSettings;
  skinTone: string;
  profile?: HandProfile | null;
  onCanvas?: (canvas: HTMLCanvasElement) => void;
}) {
  return (
    <Canvas
      className="hand3d"
      camera={{ position: [0.04, -0.02, 0.48], fov: 35, near: 0.01, far: 5 }}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      dpr={[1, 2]}
      onCreated={({ gl }) => props.onCanvas?.(gl.domElement)}
    >
      <hemisphereLight args={["#fff8f2", "#b9a29a", 0.35]} />
      <directionalLight position={[0.4, 0.6, 1]} intensity={1.2} color="#fff6ee" />
      <directionalLight position={[-0.6, -0.3, 0.6]} intensity={0.45} />
      <directionalLight position={[0, 0.2, -1]} intensity={0.6} />
      <HandModel designs={props.designs} fit={props.fit} skinTone={props.skinTone} profile={props.profile} />
      <ContactShadows position={[0, -0.12, 0]} opacity={0.25} scale={0.5} blur={2.5} far={0.3} />
      <OrbitControls makeDefault enablePan={false} enableDamping minDistance={0.18} maxDistance={0.7} />
    </Canvas>
  );
}
