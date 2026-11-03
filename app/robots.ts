import type { MetadataRoute } from "next";
import { siteOrigin } from "../apps/web/lib/site-metadata";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/login", "/signup", "/lite/"],
    },
    sitemap: `${siteOrigin}/sitemap.xml`,
  };
}
