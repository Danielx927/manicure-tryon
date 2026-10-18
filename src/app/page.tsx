import LookPicker from "@/components/LookPicker";
import SiteHeader from "@/components/SiteHeader";
import TryOn from "@/components/TryOn";

export default function Home() {
  return (
    <main className="container">
      <SiteHeader link={{ href: "/admin", label: "Admin" }} />
      <header className="hero">
        <h1>Find your next manicure</h1>
        <p>Pick a design and turn the hand to see it from every angle.</p>
      </header>
      <TryOn />
      <LookPicker />
    </main>
  );
}
