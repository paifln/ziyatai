import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ZiyatAI",
    short_name: "ZiyatAI",
    description: "Мұғалімдерге арналған материалдар / Материалы для учителей",
    start_url: "/",
    display: "browser",
    background_color: "#f7f8f5",
    theme_color: "#245b42",
    icons: [{ src: "/favicon.png", type: "image/png", sizes: "64x64" }],
  };
}
