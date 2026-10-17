import type { Metadata } from "next";
import Link from "next/link";
import AdminPanel from "@/components/AdminPanel";

export const metadata: Metadata = { title: "Gallery admin · Nail Try-On", robots: { index: false } };

export default function AdminPage() {
  return (
    <main className="container narrow">
      <header className="hero">
        <h1>Gallery admin</h1>
        <p>
          Manage the preset designs customers can try on. <Link href="/">Back to try-on</Link>
        </p>
      </header>
      <AdminPanel />
    </main>
  );
}
