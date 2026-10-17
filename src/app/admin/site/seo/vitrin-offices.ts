import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformModule } from "@/lib/platform";
import { OPEN_LISTING_OR_FILTER } from "@/lib/closed-listing";
import { readAllPaged } from "@/lib/supabase/read-all-paged";
import { isNeverIndexTenant } from "@/lib/vitrin-seo/never-index";
import { loadNeverIndexList } from "@/lib/vitrin-seo/store";

/**
 * /admin/site/seo "Vitrin" sekmesinin verisi (salt okunur; kapı: requirePlatformModule("seo")). Ofislerin kendi arama
 * onayı (tenants.vitrin_seo_optin), vitrin açık/kapalı durumu, kalıcı noindex kuralı (liste + örnek veri) ve yayındaki
 * (açık, örnek olmayan) ilan sayısı. Onay kararı ofisindir; burada değiştirilmez.
 */

export type VitrinOfficeRow = {
  id: string;
  slug: string;
  name: string;
  vitrinEnabled: boolean;
  optin: boolean;
  /** Kalıcı noindex (liste, örnek veri ya da platform/demo türü): onaydan bağımsız noindex. */
  neverIndex: boolean;
  liveListings: number;
  /** Puan girdileri (vitrin SEO puanı, score.ts scoreVitrin). */
  withPhotos: number;
  withDescription: number;
  hasPhone: boolean;
  hasAddress: boolean;
  hasLogo: boolean;
};

export type VitrinOfficeData = {
  rows: VitrinOfficeRow[];
  total: number;
  neverIndexList: string[];
  /** İlan sayımı üst sınıra ulaştı ya da okunamadı: sayılar eksik olabilir. */
  countsPartial: boolean;
};

const ACTIVE = ["trial", "active", "past_due"];
const MAX_OFFICES = 200;

type TenantRow = {
  id: string;
  slug: string | null;
  name: string | null;
  vitrin_enabled: boolean | null;
  vitrin_seo_optin: boolean | null;
  sample_seeded_at: string | null;
  sample_cleared_at: string | null;
  phone: string | null;
  address_line: string | null;
  logo_url: string | null;
};

/** Açıklama "var" sayılır: en az bu kadar karakter (tek satırlık kopya başlık sayılmaz). */
const DESC_MIN_CHARS = 80;

export async function loadVitrinOffices(): Promise<VitrinOfficeData> {
  await requirePlatformModule("seo");
  const neverIndexList = await loadNeverIndexList();
  const empty: VitrinOfficeData = { rows: [], total: 0, neverIndexList, countsPartial: false };
  try {
    const admin = createAdminClient();
    const tenantsRes = await admin
      .from("tenants")
      .select("id, slug, name, vitrin_enabled, vitrin_seo_optin, sample_seeded_at, sample_cleared_at, phone, address_line, logo_url", { count: "exact" })
      .in("status", ACTIVE)
      .order("vitrin_seo_optin", { ascending: false })
      .order("name", { ascending: true })
      .limit(MAX_OFFICES);
    if (tenantsRes.error) return empty;
    const tenants = ((tenantsRes.data ?? []) as unknown as TenantRow[]).filter((t) => t.slug);
    const ids = tenants.map((t) => t.id);
    const counts = new Map<string, number>();
    const described = new Map<string, number>();
    const photos = new Map<string, number>();
    let countsPartial = false;
    if (ids.length > 0) {
      const { rows, error, truncated } = await readAllPaged<{ id: string; tenant_id: string; dlen: string | null }>(
        (from, to) =>
          admin
            .from("properties")
            .select("id, tenant_id, dlen:features->>description")
            .in("tenant_id", ids)
            .eq("status", "live")
            .eq("is_sample", false)
            .is("deleted_at", null)
            .or(OPEN_LISTING_OR_FILTER)
            .order("id")
            .range(from, to) as unknown as PromiseLike<{ data: { id: string; tenant_id: string; dlen: string | null }[] | null; error: { message: string } | null }>,
        { maxRows: 50_000 },
      );
      countsPartial = Boolean(error) || truncated;
      const live = new Map<string, string>();
      for (const r of rows) {
        const t = String(r.tenant_id);
        counts.set(t, (counts.get(t) ?? 0) + 1);
        if ((r.dlen ?? "").trim().length >= DESC_MIN_CHARS) described.set(t, (described.get(t) ?? 0) + 1);
        live.set(String(r.id), t);
      }
      // Fotoğraflı ilan: yayındaki ilanın en az bir görseli var (belge değil). Ofis kimliğiyle sayfalanır.
      if (live.size > 0) {
        const media = await readAllPaged<{ property_id: string }>(
          (from, to) =>
            admin
              .from("property_media")
              .select("property_id")
              .in("tenant_id", ids)
              .eq("kind", "image")
              .order("id")
              .range(from, to) as unknown as PromiseLike<{ data: { property_id: string }[] | null; error: { message: string } | null }>,
          { maxRows: 100_000 },
        );
        countsPartial = countsPartial || Boolean(media.error) || media.truncated;
        const seen = new Set<string>();
        for (const m of media.rows) {
          const pid = String(m.property_id);
          const t = live.get(pid);
          if (!t || seen.has(pid)) continue;
          seen.add(pid);
          photos.set(t, (photos.get(t) ?? 0) + 1);
        }
      }
    }
    return {
      rows: tenants.map((t) => ({
        id: t.id,
        slug: t.slug!,
        name: t.name ?? t.slug!,
        vitrinEnabled: t.vitrin_enabled !== false,
        optin: t.vitrin_seo_optin === true,
        neverIndex: isNeverIndexTenant(t, neverIndexList),
        liveListings: counts.get(t.id) ?? 0,
        withPhotos: photos.get(t.id) ?? 0,
        withDescription: described.get(t.id) ?? 0,
        hasPhone: Boolean(t.phone?.trim()),
        hasAddress: Boolean(t.address_line?.trim()),
        hasLogo: Boolean(t.logo_url?.trim()),
      })),
      total: tenantsRes.count ?? tenants.length,
      neverIndexList,
      countsPartial,
    };
  } catch {
    return empty;
  }
}
