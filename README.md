# Nail Try-On

Try preset manicure designs on a rotatable 3D hand.

- The hand is a free-licensed rigged model (`public/hand/right.glb`, from `@webxr-input-profiles/assets`, MIT).
  Each nail is a small patch laid over the last segment of the finger and dropped onto the skin by raycasting, so
  it follows the finger's curve. Designs are clipped to the chosen nail shape (round, square or almond).
- Users can drag to rotate and scroll or pinch to zoom, put different designs on different fingers, change nail
  length and size, pick a skin tone, and save a picture.
- **Designs** come from a preset gallery. Only admins can add, remove or edit them, at `/admin`.
- Each design can carry an optional **purchase link** (http/https only), set when uploading or edited later in the
  admin gallery. The try-on page shows a "Buy" link on those gallery cards and a "Shop this look" list of the designs
  currently applied.

## Running it

```bash
npm install
cp .env.example .env.local   # then set ADMIN_PASSWORD
npm run dev            # http://localhost:3000, admin at http://localhost:3000/admin
```

Production: `npm run build && npm start`. The server needs a writable `DATA_DIR` (default `./data`) to keep
uploaded designs.

### Netlify (free tier)

1. Push this repo to GitHub, then in Netlify choose **Add new site → Import an existing project** and pick it.
   `netlify.toml` already sets the build and the Next.js runtime.
2. Under **Site configuration → Environment variables** add `ADMIN_PASSWORD` (and optionally `SESSION_SECRET`).
3. Deploy. On Netlify, uploaded designs and the gallery list are stored in Netlify Blobs (store `nail-designs`),
   chosen automatically at build time; see `src/lib/server/storage.ts`.

## Design images

PNG, JPEG or WebP, up to 5 MB. Portrait orientation with the **nail tip at the top** and the cuticle at the
bottom; the image is cropped to each nail like `object-fit: cover`. Eight built-in designs live in
`public/seed-designs/` and are shown until an admin changes the gallery.

## Layout

| Path | What it does |
| --- | --- |
| `src/components/Hand3D.tsx` | Loads the hand, builds the nail patches, renders the scene (three.js) |
| `src/lib/renderNails.ts` | Paints a design into a nail-shaped texture |
| `src/components/TryOn.tsx` | 3D viewer, design picker, nail and skin tone controls, Shop this look |
| `src/components/AdminPanel.tsx` | Admin sign-in, upload and removal |
| `src/app/api/designs` | Gallery API (public list and images; admin-only create, edit link/name, delete) |
| `src/app/api/admin/session` | Password sign-in with a signed, httpOnly session cookie |
