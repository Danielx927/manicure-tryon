"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectHands, getHandLandmarker } from "@/lib/handDetector";
import { FINGERS, computeHandNails, type Finger, type HandNails } from "@/lib/nails";
import { DEFAULT_FIT, drawNail, type FitSettings, type NailShape } from "@/lib/renderNails";
import { useDesigns, type PublicDesign } from "./useDesigns";

const MAX_DIMENSION = 1600;

type Status =
  | { kind: "idle" }
  | { kind: "working"; text: string }
  | { kind: "ready" }
  | { kind: "problem"; title: string; text: string };

const FINGER_LABELS: Record<Finger, string> = {
  thumb: "Thumb",
  index: "Index",
  middle: "Middle",
  ring: "Ring",
  pinky: "Pinky",
};

async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  // createImageBitmap honours EXIF orientation, so phone photos come out upright.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

export default function TryOn() {
  const { designs, error: designsError } = useDesigns();
  const [photo, setPhoto] = useState<HTMLCanvasElement | null>(null);
  const [hands, setHands] = useState<HandNails[]>([]);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [assigned, setAssigned] = useState<Partial<Record<Finger, string>>>({});
  const [targets, setTargets] = useState<Set<Finger>>(() => new Set(FINGERS));
  const [fit, setFit] = useState<FitSettings>(DEFAULT_FIT);
  const [designImages, setDesignImages] = useState<Record<string, HTMLImageElement>>({});
  const [dragging, setDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Start fetching the model in the background so the first photo is quicker.
  useEffect(() => {
    getHandLandmarker().catch(() => undefined);
  }, []);

  // Load every design image that is assigned to a finger.
  useEffect(() => {
    const needed = new Set(Object.values(assigned).filter(Boolean) as string[]);
    for (const id of needed) {
      if (designImages[id]) continue;
      const design = designs.find((d) => d.id === id);
      if (!design) continue;
      loadImage(design.imageUrl)
        .then((img) => setDesignImages((prev) => ({ ...prev, [id]: img })))
        .catch(() => undefined);
    }
  }, [assigned, designs, designImages]);

  const handlePhoto = useCallback(async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus({ kind: "problem", title: "That isn't a photo", text: "Please choose a JPG, PNG or WebP image of your hand." });
      return;
    }
    setHands([]);
    setStatus({ kind: "working", text: "Reading your photo…" });
    let canvas: HTMLCanvasElement;
    try {
      canvas = await fileToCanvas(file);
    } catch {
      setPhoto(null);
      setStatus({ kind: "problem", title: "We couldn't open that photo", text: "The file may be damaged or in a format your browser can't read. Try a JPG or PNG." });
      return;
    }
    setPhoto(canvas);
    setStatus({ kind: "working", text: "Looking for your hands…" });
    try {
      const detected = await detectHands(canvas);
      const handNails = detected.map((h) => computeHandNails(h.landmarks, h.handedness));
      setHands(handNails);
      if (handNails.length === 0) {
        setStatus({
          kind: "problem",
          title: "We couldn't find a hand in this photo",
          text: "Try a bright, in-focus photo with your whole hand in view, the back of your hand towards the camera and your fingers slightly apart.",
        });
      } else if (handNails.every((h) => h.side === "palm")) {
        setStatus({
          kind: "problem",
          title: "We can see your palm",
          text: "Your nails are on the other side. Turn your hand around so the back of it faces the camera, then upload again.",
        });
      } else if (handNails.every((h) => h.nails.every((n) => !n.visible))) {
        setStatus({
          kind: "problem",
          title: "Your fingertips are hidden",
          text: "It looks like your fingers are curled. Stretch them out a little so each nail is visible, then upload again.",
        });
      } else {
        setStatus({ kind: "ready" });
      }
    } catch (err) {
      console.error(err);
      setStatus({
        kind: "problem",
        title: "Hand detection isn't available",
        text: "We couldn't start the hand detector in this browser. Please try a recent version of Chrome, Edge, Safari or Firefox.",
      });
    }
  }, []);

  // Redraw the preview whenever anything that affects it changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !photo) return;
    canvas.width = photo.width;
    canvas.height = photo.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(photo, 0, 0);
    for (const hand of hands) {
      if (hand.side === "palm") continue;
      for (const nail of hand.nails) {
        if (!nail.visible) continue;
        const designId = assigned[nail.finger];
        const img = designId ? designImages[designId] : undefined;
        if (img) drawNail(ctx, nail, img, fit);
      }
    }
  }, [photo, hands, assigned, designImages, fit]);

  const applyDesign = (design: PublicDesign) => {
    setAssigned((prev) => {
      const next = { ...prev };
      for (const f of targets) next[f] = design.id;
      return next;
    });
  };

  const toggleTarget = (finger: Finger) => {
    setTargets((prev) => {
      const next = new Set(prev);
      if (next.has(finger)) next.delete(finger);
      else next.add(finger);
      return next;
    });
  };

  const download = () => {
    canvasRef.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "my-manicure.png";
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  const hasDesign = useMemo(() => Object.values(assigned).some(Boolean), [assigned]);
  const appliedDesigns = useMemo(
    () => designs.filter((d) => FINGERS.some((f) => assigned[f] === d.id)),
    [designs, assigned],
  );
  const nailCount = hands.reduce(
    (n, h) => n + (h.side === "palm" ? 0 : h.nails.filter((x) => x.visible).length),
    0,
  );

  return (
    <div className="tryon">
      <section className="stage">
        <div
          className={`dropzone${dragging ? " dragging" : ""}${photo ? " has-photo" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            handlePhoto(e.dataTransfer.files[0]);
          }}
        >
          {photo ? (
            <canvas ref={canvasRef} className="preview" aria-label="Your photo with the chosen nail designs" />
          ) : (
            <button type="button" className="empty" onClick={() => fileInputRef.current?.click()}>
              <span className="empty-icon" aria-hidden>
                💅
              </span>
              <strong>Upload a photo of your hand</strong>
              <span>Drop it here or click to browse. Back of the hand facing the camera works best.</span>
            </button>
          )}
          {status.kind === "working" && (
            <div className="overlay" role="status">
              <span className="spinner" aria-hidden />
              {status.text}
            </div>
          )}
        </div>

        {status.kind === "problem" && (
          <div className="notice" role="alert">
            <strong>{status.title}</strong>
            <p>{status.text}</p>
          </div>
        )}
        {status.kind === "ready" && !hasDesign && (
          <div className="notice info" role="status">
            Found {hands.length === 1 ? "your hand" : `${hands.length} hands`} and {nailCount} nail{nailCount === 1 ? "" : "s"}. Pick a
            design to try it on.
          </div>
        )}

        {appliedDesigns.length > 0 && (
          <div className="shop" aria-label="Shop this look">
            <h2>Shop this look</h2>
            <ul>
              {appliedDesigns.map((d) => (
                <li key={d.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.imageUrl} alt="" />
                  <span>{d.name}</span>
                  {d.purchaseUrl ? (
                    <a className="btn small primary" href={d.purchaseUrl} target="_blank" rel="noopener noreferrer">
                      Buy this design
                    </a>
                  ) : (
                    <span className="muted">Not available to buy yet</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="stage-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              handlePhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <button type="button" className="btn" onClick={() => fileInputRef.current?.click()}>
            {photo ? "Use another photo" : "Choose photo"}
          </button>
          <button type="button" className="btn primary" onClick={download} disabled={!photo || !hasDesign}>
            Download result
          </button>
        </div>
      </section>

      <aside className="panel">
        <h2>Designs</h2>
        <fieldset className="targets">
          <legend>Apply to</legend>
          {FINGERS.map((f) => (
            <label key={f} className={`chip${targets.has(f) ? " on" : ""}`}>
              <input type="checkbox" checked={targets.has(f)} onChange={() => toggleTarget(f)} />
              {FINGER_LABELS[f]}
            </label>
          ))}
        </fieldset>

        {designsError && <p className="muted">{designsError}</p>}
        <ul className="gallery">
          {designs.map((d) => {
            const usedOn = FINGERS.filter((f) => assigned[f] === d.id);
            return (
              <li key={d.id}>
                <button
                  type="button"
                  className={`design${usedOn.length ? " selected" : ""}`}
                  onClick={() => applyDesign(d)}
                  disabled={targets.size === 0}
                  title={`Apply ${d.name}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={d.imageUrl} alt="" loading="lazy" />
                  <span>{d.name}</span>
                </button>
                {d.purchaseUrl && (
                  <a className="buy-link" href={d.purchaseUrl} target="_blank" rel="noopener noreferrer">
                    Buy
                  </a>
                )}
              </li>
            );
          })}
        </ul>
        {hasDesign && (
          <button type="button" className="btn small" onClick={() => setAssigned({})}>
            Remove all designs
          </button>
        )}

        <h2>Fit</h2>
        <div className="shape-picker" role="radiogroup" aria-label="Nail shape">
          {(["round", "square", "almond"] as NailShape[]).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={fit.shape === s}
              className={`chip${fit.shape === s ? " on" : ""}`}
              onClick={() => setFit({ ...fit, shape: s })}
            >
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
        <Slider label="Size" min={0.6} max={1.4} step={0.02} value={fit.size} onChange={(size) => setFit({ ...fit, size })} />
        <Slider label="Length" min={0} max={0.8} step={0.02} value={fit.extension} onChange={(extension) => setFit({ ...fit, extension })} />
        <Slider label="Position" min={-0.4} max={0.4} step={0.02} value={fit.offset} onChange={(offset) => setFit({ ...fit, offset })} />
        <button type="button" className="btn small" onClick={() => setFit(DEFAULT_FIT)}>
          Reset fit
        </button>
      </aside>
    </div>
  );
}

function Slider(props: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
