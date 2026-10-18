import type { Metadata } from "next";
import AdminPanel from "@/components/AdminPanel";
import LookPicker from "@/components/LookPicker";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = { title: "Gallery admin · Nail Try-On", robots: { index: false } };

export default function AdminPage() {
  return (
    <main className="container narrow">
      <SiteHeader link={{ href: "/", label: "Back to try-on" }} />
      <header className="hero">
        <h1>Gallery admin</h1>
        <p>Manage the preset designs customers can try on.</p>
      </header>
      <AdminPanel />
      <LookPicker layouts={false} />
    </main>
  );
}
