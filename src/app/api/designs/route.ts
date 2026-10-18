import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/server/auth";
import { serverError } from "@/lib/server/errors";
import {
  MAX_UPLOAD_BYTES,
  addDesign,
  listDesigns,
  parsePurchaseUrl,
  sniffImageType,
  toPublicDesign,
} from "@/lib/server/designs";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const designs = await listDesigns();
    return NextResponse.json({ designs: designs.map(toPublicDesign) });
  } catch (err) {
    return serverError("load the gallery", err);
  }
}

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only admins can add designs." }, { status: 401 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("image");
  const name = String(form?.get("name") ?? "").trim().slice(0, 60);
  if (!name) return NextResponse.json({ error: "Please give the design a name." }, { status: 400 });
  const rawUrl = String(form?.get("purchaseUrl") ?? "").trim();
  const purchaseUrl = rawUrl ? parsePurchaseUrl(rawUrl) : undefined;
  if (purchaseUrl === null) {
    return NextResponse.json({ error: "The purchase link must be a full web address starting with https://" }, { status: 400 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: "Please choose an image." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Images must be 4 MB or smaller." }, { status: 413 });
  }
  const data = Buffer.from(await file.arrayBuffer());
  const type = sniffImageType(data);
  if (!type) return NextResponse.json({ error: "Only PNG, JPEG or WebP images are accepted." }, { status: 415 });

  try {
    const design = await addDesign(name, data, type, purchaseUrl);
    return NextResponse.json({ design: toPublicDesign(design) }, { status: 201 });
  } catch (err) {
    return serverError("save the design", err);
  }
}
