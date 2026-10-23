import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Adaptaula",
    short_name: "Adaptaula",
    description: "Adapta tus materiales educativos a las necesidades de aprendizaje de tu alumnado.",
    start_url: "/app",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#05234b",
    lang: "es",
    icons: [
      { src: "/brand/adaptaula-icono-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/adaptaula-icono-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
