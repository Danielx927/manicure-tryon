"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { FINGERS, FINGER_LABELS, type Finger } from "@/lib/fingers";
import { loadProfile, saveProfile, type HandProfile } from "@/lib/handProfile";
import { formatPrice } from "@/lib/price";
import { DEFAULT_FIT, type FitSettings, type NailShape } from "@/lib/renderNails";
import { SKIN_TONES } from "./skinTones";
import { useDesigns, type PublicDesign } from "./useDesigns";

// three.js needs the browser, so the viewer is only rendered client-side.
const Hand3D = dynamic(() => import("./Hand3D"), {
  ssr: false,
  loading: () => <ViewerMessage text="Loading the 3D hand…" />,
});

// The scanner pulls in the hand tracking runtime, so load it only when used.
const ScanHand = dynamic(() => import("./ScanHand"), { ssr: false });
const LiveTryOn = dynamic(() => import("./LiveTryOn"), { ssr: false });

function ViewerMessage({ text }: { text: string }) {
  return (
    <div className="overlay" role="status">
      <span className="spinner" aria-hidden />
      {text}
    </div>
  );
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
  const [assigned, setAssigned] = useState<Partial<Record<Finger, string>>>({});
  const [targets, setTargets] = useState<Set<Finger>>(() => new Set(FINGERS));
  const [fit, setFit] = useState<FitSettings>(DEFAULT_FIT);
  const [skinTone, setSkinTone] = useState(SKIN_TONES[1]);
  const [designImages, setDesignImages] = useState<Record<string, HTMLImageElement>>({});
  const viewerCanvas = useRef<HTMLCanvasElement | null>(null);
  const [profile, setProfile] = useState<HandProfile | null>(null);
  const [useScanned, setUseScanned] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [live, setLive] = useState(false);

  // A saved scan lives only in this browser, so read it after hydration.
  useEffect(() => {
    const saved = loadProfile();
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setProfile(saved);
      setSkinTone(saved.skinTone);
    }
  }, []);

  const finishScan = (p: HandProfile) => {
    saveProfile(p);
    setProfile(p);
    setUseScanned(true);
    setSkinTone(p.skinTone);
    setScanning(false);
  };

  const forgetScan = () => {
    saveProfile(null);
    setProfile(null);
    setSkinTone(SKIN_TONES[1]);
  };

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

  const nailImages = useMemo(() => {
    const out: Partial<Record<Finger, HTMLImageElement>> = {};
    for (const f of FINGERS) {
      const id = assigned[f];
      if (id && designImages[id]) out[f] = designImages[id];
    }
    return out;
  }, [assigned, designImages]);

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
    viewerCanvas.current?.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "my-manicure.png";
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  };

  const hasDesign = Object.values(assigned).some(Boolean);
  const appliedDesigns = useMemo(
    () => designs.filter((d) => FINGERS.some((f) => assigned[f] === d.id)),
    [designs, assigned],
  );

  // Only total when every applied design has a price in the same currency.
  const total = useMemo(() => {
    const prices = appliedDesigns.map((d) => d.price);
    if (prices.length === 0 || prices.some((p) => !p || p.currency !== prices[0]!.currency)) return null;
    const amount = prices.reduce((sum, p) => sum + p!.amount, 0);
    return formatPrice({ amount: Math.round(amount * 100) / 100, currency: prices[0]!.currency });
  }, [appliedDesigns]);

  return (
    <div className="tryon">
      <section className="stage">
        <div className="viewer">
          <Hand3D
            designs={nailImages}
            fit={fit}
            skinTone={skinTone}
            profile={useScanned ? profile : null}
            onCanvas={(c) => (viewerCanvas.current = c)}
          />
          <p className="viewer-hint">Drag to rotate · scroll or pinch to zoom</p>
        </div>

        {!hasDesign && (
          <div className="notice info" role="status">
            Pick a design from the gallery to see it on the nails.
          </div>
        )}

        {appliedDesigns.length > 0 && (
          <div className="shop" aria-label="Shop this look">
            <h2>Shop this look</h2>
            <ul>
              {appliedDesigns.map((d) => (
                <li key={d.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className={d.photoUrl ? "photo" : undefined} src={d.photoUrl ?? d.imageUrl} alt="" />
                  <span>{d.name}</span>
                  <span className="shop-price">{d.price ? formatPrice(d.price) : ""}</span>
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
            {total && appliedDesigns.length > 1 && <p className="shop-total">Total {total}</p>}
          </div>
        )}

        <div className="hand-source">
          {profile ? (
            <>
              <div className="shape-picker" role="radiogroup" aria-label="Hand model">
                <button
                  type="button"
                  role="radio"
                  aria-checked={useScanned}
                  className={`chip${useScanned ? " on" : ""}`}
                  onClick={() => setUseScanned(true)}
                >
                  My hand
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!useScanned}
                  className={`chip${!useScanned ? " on" : ""}`}
                  onClick={() => setUseScanned(false)}
                >
                  Standard hand
                </button>
              </div>
              <button type="button" className="btn small" onClick={() => setScanning(true)}>
                Rescan
              </button>
              <button type="button" className="btn small" onClick={forgetScan}>
                Forget my scan
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => setScanning(true)}>
                Scan my hand
              </button>
              <span className="muted">Use your camera to shape the 3D hand like yours.</span>
            </>
          )}
        </div>

        <div className="stage-actions">
          <button type="button" className="btn primary" onClick={download} disabled={!hasDesign}>
            Save picture
          </button>
          <button type="button" className="btn" onClick={() => setLive(true)}>
            Try on with camera
          </button>
        </div>
      </section>

      <aside className="panel">
        <section className="panel-section designs-section">
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
              const used = FINGERS.some((f) => assigned[f] === d.id);
              return (
                <li key={d.id}>
                  <button
                    type="button"
                    className={`design${used ? " selected" : ""}`}
                    onClick={() => applyDesign(d)}
                    disabled={targets.size === 0}
                    title={`Apply ${d.name}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className={d.photoUrl ? "photo" : undefined} src={d.photoUrl ?? d.imageUrl} alt="" loading="lazy" />
                    <span>{d.name}</span>
                    {d.price && <span className="price">{formatPrice(d.price)}</span>}
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
        </section>

        <section className="panel-section">
          <h2>Nails</h2>
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
          <Slider label="Length" min={0} max={1} step={0.02} value={fit.extension} onChange={(extension) => setFit({ ...fit, extension })} />
          <Slider label="Size" min={0.8} max={1.15} step={0.01} value={fit.size} onChange={(size) => setFit({ ...fit, size })} />
        </section>

        <section className="panel-section">
          <h2>Skin tone</h2>
          <div className="swatches" role="radiogroup" aria-label="Skin tone">
            {profile && !SKIN_TONES.includes(profile.skinTone) && (
              <button
                type="button"
                role="radio"
                aria-checked={skinTone === profile.skinTone}
                aria-label="Your skin tone from the scan"
                title="From your scan"
                className={`swatch${skinTone === profile.skinTone ? " on" : ""}`}
                style={{ background: profile.skinTone }}
                onClick={() => setSkinTone(profile.skinTone)}
              />
            )}
            {SKIN_TONES.map((tone, i) => (
              <button
                key={tone}
                type="button"
                role="radio"
                aria-checked={skinTone === tone}
                aria-label={`Skin tone ${i + 1}`}
                className={`swatch${skinTone === tone ? " on" : ""}`}
                style={{ background: tone }}
                onClick={() => setSkinTone(tone)}
              />
            ))}
          </div>
        </section>
      </aside>

      {scanning && <ScanHand onDone={finishScan} onClose={() => setScanning(false)} />}
      {live && (
        <LiveTryOn designs={nailImages} fit={fit} gallery={designs} onApply={applyDesign} onClose={() => setLive(false)} />
      )}
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
