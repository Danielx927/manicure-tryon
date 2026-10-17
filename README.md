# Nail Try-On

Upload a photo of your hand and try preset manicure designs on each fingernail.

- **Hand detection** runs entirely in the browser with MediaPipe Hand Landmarker. Photos never leave the device.
- If no hand is found, or only a palm or curled fingers are visible, the page explains what to change.
- Each nail is located from the finger's last joint and tip, then the design is clipped to a nail shape
  (round, square or almond), rotated along the finger, and shaded for curvature. Size, length and position
  can be fine-tuned with sliders, and different designs can go on different fingers.
- **Designs** come from a preset gallery. Only admins can add, remove or edit them, at `/admin`.
- Each design can carry an optional **purchase link** (http/https only), set when uploading or edited later in the
  admin gallery. The try-on page shows a "Buy" link on those gallery cards and a "Shop this look" list of the designs
  currently applied.

## Running it

```bash
npm install            # also copies the MediaPipe runtime and downloads the hand model into public/
cp .env.example .env.local   # then set ADMIN_PASSWORD
npm run dev            # http://localhost:3000, admin at http://localhost:3000/admin
```

Production: `npm run build && npm start`. The server needs a writable `DATA_DIR` (default `./data`) to keep
uploaded designs; on serverless hosts swap `src/lib/server/designs.ts` for object storage.

## Design images

PNG, JPEG or WebP, up to 5 MB. Portrait orientation with the **nail tip at the top** and the cuticle at the
bottom; the image is cropped to each nail like `object-fit: cover`. Eight built-in designs live in
`seed-designs/` and are shown until an admin changes the gallery.

## Layout

| Path | What it does |
| --- | --- |
| `src/lib/nails.ts` | Landmarks to nail positions, palm/back and curled-finger checks (pure, reusable for live camera) |
| `src/lib/renderNails.ts` | Draws a design onto one nail on a canvas |
| `src/lib/handDetector.ts` | Loads MediaPipe once and runs detection on a photo |
| `src/components/TryOn.tsx` | Upload, detection messages, design picker and fit controls |
| `src/components/AdminPanel.tsx` | Admin sign-in, upload and removal |
| `src/app/api/designs` | Gallery API (public list and images; admin-only create, edit link/name, delete) |
| `src/app/api/admin/session` | Password sign-in with a signed, httpOnly session cookie |
