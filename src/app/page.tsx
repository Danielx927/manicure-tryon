import TryOn from "@/components/TryOn";

export default function Home() {
  return (
    <main className="container">
      <header className="hero">
        <h1>Nail Try-On</h1>
        <p>Upload a photo of your hand and see how each design looks on your nails.</p>
      </header>
      <TryOn />
    </main>
  );
}
