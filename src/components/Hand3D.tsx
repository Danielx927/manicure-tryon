"use client";

import { Canvas, useLoader } from "@react-three/fiber";
import { ContactShadows, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FINGERS, type Finger } from "@/lib/fingers";
import { paintNailTexture, type FitSettings } from "@/lib/renderNails";

// Generic right hand from @webxr-input-profiles/assets (MIT, see public/hand/LICENSE.txt).
const HAND_URL = "/hand/right.glb";

const DISTAL_BONES: Record<Finger, [string, string]> = {
  thumb: ["thumb-phalanx-distal", "thumb-tip"],
  index: ["index-finger-phalanx-distal", "index-finger-tip"],
  middle: ["middle-finger-phalanx-distal", "middle-finger-tip"],
  ring: ["ring-finger-phalanx-distal", "ring-finger-tip"],
  pinky: ["pinky-finger-phalanx-distal", "pinky-finger-tip"],
};


type FingerFrame = { base: THREE.Vector3; tip: THREE.Vector3; up: THREE.Vector3 };

type PreparedHand = {
  geometry: THREE.BufferGeometry;
  surface: THREE.Mesh;
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
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(baked, 3));
  if (src.index) geometry.setIndex(src.index.clone());

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

  geometry.applyMatrix4(toView);
  geometry.computeBoundingBox();
  const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  const place = (p: THREE.Vector3) => p.applyMatrix4(toView).sub(center);
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

  const surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  surface.updateMatrixWorld(true);
  return { geometry, surface, fingers };
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
function buildNail(hand: PreparedHand, finger: Finger, fit: FitSettings) {
  const { base, tip, up } = hand.fingers[finger];
  const along = tip.clone().sub(base);
  const segLen = along.length();
  along.normalize();
  const side = new THREE.Vector3().crossVectors(along, up).normalize();
  const ray = new THREE.Raycaster();
  const hitsFrom = (origin: THREE.Vector3, dir: THREE.Vector3) => {
    ray.set(origin, dir);
    return ray.intersectObject(hand.surface, false);
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

  const rows = 20;
  const cols = 12;
  const positions: number[] = [];
  const uvs: number[] = [];
  const lastHeight: number[] = new Array(cols + 1).fill(NaN);
  const lift = 0.0005;
  const above = 0.04;
  for (let i = 0; i <= rows; i++) {
    const v = i / rows;
    const centre = start.clone().addScaledVector(along, v * length);
    for (let j = 0; j <= cols; j++) {
      const u = j / cols;
      const p = centre.clone().addScaledVector(side, (u - 0.5) * width);
      const hit = hitsFrom(p.clone().addScaledVector(up, above), up.clone().negate())[0];
      let h = hit && hit.distance < above * 2 ? above - hit.distance : lastHeight[j];
      // Past the fingertip the skin curves away; keep the free edge straight.
      if (v * length > tipLimit && !Number.isNaN(lastHeight[j])) h = Math.max(Number.isNaN(h) ? -Infinity : h, lastHeight[j]);
      if (Number.isNaN(h)) h = 0;
      lastHeight[j] = h;
      p.addScaledVector(up, h + lift);
      positions.push(p.x, p.y, p.z);
      uvs.push(u, v);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const k = i * (cols + 1) + j;
      index.push(k, k + 1, k + cols + 1, k + 1, k + cols + 2, k + cols + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return { geometry, aspect: length / width };
}

function Nail(props: { hand: PreparedHand; finger: Finger; design?: HTMLImageElement; fit: FitSettings }) {
  const { hand, finger, design, fit } = props;
  const { geometry, aspect } = useMemo(() => buildNail(hand, finger, fit), [hand, finger, fit]);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    paintNailTexture(canvas, design, fit.shape, aspect);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }, [design, fit.shape, aspect]);

  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh geometry={geometry}>
      <meshPhysicalMaterial
        map={texture}
        transparent
        alphaTest={0.4}
        side={THREE.DoubleSide}
        roughness={0.35}
        clearcoat={1}
        clearcoatRoughness={0.08}
        polygonOffset
        polygonOffsetFactor={-2}
      />
    </mesh>
  );
}

function HandModel(props: { designs: Partial<Record<Finger, HTMLImageElement>>; fit: FitSettings; skinTone: string }) {
  const gltf = useLoader(GLTFLoader, HAND_URL);
  const hand = useMemo(() => prepareHand(gltf.scene), [gltf]);
  return (
    <group>
      <mesh geometry={hand.geometry}>
        <meshStandardMaterial color={props.skinTone} roughness={0.62} metalness={0} />
      </mesh>
      {FINGERS.map((f) => (
        <Nail key={f} hand={hand} finger={f} design={props.designs[f]} fit={props.fit} />
      ))}
    </group>
  );
}

export default function Hand3D(props: {
  designs: Partial<Record<Finger, HTMLImageElement>>;
  fit: FitSettings;
  skinTone: string;
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
      <hemisphereLight args={["#ffffff", "#b9a29a", 0.9]} />
      <directionalLight position={[0.4, 0.6, 1]} intensity={1.8} />
      <directionalLight position={[-0.6, -0.3, 0.6]} intensity={0.6} />
      <directionalLight position={[0, 0.2, -1]} intensity={0.5} />
      <HandModel designs={props.designs} fit={props.fit} skinTone={props.skinTone} />
      <ContactShadows position={[0, -0.12, 0]} opacity={0.25} scale={0.5} blur={2.5} far={0.3} />
      <OrbitControls makeDefault enablePan={false} enableDamping minDistance={0.18} maxDistance={0.7} />
    </Canvas>
  );
}
