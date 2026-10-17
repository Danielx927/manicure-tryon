import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/server/auth";
import { MAX_UPLOAD_BYTES, addDesign, listDesigns, sniffImageType } from "@/lib/server/designs";

export const dynamic = "force-dynamic";

function toPublic(d: { id: string; name: string; createdAt: string }) {
  return { id: d.id, name: d.name, createdAt: d.createdAt, imageUrl: `/api/designs/${d.id}/image` };
}

export async function GET() {
  const designs = await listDesigns();
  return NextResponse.json({ designs: designs.map(toPublic) });
}

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only admins can add designs." }, { status: 401 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  const name = String(form?.get("name") ?? "").trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: "Please give the design a name." }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: "Please choose an image." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Images must be 5 MB or smaller." }, { status: 413 });
  }
  const data = Buffer.from(await file.arrayBuffer());
  const type = sniffImageType(data);
  if (!type) return NextResponse.json({ error: "Only PNG, JPEG or WebP images are accepted." }, { status: 415 });

  const design = await addDesign(name, data, type);
  return NextResponse.json({ design: toPublic(design) }, { status: 201 });
}
