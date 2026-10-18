"use client";

import { useEffect, useRef, useState } from "react";
import type { Finger } from "@/lib/fingers";
import { backFacing } from "@/lib/handProfile";
import { getHandTracker } from "@/lib/handTracker";
import { computeHandNails, type Point } from "@/lib/nails";
import { drawNail, type FitSettings } from "@/lib/renderNails";
import type { PublicDesign } from "./useDesigns";

type Phase = "starting" | "error" | "live";

// Landmarks that outline the palm, and each finger's chain from its knuckle.
const PALM = [0, 1, 2, 5, 9, 13, 17];
const CHAINS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];

/**
 * Paints a soft-edged mask covering the hand: the palm polygon plus a thick
 * stroke along every finger. Everything outside it is hidden, so only the
 * hands show.
 */
function paintHandMask(ctx: CanvasRenderingContext2D, pts: Point[]) {
  const d = (a: number, b: number) => Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
  const knuckles = (d(5, 9) + d(9, 13) + d(13, 17)) / 3;
  const thick = Math.max(knuckles, d(7, 8) * 0.9) * 1.05;
  ctx.fillStyle = ctx.strokeStyle = "#fff";
  ctx.lineCap = ctx.lineJoin = "round";
  ctx.lineWidth = thick;
  ctx.beginPath();
  PALM.forEach((i, k) => (k ? ctx.lineTo(pts[i].x, pts[i].y) : ctx.moveTo(pts[i].x, pts[i].y)));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (const chain of CHAINS) {
    ctx.beginPath();
    ctx.moveTo(pts[chain[0]].x, pts[chain[0]].y);
    for (const i of chain.slice(1)) ctx.lineTo(pts[i].x, pts[i].y);
    // Reach a little past the tip landmark, which sits on the finger pad.
    const a = pts[chain[2]];
    const b = pts[chain[3]];
    ctx.lineTo(b.x + (b.x - a.x) * 0.25, b.y + (b.y - a.y) * 0.25);
    ctx.stroke();
  }
  // A bit of wrist, fading out.
  const wrist = pts[0];
  const up = { x: pts[9].x - wrist.x, y: pts[9].y - wrist.y };
  ctx.beginPath();
  ctx.moveTo(wrist.x, wrist.y);
  ctx.lineTo(wrist.x - up.x * 0.35, wrist.y - up.y * 0.35);
  ctx.lineWidth = thick * 2.2;
  ctx.stroke();
}

/**
 * Live try-on: the front camera with the chosen designs drawn onto the
 * user's own nails every frame. The view is masked to the hands.
 */
export default function LiveTryOn(props: {
  designs: Partial<Record<Finger, HTMLImageElement>>;
  fit: FitSettings;
  gallery: PublicDesign[];
  onApply: (design: PublicDesign) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>("starting");
  const [hint, setHint] = useState("Starting the camera…");
  const [error, setError] = useState("");
  // The draw loop reads the latest designs and fit without restarting.
  const latest = useRef({ designs: props.designs, fit: props.fit });
  useEffect(() => {
    latest.current = { designs: props.designs, fit: props.fit };
  }, [props.designs, props.fit]);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let cancelled = false;
    let lastTime = -1;
    const smoothed: Point[][] = [];
    const maskCanvas = document.createElement("canvas");

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
        setPhase("live");
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d")!;
        const mctx = maskCanvas.getContext("2d")!;

        const tick = () => {
          raf = requestAnimationFrame(tick);
          if (video.readyState < 2 || video.currentTime === lastTime) return;
          lastTime = video.currentTime;
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = maskCanvas.width = w;
            canvas.height = maskCanvas.height = h;
          }
          const result = tracker.detectForVideo(video, performance.now());
          const { designs, fit } = latest.current;

          ctx.save();
          ctx.clearRect(0, 0, w, h);
          if (result.landmarks.length === 0) {
            ctx.restore();
            smoothed.length = 0;
            setHint("No hands found. Hold your hand up in front of the camera, nails facing it.");
            return;
          }

          // Everything is drawn mirrored, like a mirror, so the saved photo matches the screen.
          const hands = result.landmarks.map((lm, i) => {
            const pts = lm.map((p) => ({ x: (1 - p.x) * w, y: p.y * h }));
            // Smooth out small jitter but follow real movement at once, so the
            // mask and nails never trail behind the hand.
            const prev = smoothed[i];
            const out =
              prev && prev.length === pts.length
                ? pts.map((p, k) => {
                    const t = Math.min(1, Math.max(0.5, Math.hypot(p.x - prev[k].x, p.y - prev[k].y) / (w * 0.012)));
                    return { x: prev[k].x + (p.x - prev[k].x) * t, y: prev[k].y + (p.y - prev[k].y) * t };
                  })
                : pts;
            smoothed[i] = out;
            return { pts: out, back: backFacing(lm, result.handedness[i]?.[0]?.categoryName) };
          });
          smoothed.length = hands.length;

          mctx.clearRect(0, 0, w, h);
          mctx.filter = `blur(${Math.round(w / 200)}px)`;
          for (const hand of hands) paintHandMask(mctx, hand.pts);
          mctx.filter = "none";

          ctx.translate(w, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, w, h);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalCompositeOperation = "destination-in";
          ctx.drawImage(maskCanvas, 0, 0);
          ctx.globalCompositeOperation = "source-over";

          let anyBack = false;
          for (const hand of hands) {
            if (!hand.back) continue;
            anyBack = true;
            for (const nail of computeHandNails(hand.pts).nails) {
              const design = designs[nail.finger];
              if (design && nail.visible) drawNail(ctx, nail, design, fit);
            }
          }
          ctx.restore();
          const anyDesign = Object.values(designs).some(Boolean);
          setHint(
            !anyBack
              ? "Turn your hand so your nails face the camera."
              : anyDesign
                ? ""
                : "Pick a design below to see it on your nails.",
          );
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
              : `Couldn't start the live try-on. ${err instanceof Error ? err.message : ""}`,
        );
        setPhase("error");
      }
    };
    start();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const save = () => {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "my-manicure-live.png";
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  return (
    <div className="scan live" role="dialog" aria-modal="true" aria-label="Live try-on">
      <button type="button" className="scan-close" onClick={props.onClose} aria-label="Close the live try-on">
        ×
      </button>
      <div className="live-frame">
        <video ref={videoRef} playsInline muted />
        <canvas ref={canvasRef} />
        {phase === "starting" && (
          <div className="scan-center">
            <span className="spinner" aria-hidden />
          </div>
        )}
      </div>

      <div className="scan-info" role="status" aria-live="polite">
        {phase === "error" ? (
          <>
            <p className="scan-hint">{error}</p>
            <button type="button" className="btn" onClick={props.onClose}>
              Close
            </button>
          </>
        ) : (
          <>
            {hint && <p className="scan-hint">{hint}</p>}
            <ul className="live-strip" aria-label="Designs">
              {props.gallery.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => props.onApply(d)} title={`Apply ${d.name}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={d.imageUrl} alt="" />
                    <span>{d.name}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn primary" onClick={save} disabled={phase !== "live"}>
              Save picture
            </button>
          </>
        )}
      </div>
    </div>
  );
}
