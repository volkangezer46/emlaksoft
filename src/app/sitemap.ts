import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/admin";

import { getBaseUrl } from "@/lib/base-url";
const BASE_URL = getBaseUrl();

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const routes = [
    { path: "", priority: 1, freq: "weekly" as const },
    { path: "/kayit", priority: 0.9, freq: "monthly" as const },
    { path: "/fiyatlar", priority: 0.8, freq: "monthly" as const },
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
      .select("id, slug, updated_at")
      .in("status", ["trial", "active", "past_due"])
      .order("updated_at", { ascending: false })
      .limit(1000);
    const publicTenantIds = new Set<string>();

    for (const t of tenants ?? []) {
      publicTenantIds.add(t.id);
      if (!t.slug) continue;
      entries.push({
        url: `${BASE_URL}/vitrin/${t.slug}`,
        lastModified: t.updated_at ? new Date(t.updated_at) : new Date(),
        changeFrequency: "daily",
        priority: 0.7,
      });
    }

    // Yayındaki (status=live) ilan detayları — yalnız aktif ofislerin; token'lı portallar HARİÇ.
    const tenantSlug = new Map<string, string>();
    for (const t of tenants ?? []) if (t.slug) tenantSlug.set(t.id, t.slug);
    const { data: listings } = await admin
      .from("properties")
      .select("id, tenant_id, updated_at")
      .eq("status", "live")
      .is("deleted_at", null)
      .eq("is_sample", false)
      .order("updated_at", { ascending: false })
      .limit(10000);
    for (const l of listings ?? []) {
      const sl = tenantSlug.get(l.tenant_id);
      if (!sl) continue;
      entries.push({
        url: `${BASE_URL}/vitrin/${sl}/${l.id}`,
        lastModified: l.updated_at ? new Date(l.updated_at) : new Date(),
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }

    // Danışman dijital kartvizitleri (/danisman/[slug]) — yalnız yayına alınmış
    // ve aktif profiller. Bu sayfalar bilerek indekslenebilir (bkz. sayfa başlığı
    // yorumu): danışmanın adıyla bulunabilirliği ürünün amacı.
    const { data: agents } = await admin
      .from("profiles")
      .select("public_slug, tenant_id")
      .eq("is_public", true)
      .eq("is_active", true)
      .not("public_slug", "is", null)
      .limit(5000);

    for (const a of agents ?? []) {
      if (!a.public_slug || !publicTenantIds.has(a.tenant_id)) continue;
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
