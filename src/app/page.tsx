import TryOn from "@/components/TryOn";

export default function Home() {
  return (
    <main className="container">
      <header className="hero">
        <h1>Nail Try-On</h1>
        <p>Pick a design and turn the hand to see it from every angle.</p>
      </header>
      <TryOn />
    </main>
  );
}
