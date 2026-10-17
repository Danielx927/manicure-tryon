import { getDesignImage } from "@/lib/server/designs";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, ctx: RouteContext<"/api/designs/[id]/image">) {
  const { id } = await ctx.params;
  const image = await getDesignImage(id);
  if (!image) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(image.data), {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      // Seed designs are SVG; make sure they can never run script if opened directly.
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
