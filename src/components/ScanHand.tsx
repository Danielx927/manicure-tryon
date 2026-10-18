"use client";

import { useEffect, useRef, useState } from "react";
import { angleBetween, backFacing, buildProfile, closedFingers, palmNormal, type HandProfile } from "@/lib/handProfile";
import { getHandTracker } from "@/lib/handTracker";
import { frameWhite, shiftTone, type RGB, type SkinSample } from "@/lib/skinTone";

type Phase = "starting" | "denied" | "place" | "turn" | "done";
type P3 = { x: number; y: number; z: number };

const STEADY_FRAMES = 15;
const MIN_FRAMES = 60;
const TURN_DEGREES = 40;

// Open-hand outline in a 100×100 box: a right hand seen from the back, as it
// appears in the mirrored camera view (thumb on the right).
const FINGERS_OUTLINE: [number, number, number, number, number][] = [
  [33, 60, 27, 31, 8],
  [43, 56, 40, 18, 9],
  [52, 55, 52, 12, 9.5],
  [61, 56, 65, 19, 9],
  [67, 75, 84, 50, 10],
];

function HandShapes(props: { grow?: number; fill: string }) {
  const g = props.grow ?? 0;
  return (
    <g fill={props.fill} stroke={props.fill} strokeLinecap="round">
      <rect x={27 - g} y={50 - g} width={44 + 2 * g} height={44 + 2 * g} rx={12 + g} strokeWidth={0} />
      <rect x={34 - g} y={84} width={30 + 2 * g} height={20} strokeWidth={0} />
      {FINGERS_OUTLINE.map(([x1, y1, x2, y2, w], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={w + 2 * g} />
      ))}
    </g>
  );
}

/**
 * Pixels from the back of the hand (a grid between the wrist and the
 * knuckles) and the frame's brightest colour, from a small copy of the frame.
 */
