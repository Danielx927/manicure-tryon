import type { Metadata, Viewport } from "next";
import { Geist, Playfair_Display } from "next/font/google";
import { LOOK_INIT_SCRIPT } from "@/lib/looks";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Display face for the Noir theme's headings.
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nail Try-On",
  description: "Try manicure designs on a rotatable 3D hand.",
};

// "cover" lets the full-screen camera views reach the edges of notched phones.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // The look script sets data-theme/data-layout before React hydrates.
    <html lang="en" className={`${geistSans.variable} ${playfair.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LOOK_INIT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
