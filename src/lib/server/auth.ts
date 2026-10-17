import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function adminPassword(): string | null {
  return process.env.ADMIN_PASSWORD || null;
}

export function adminConfigured(): boolean {
  return adminPassword() !== null;
}

function signingKey(): Buffer {
  // A dedicated secret is preferred; otherwise derive one from the password,
  // which also invalidates sessions whenever the password changes.
  const secret = process.env.SESSION_SECRET || `pw:${adminPassword() ?? ""}`;
  return createHash("sha256").update(secret).digest();
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = createHash("sha256").update(a).digest();
  const bb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ab, bb);
}

export function checkPassword(candidate: string): boolean {
  const pw = adminPassword();
  return pw !== null && safeEqual(candidate, pw);
}

export function createSessionToken(): { token: string; maxAge: number } {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `admin.${expires}`;
  return { token: `${payload}.${sign(payload)}`, maxAge: SESSION_TTL_SECONDS };
}

function verifySessionToken(token: string | undefined): boolean {
  if (!token || !adminConfigured()) return false;
  const lastDot = token.lastIndexOf(".");
  if (lastDot < 0) return false;
  const payload = token.slice(0, lastDot);
  const signature = token.slice(lastDot + 1);
  if (!safeEqual(signature, sign(payload))) return false;
  const [role, expires] = payload.split(".");
  return role === "admin" && Number(expires) > Date.now() / 1000;
}

export async function isAdmin(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}
