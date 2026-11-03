import type { MetadataRoute } from "next";
import { siteOrigin } from "../apps/web/lib/site-metadata";
export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/privacy", "/terms", "/cookies", "/help/"].map((path) => ({
    url: `${siteOrigin}${path}`,
    changeFrequency: path ? "monthly" : "weekly",
  }));
}
