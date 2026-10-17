import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/server/auth";
import { deleteDesign } from "@/lib/server/designs";

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
