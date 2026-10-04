import type { MetadataRoute } from "next";

import { getBaseUrl } from "@/lib/base-url";
import { buildRobots } from "@/lib/seo/robots-rules";
import { getSeoSettings } from "@/lib/seo/store";

/**
 * robots.txt — kurallar /admin/seo "Sitemap ve robots" sekmesinden (seo.robots).
 * Güvenlik yolları (portallar, /app, /admin, /api...) koddadır (ALWAYS_DISALLOW) ve panelden çıkarılamaz.
 */
export const revalidate = 3600;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const s = await getSeoSettings();
  return buildRobots(getBaseUrl(), s.robots);
}
