import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/server/auth";
import { serverError } from "@/lib/server/errors";
import { MAX_UPLOAD_BYTES, getDesignPhoto, setDesignPhoto, sniffImageType, toPublicDesign } from "@/lib/server/designs";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/designs/[id]/photo">) {
  const { id } = await ctx.params;
  const photo = await getDesignPhoto(id);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.contentType,
      // Each upload gets a new address, so the photo can be cached for long.
      "Cache-Control": "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}

/** Adds or replaces the design's gallery photo (form field "photo"). */
export async function PUT(request: Request, ctx: RouteContext<"/api/designs/[id]/photo">) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only admins can change photos." }, { status: 401 });
  }
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) return NextResponse.json({ error: "Please choose a photo." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "Photos must be 4 MB or smaller." }, { status: 413 });
  }
  const data = Buffer.from(await file.arrayBuffer());
  const type = sniffImageType(data);
  if (!type) return NextResponse.json({ error: "Only PNG, JPEG or WebP photos are accepted." }, { status: 415 });
  const { id } = await ctx.params;
  try {
    const design = await setDesignPhoto(id, { data, type });
    return design
      ? NextResponse.json({ design: toPublicDesign(design) })
      : NextResponse.json({ error: "Design not found." }, { status: 404 });
  } catch (err) {
    return serverError("save the photo", err);
  }
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/designs/[id]/photo">) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only admins can change photos." }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    const design = await setDesignPhoto(id, null);
    return design
      ? NextResponse.json({ design: toPublicDesign(design) })
      : NextResponse.json({ error: "Design not found." }, { status: 404 });
  } catch (err) {
    return serverError("remove the photo", err);
  }
}
