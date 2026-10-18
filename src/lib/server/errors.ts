import "server-only";
import { NextResponse } from "next/server";

/** Logs an unexpected server error and returns a JSON message the admin page can show. */
export function serverError(action: string, err: unknown) {
  console.error(`[designs] ${action} failed`, err);
  const detail = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: `Couldn't ${action}. ${detail}` }, { status: 500 });
}
