"use client";

import { useEffect, useRef, useState } from "react";
import { angleBetween, backFacing, buildProfile, palmNormal, type HandProfile } from "@/lib/handProfile";
import { getHandTracker } from "@/lib/handTracker";

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

/** Median colour of a few pixels around each point, as [r, g, b]. */
function sampleSkin(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[]): [number, number, number] | null {
  const { width, height } = ctx.canvas;
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  for (const p of points) {
    const x = Math.round(p.x * width) - 2;
    const y = Math.round(p.y * height) - 2;
    if (x < 0 || y < 0 || x + 5 > width || y + 5 > height) continue;
    const data = ctx.getImageData(x, y, 5, 5).data;
    for (let i = 0; i < data.length; i += 4) {
      reds.push(data[i]);
      greens.push(data[i + 1]);
      blues.push(data[i + 2]);
    }
  }
  if (reds.length === 0) return null;
  const mid = (a: number[]) => a.sort((m, n) => m - n)[a.length >> 1];
  return [mid(reds), mid(greens), mid(blues)];
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
  const sideRef = useRef(side);
  useEffect(() => {
    sideRef.current = side;
  }, [side]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    let steady = 0;
    let startNormal: P3 | null = null;
    let maxTurn = 0;
    let lastTime = -1;
    let frame = 0;
    const worldFrames: P3[][] = [];
    const votes: string[] = [];
    const skin: [number, number, number][] = [];
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
            steady = 0;
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
          const back = backFacing(lm, label);

          if (current === "place") {
            let message = "";
            if (!back) message = "Turn your hand so the back of it (your nails) faces the camera.";
            else if (!inside) message = "Move your hand so it fits inside the outline.";
            else if (palm < 0.2) message = "Bring your hand a little closer.";
            else if (palm > 0.55) message = "Move your hand a little further away.";
            const ok = message === "";
            setAligned(ok);
            steady = ok ? steady + 1 : 0;
            setHint(ok ? "Hold still…" : message);
            if (steady >= STEADY_FRAMES) {
              startNormal = palmNormal(world);
              go("turn");
              setHint("Now slowly turn your hand left and right.");
            }
            return;
          }

          // Turning: collect measurements from every frame the hand is seen.
          setAligned(true);
          worldFrames.push(world);
          if (label) votes.push(label);
          maxTurn = Math.max(maxTurn, angleBetween(palmNormal(world), startNormal!));
          if (frame++ % 5 === 0 && back) {
            sampler.canvas.width = 160;
            sampler.canvas.height = Math.round((160 * h) / w);
            sampler.drawImage(video, 0, 0, sampler.canvas.width, sampler.canvas.height);
            // Back of the hand, between the wrist and the knuckles.
            const mid = (a: number, b: number, t: number) => ({ x: lm[a].x + (lm[b].x - lm[a].x) * t, y: lm[a].y + (lm[b].y - lm[a].y) * t });
            const sample = sampleSkin(sampler, [mid(0, 9, 0.45), mid(0, 5, 0.55), mid(0, 13, 0.55), mid(0, 17, 0.5)]);
            if (sample) skin.push(sample);
          }
          const p = Math.min(worldFrames.length / MIN_FRAMES, maxTurn / TURN_DEGREES, 1);
          setProgress(p);
          if (p < 1) {
            setHint(maxTurn < TURN_DEGREES ? "Keep turning slowly, left and right." : "Almost there, keep your hand in view.");
            return;
          }
          const result2 = buildProfile(worldFrames, votes, skin);
          // The hand the user picked is more reliable than the tracker's guess.
          setProfile({ ...result2, hand: sideRef.current });
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

  const mirror = side === "left" ? "translate(100 0) scale(-1 1)" : undefined;
  const pct = Math.round(progress * 100);

  return (
    <div className="scan" role="dialog" aria-modal="true" aria-label="Scan your hand">
      <button type="button" className="scan-close" onClick={props.onClose} aria-label="Close the hand scan">
        ×
      </button>

      <div className="scan-frame">
        <video ref={videoRef} playsInline muted />
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
          <g transform={mirror} mask="url(#scan-hole)" className={`scan-outline${aligned ? " ok" : ""}`}>
            <HandShapes fill="currentColor" grow={0.9} />
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
            <button type="button" className="btn primary" onClick={() => props.onDone(profile)}>
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
