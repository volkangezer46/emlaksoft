import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/admin";

import { getBaseUrl } from "@/lib/base-url";
const BASE_URL = getBaseUrl();

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes = [
    { path: "", priority: 1, freq: "weekly" as const },
    { path: "/kayit", priority: 0.9, freq: "monthly" as const },
    { path: "/giris", priority: 0.5, freq: "monthly" as const },
    { path: "/demo", priority: 0.8, freq: "monthly" as const },
    { path: "/gizlilik", priority: 0.3, freq: "yearly" as const },
    { path: "/kullanim-sartlari", priority: 0.3, freq: "yearly" as const },
  ];

  const entries: MetadataRoute.Sitemap = routes.map((route) => ({
    url: `${BASE_URL}${route.path}`,
    lastModified: new Date(),
    changeFrequency: route.freq,
    priority: route.priority,
  }));

  // Vitrin sayfaları — aktif (askıya alınmamış/iptal edilmemiş) tenant slug'ları.
  // Supabase env eksikse (örn. CI build) statik liste yeterlidir; sitemap kırılmasın.
  try {
    const admin = createAdminClient();
    const { data: tenants } = await admin
      .from("tenants")
      .select("slug, updated_at")
      .in("status", ["trial", "active"])
      .order("updated_at", { ascending: false })
      .limit(1000);

    for (const t of tenants ?? []) {
      if (!t.slug) continue;
      entries.push({
        url: `${BASE_URL}/vitrin/${t.slug}`,
        lastModified: t.updated_at ? new Date(t.updated_at) : new Date(),
        changeFrequency: "daily",
        priority: 0.7,
      });
    }

    // Danışman dijital kartvizitleri (/danisman/[slug]) — yalnız yayına alınmış
    // ve aktif profiller. Bu sayfalar bilerek indekslenebilir (bkz. sayfa başlığı
    // yorumu): danışmanın adıyla bulunabilirliği ürünün amacı.
    const { data: agents } = await admin
      .from("profiles")
      .select("public_slug")
      .eq("is_public", true)
      .eq("is_active", true)
      .not("public_slug", "is", null)
      .limit(5000);

    for (const a of agents ?? []) {
      if (!a.public_slug) continue;
      entries.push({
        url: `${BASE_URL}/danisman/${a.public_slug}`,
        lastModified: new Date(),
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }
  } catch {
    // env yoksa sessizce statik kısımla devam
  }

  return entries;
}
