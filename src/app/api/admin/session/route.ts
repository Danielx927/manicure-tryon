import { NextResponse } from "next/server";
import { SESSION_COOKIE, adminConfigured, checkPassword, createSessionToken, isAdmin } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ configured: adminConfigured(), admin: await isAdmin() });
}

/** Log in with the admin password. */
export async function POST(request: Request) {
  if (!adminConfigured()) {
    return NextResponse.json({ error: "Admin access is not set up on this server (ADMIN_PASSWORD)." }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!checkPassword(password)) {
    // Small fixed delay to slow down password guessing.
    await new Promise((r) => setTimeout(r, 800));
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });
  }
  const { token, maxAge } = createSessionToken();
  const res = NextResponse.json({ admin: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
  return res;
}

/** Log out. */
export async function DELETE() {
  const res = NextResponse.json({ admin: false });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
