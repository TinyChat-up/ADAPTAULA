import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
// Display face for titles: the closest to the official wordmark's geometry (single-storey «a», round «o d p»); docs/BRAND.md §3.
const outfit = Outfit({ variable: "--font-outfit", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });

export const metadata: Metadata = {
  title: { default: "Adaptaula", template: "%s · Adaptaula" },
  description:
    "Sube tus fichas y crea versiones adaptadas a las necesidades de aprendizaje de tu alumnado. Para docentes de Primaria, ESO y Bachillerato.",
};

export const viewport: Viewport = { themeColor: "#05234b" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${inter.variable} ${outfit.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#contenido"
          className="sr-only z-[var(--layer-skip)] rounded-control bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Saltar al contenido
        </a>
        {children}
      </body>
    </html>
  );
}
