"use client";

import { useEffect, useState } from "react";
import { LAYOUT_KEY, LAYOUTS, THEME_KEY, THEMES, type LayoutId, type ThemeId } from "@/lib/looks";

function currentLook(key: "theme" | "layout"): string | undefined {
  return typeof document === "undefined" ? undefined : document.documentElement.dataset[key];
}

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the look still applies for this visit.
  }
}

/**
 * Floating "Change look" button that previews the themes and layouts. Meant
 * for choosing one; it can be removed once a look is settled on.
 */
export default function LookPicker(props: { layouts?: boolean }) {
  const [open, setOpen] = useState(false);
  // The init script has already applied the saved look, so start from it.
  // (The panel starts closed, so this can't differ between server and client.)
  const [theme, setTheme] = useState<ThemeId>(() => (currentLook("theme") as ThemeId) ?? "blush");
  const [layout, setLayout] = useState<LayoutId>(() => (currentLook("layout") as LayoutId) ?? "split");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    save(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.layout = layout;
    save(LAYOUT_KEY, layout);
  }, [layout]);

  return (
    <div className="look-picker">
      {open && (
        <div className="look-panel" role="dialog" aria-label="Change look">
          <h2>Theme</h2>
          <div className="look-options" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={theme === t.id}
                className={`look-option${theme === t.id ? " on" : ""}`}
                onClick={() => setTheme(t.id)}
              >
                <span className="look-swatch" style={{ background: t.swatch[0] }}>
                  <span style={{ background: t.swatch[1] }} />
                </span>
                {t.name}
              </button>
            ))}
          </div>
          {props.layouts !== false && (
            <>
              <h2>Layout</h2>
              <div className="look-layouts" role="radiogroup" aria-label="Layout">
                {LAYOUTS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="radio"
                    aria-checked={layout === l.id}
                    className={`look-layout${layout === l.id ? " on" : ""}`}
                    onClick={() => setLayout(l.id)}
                  >
                    <strong>{l.name}</strong>
                    <span>{l.blurb}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <p className="muted">Saved in this browser. Share a look with ?theme={theme}&amp;layout={layout}</p>
        </div>
      )}
      <button type="button" className="btn look-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Done" : "Change look"}
      </button>
    </div>
  );
}
