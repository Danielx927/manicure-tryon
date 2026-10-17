import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/server/auth";
import { deleteDesign, parsePurchaseUrl, toPublicDesign, updateDesign } from "@/lib/server/designs";

/** Update a design's name and/or purchase link. An empty purchaseUrl removes it. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/designs/[id]">) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only admins can edit designs." }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { name?: unknown; purchaseUrl?: unknown } | null;
  const changes: { name?: string; purchaseUrl?: string | null } = {};
  if (typeof body?.name === "string") {
    const name = body.name.trim().slice(0, 60);
    if (!name) return NextResponse.json({ error: "Please give the design a name." }, { status: 400 });
    changes.name = name;
  }
  if (typeof body?.purchaseUrl === "string") {
    if (!body.purchaseUrl.trim()) {
      changes.purchaseUrl = null;
    } else {
      const url = parsePurchaseUrl(body.purchaseUrl);
      if (!url) {
        return NextResponse.json({ error: "The purchase link must be a full web address starting with https://" }, { status: 400 });
      }
      changes.purchaseUrl = url;
    }
  }
  const { id } = await ctx.params;
  const design = await updateDesign(id, changes);
  return design
    ? NextResponse.json({ design: toPublicDesign(design) })
    : NextResponse.json({ error: "Design not found." }, { status: 404 });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/designs/[id]">) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "Only admins can remove designs." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const removed = await deleteDesign(id);
  return removed
    ? new NextResponse(null, { status: 204 })
    : NextResponse.json({ error: "Design not found." }, { status: 404 });
}
