import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://adaptaula.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "AdaptAula — Materiales adaptados para NEE",
    template: "%s | AdaptAula",
  },
  description:
    "Adapta materiales educativos para alumnos con Necesidades Educativas Especiales usando inteligencia artificial. Perfiles TEA, TEL, Dislexia, TDAH y más.",
  openGraph: {
    title: "AdaptAula — Materiales adaptados para NEE",
    description:
      "Adapta materiales educativos para alumnos con Necesidades Educativas Especiales usando inteligencia artificial. Perfiles TEA, TEL, Dislexia, TDAH y más.",
    url: siteUrl,
    siteName: "AdaptAula",
    locale: "es_ES",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AdaptAula — Materiales adaptados para NEE",
    description:
      "Adapta materiales educativos para alumnos con Necesidades Educativas Especiales usando inteligencia artificial.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