function sampleSkin(ctx: CanvasRenderingContext2D, lm: { x: number; y: number }[]): SkinSample {
  const { width, height } = ctx.canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const skin: RGB[] = [];
  for (const knuckle of [5, 9, 13, 17]) {
    for (const t of [0.35, 0.55, 0.75]) {
      const cx = Math.round((lm[0].x + (lm[knuckle].x - lm[0].x) * t) * width);
      const cy = Math.round((lm[0].y + (lm[knuckle].y - lm[0].y) * t) * height);
      for (let y = cy - 2; y <= cy + 2; y++) {
        for (let x = cx - 2; x <= cx + 2; x++) {
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const i = (y * width + x) * 4;
          skin.push([data[i], data[i + 1], data[i + 2]]);
        }
      }
    }
  }
  // The hand itself (and its shine) shouldn't count as the frame's white.
  const xs = lm.map((p) => p.x * width);
  const ys = lm.map((p) => p.y * height);
  const pad = 0.15 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const hand = { x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
  return { skin, white: frameWhite(data, width, hand) };
}

/**
 * Guided hand scan: the camera view is masked to a hand outline, the user
 * holds the back of their hand inside it and turns it slowly while hand
 * landmarks are collected. Nothing leaves the device.
 */
export default function ScanHand(props: { onDone: (profile: HandProfile) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [hint, setHint] = useState("Starting the camera…");
  const [progress, setProgress] = useState(0);
  const [aligned, setAligned] = useState(false);
  const [side, setSide] = useState<"right" | "left">("right");
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<HandProfile | null>(null);
  // Lighter/darker steps the user applied to the measured skin tone.
  const [toneSteps, setToneSteps] = useState(0);
  const sideRef = useRef(side);
  useEffect(() => {
    sideRef.current = side;
  }, [side]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    let steady = 0;
    const recentLabels: ("left" | "right")[] = [];
    let startNormal: P3 | null = null;
    let maxTurn = 0;
    let lastTime = -1;
    let frame = 0;
    const worldFrames: P3[][] = [];
    const votes: string[] = [];
    const skin: SkinSample[] = [];
    const sampler = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    let current: Phase = "starting";
    const go = (p: Phase) => {
      current = p;
      setPhase(p);
    };

    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser can't use the camera here.");
        const [s, tracker] = await Promise.all([
          navigator.mediaDevices.getUserMedia({
            video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: false,
          }),
          getHandTracker(),
        ]);
        stream = s;
        if (cancelled) return;
        const video = videoRef.current!;
        video.srcObject = s;
        await video.play();
        go("place");
        setHint("Hold the back of your hand inside the outline, fingers spread.");

        const tick = () => {
          raf = requestAnimationFrame(tick);
          if (current === "done" || video.readyState < 2 || video.currentTime === lastTime) return;
          lastTime = video.currentTime;
          const result = tracker.detectForVideo(video, performance.now());
          const lm = result.landmarks[0];
          const world = result.worldLandmarks[0];
          const label = result.handedness[0]?.[0]?.categoryName;
          if (!lm || !world) {
            steady = Math.max(0, steady - 3);
            setAligned(false);
            setHint(current === "turn" ? "Lost your hand. Bring it back into the outline." : "No hand found yet. Hold your hand up inside the outline.");
            return;
          }

          // Map landmarks into the square the outline is drawn in (mirrored, centre-cropped).
          const w = video.videoWidth;
          const h = video.videoHeight;
          const size = Math.min(w, h);
          const inSquare = lm.map((p) => ({ x: ((1 - p.x) * w - (w - size) / 2) / size, y: (p.y * h - (h - size) / 2) / size }));
          const inside = inSquare.every((p) => p.x > 0.08 && p.x < 0.92 && p.y > 0.02 && p.y < 1.04);
          const palm = Math.hypot(inSquare[9].x - inSquare[0].x, inSquare[9].y - inSquare[0].y);
          // The tracker tells left from right reliably on the raw (unmirrored)
          // camera frame; it has to agree with the hand the user picked.
          const chosen = sideRef.current;
          // Judge by the last few frames: the label can flicker for a frame
          // when the hand is edge-on.
          recentLabels.push(label === "Left" ? "left" : label === "Right" ? "right" : chosen);
          if (recentLabels.length > 9) recentLabels.shift();
          const seen = recentLabels.filter((l) => l === "left").length * 2 > recentLabels.length ? "left" : "right";
          const wrongHand = seen !== chosen;
          const back = backFacing(lm, chosen === "right" ? "Right" : "Left");
          const open = closedFingers(world).length === 0;
          const wrongHandHint = `That looks like your ${seen} hand. Show your ${chosen} hand, or pick "${seen === "left" ? "Left" : "Right"} hand" below.`;
          const openHint = "Open your hand and spread your fingers.";

          if (current === "place") {
            let message = "";
            if (wrongHand) message = wrongHandHint;
            else if (!back) message = "Turn your hand so the back of it (your nails) faces the camera.";
            else if (!open) message = openHint;
            else if (!inside) message = "Move your hand so it fits inside the outline.";
            else if (palm < 0.2) message = "Bring your hand a little closer.";
            else if (palm > 0.55) message = "Move your hand a little further away.";
            const ok = message === "";
            setAligned(ok);
            // A single bad frame shouldn't restart the countdown.
            steady = ok ? steady + 1 : Math.max(0, steady - 3);
            setHint(ok ? "Hold still…" : message);
            if (steady >= STEADY_FRAMES) {
              startNormal = palmNormal(world);
              go("turn");
              setHint("Now slowly turn your hand left and right.");
            }
            return;
          }

          // Turning: collect measurements from every frame showing the right,
          // open hand; anything else would skew the lengths.
          if (wrongHand || !open) {
            setAligned(false);
            setHint(wrongHand ? wrongHandHint : openHint);
            return;
          }
          setAligned(true);
          worldFrames.push(world);
          if (label) votes.push(label);
          maxTurn = Math.max(maxTurn, angleBetween(palmNormal(world), startNormal!));
          if (frame++ % 5 === 0 && back) {
            sampler.canvas.width = 240;
            sampler.canvas.height = Math.round((240 * h) / w);
            sampler.drawImage(video, 0, 0, sampler.canvas.width, sampler.canvas.height);
            skin.push(sampleSkin(sampler, lm));
          }
          const p = Math.min(worldFrames.length / MIN_FRAMES, maxTurn / TURN_DEGREES, 1);
          setProgress(p);
          if (p < 1) {
            setHint(maxTurn < TURN_DEGREES ? "Keep turning slowly, left and right." : "Almost there, keep your hand in view.");
            return;
          }
          const result2 = buildProfile(worldFrames, votes, skin);
          setProfile({ ...result2, hand: chosen });
          go("done");
          setHint("Scan complete.");
        };
        raf = requestAnimationFrame(tick);
      } catch (err) {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        setError(
          name === "NotAllowedError"
            ? "Camera access was blocked. Allow the camera for this site in your browser settings, then try again."
            : name === "NotFoundError"
              ? "No camera was found on this device."
              : `Couldn't start the hand scan. ${err instanceof Error ? err.message : ""}`,
        );
        go("denied");
      }
    };
    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const tone = profile ? shiftTone(profile.skinTone, toneSteps) : "";
  const mirror = side === "left" ? "translate(100 0) scale(-1 1)" : undefined;
  const pct = Math.round(progress * 100);

  return (
    <div className="scan" role="dialog" aria-modal="true" aria-label="Scan your hand">
      <button type="button" className="scan-close" onClick={props.onClose} aria-label="Close the hand scan">
        ×
      </button>

      <div className="scan-frame">
        <video ref={videoRef} playsInline muted autoPlay />
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden>
          <defs>
            <mask id="scan-hole">
              <rect x="-50" y="-50" width="200" height="200" fill="white" />
              <g transform={mirror}>
                <HandShapes fill="black" />
              </g>
            </mask>
          </defs>
          {/* Everything outside the outline is hidden, so only the hand shows. */}
          <rect x="-50" y="-50" width="200" height="200" fill="#0b0b0f" opacity="0.94" mask="url(#scan-hole)" />
          {/* The mask goes on an unmirrored group: on the mirrored one it would be
              mirrored a second time and no longer match the left-hand outline. */}
          <g mask="url(#scan-hole)" className={`scan-outline${aligned ? " ok" : ""}`}>
            <g transform={mirror}>
              <HandShapes fill="currentColor" grow={0.9} />
            </g>
          </g>
        </svg>
        {phase === "starting" && (
          <div className="scan-center">
            <span className="spinner" aria-hidden />
          </div>
        )}
      </div>

      <div className="scan-info" role="status" aria-live="polite">
        {phase === "denied" ? (
          <>
            <p className="scan-hint">{error}</p>
            <button type="button" className="btn" onClick={props.onClose}>
              Close
            </button>
          </>
        ) : phase === "done" && profile ? (
          <>
            <p className="scan-hint">Got it! Your 3D hand now matches your finger lengths and palm.</p>
            <div className="scan-tone">
              <span className="scan-tone-swatch" style={{ background: tone }} aria-hidden />
              <div>
                <p>Your skin tone. Cameras can get it a little off, so adjust it if needed.</p>
                <div className="scan-tone-buttons">
                  <button type="button" className="chip" onClick={() => setToneSteps((n) => n - 1)}>
                    Darker
                  </button>
                  <button type="button" className="chip" onClick={() => setToneSteps((n) => n + 1)}>
                    Lighter
                  </button>
                </div>
              </div>
            </div>
            <button type="button" className="btn primary" onClick={() => props.onDone({ ...profile, skinTone: tone })}>
              See my hand
            </button>
          </>
        ) : (
          <>
            <p className="scan-hint">{hint}</p>
            <div className="scan-progress" aria-label={`Scan ${pct}% done`}>
              <span style={{ width: `${pct}%` }} />
            </div>
            {phase !== "turn" && (
              <div className="scan-side" role="radiogroup" aria-label="Which hand">
                {(["left", "right"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={side === s}
                    className={`chip${side === s ? " on" : ""}`}
                    onClick={() => setSide(s)}
                  >
                    {s === "left" ? "Left hand" : "Right hand"}
                  </button>
                ))}
              </div>
            )}
            <p className="scan-privacy">The scan runs on your device. No video is uploaded.</p>
          </>
        )}
      </div>
    </div>
  );
}
