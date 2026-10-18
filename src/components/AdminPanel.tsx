"use client";

import { useEffect, useState } from "react";
import { useDesigns } from "./useDesigns";

type Session = { configured: boolean; admin: boolean };

export default function AdminPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { designs, reload } = useDesigns();

  useEffect(() => {
    fetch("/api/admin/session")
      .then((r) => r.json())
      .then(setSession)
      .catch(() => setSession({ configured: false, admin: false }));
  }, []);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/admin/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) {
      setPassword("");
      setSession({ configured: true, admin: true });
    } else {
      const body = await res.json().catch(() => ({}));
      setMessage({ kind: "error", text: body.error ?? "Login failed." });
    }
  };

  const logout = async () => {
    await fetch("/api/admin/session", { method: "DELETE" });
    setSession((s) => (s ? { ...s, admin: false } : s));
  };

  const upload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const image = data.get("image");
    if (image instanceof File && image.size > 4 * 1024 * 1024) {
      setMessage({ kind: "error", text: "That image is over 4 MB. Please resize or compress it and try again." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/designs", { method: "POST", body: data }).catch(() => null);
    setBusy(false);
    if (!res) {
      setMessage({ kind: "error", text: "Couldn't reach the server. Check your connection and try again." });
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      form.reset();
      setMessage({ kind: "ok", text: `Added “${body.design.name}” to the gallery.` });
      reload();
    } else {
      if (res.status === 401) setSession((s) => (s ? { ...s, admin: false } : s));
      setMessage({ kind: "error", text: body.error ?? `Upload failed (server responded ${res.status}).` });
    }
  };

  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Remove “${name}” from the gallery?`)) return;
    const res = await fetch(`/api/designs/${id}`, { method: "DELETE" });
    if (res.ok) reload();
    else setMessage({ kind: "error", text: "Couldn't remove that design." });
  };

  if (!session) return <p className="muted">Loading…</p>;

  if (!session.configured) {
    return (
      <div className="notice">
        <strong>Admin access isn&apos;t set up</strong>
        <p>Set the ADMIN_PASSWORD environment variable on the server and restart it.</p>
      </div>
    );
  }

  if (!session.admin) {
    return (
      <form className="card login" onSubmit={login}>
        <h2>Admin sign in</h2>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
        </label>
        {message && <p className={message.kind === "error" ? "error" : "ok"}>{message.text}</p>}
        <button className="btn primary" disabled={busy}>
          Sign in
        </button>
      </form>
    );
  }

  return (
    <div className="admin">
      <form className="card" onSubmit={upload}>
        <div className="row">
          <h2>Add a design</h2>
          <button type="button" className="btn small" onClick={logout}>
            Sign out
          </button>
        </div>
        <p className="muted">
          PNG, JPEG or WebP up to 4 MB. Use a portrait image with the nail tip at the top and the cuticle at the bottom; it is
          cropped to each nail&apos;s shape.
        </p>
        <label>
          Name
          <input name="name" maxLength={60} required placeholder="e.g. Cherry Blossom" />
        </label>
        <label>
          Purchase link (optional)
          <input name="purchaseUrl" type="url" placeholder="https://shop.example.com/cherry-blossom" />
        </label>
        <label>
          Image
          <input name="image" type="file" accept="image/png,image/jpeg,image/webp" required />
        </label>
        {message && <p className={message.kind === "error" ? "error" : "ok"}>{message.text}</p>}
        <button className="btn primary" disabled={busy}>
          {busy ? "Uploading…" : "Add to gallery"}
        </button>
      </form>

      <section>
        <h2>Gallery ({designs.length})</h2>
        <ul className="gallery admin-gallery">
          {designs.map((d) => (
            <li key={d.id} className="design">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d.imageUrl} alt="" />
              <span>{d.name}</span>
              <PurchaseLinkEditor id={d.id} value={d.purchaseUrl} onSaved={reload} />
              <button type="button" className="btn small danger" onClick={() => remove(d.id, d.name)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function PurchaseLinkEditor(props: { id: string; value: string | null; onSaved: () => void }) {
  const [url, setUrl] = useState(props.value ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const dirty = url.trim() !== (props.value ?? "");

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("saving");
    const res = await fetch(`/api/designs/${props.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purchaseUrl: url }),
    });
    if (res.ok) {
      setState("saved");
      props.onSaved();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Couldn't save the link.");
      setState("error");
    }
  };

  return (
    <form className="link-editor" onSubmit={save}>
      <input
        type="url"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setState("idle");
        }}
        placeholder="Purchase link"
        aria-label="Purchase link"
      />
      {dirty && (
        <button className="btn small" disabled={state === "saving"}>
          Save link
        </button>
      )}
      {state === "saved" && !dirty && <span className="ok">Saved</span>}
      {state === "error" && <span className="error">{error}</span>}
    </form>
  );
}
