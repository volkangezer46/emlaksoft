import type { SupabaseClient } from "@supabase/supabase-js";
import { getBaseUrl } from "@/lib/base-url";
import { now, trDayKey } from "@/lib/clock";
import { loadVitrinSettings } from "@/lib/vitrin-settings";
import { loadNeverIndexList } from "@/lib/vitrin-seo/store";
import { postIndexNow, type IndexNowEventOutcome } from "./indexnow-events";
import {
  indexNowEventAlreadySent,
  indexNowEventPrints,
  listingIndexNowEligibility,
  type ListingIndexNowListing,
} from "./indexnow-public-rules";
import { canonicalUrl } from "./rules";
import { INDEXNOW_DAILY_LIMIT } from "./schema";
import { canAutoOptimize, pathOfUrl } from "./scope";
import { getSeoSettings, readIndexNow, readIndexNowSeen, writeIndexNow, writeIndexNowSeen } from "./store";

/**
 * Herkese açık içerik (vitrin ilanı, rehber yazısı) YAYIN ANI IndexNow bildirimi. Çağıran HER ZAMAN `afterSafe` içinde
 * çağırır: eylemi bekletmez, hata eylemi etkilemez. IndexNow kapalıysa ya da anahtar yoksa veritabanı da okunmaz.
 * Uygunluk kuralları ve tekrar/sıklık sınırı: indexnow-public-rules.ts (SAF). Günlük sınır ve "Son bildirimler"
 * listesi olay bildirimiyle (indexnow-events.ts) ortaktır.
 */

const OFF: IndexNowEventOutcome = { sent: 0, status: "kapalı", skipped: "IndexNow etkin değil" };

const iso = (v: unknown): string | undefined => {
  if (typeof v !== "string" || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

async function indexNowReady() {
  const s = await readIndexNow();
  if (!s.enabled || !/^[a-f0-9]{32}$/.test(s.key)) return null;
  return s;
}

/** Tek adresi bildirir: tekrar (lastmod / aynı gün) ve günlük sınır denetlenir, başarıda parmak izleri yazılır. */
async function sendOne(url: string, lastModified: string | undefined, nowMs: number): Promise<IndexNowEventOutcome> {
  const s = await indexNowReady();
  if (!s) return OFF;
  const seen = await readIndexNowSeen();
  const prints = indexNowEventPrints(url, lastModified, nowMs);
  if (indexNowEventAlreadySent(seen, prints)) return { sent: 0, status: "zaten bildirildi", skipped: "Bu adres bugün ya da bu sürümüyle bildirildi" };

  const today = trDayKey(nowMs);
  const usedToday = s.dayKey === today ? s.dayCount : 0;
  if (usedToday >= INDEXNOW_DAILY_LIMIT) return { sent: 0, status: "günlük sınır doldu", skipped: "Günlük IndexNow sınırı doldu" };

  const res = await postIndexNow(s.key, [url], "yayin", nowMs);
  if (res.ok) {
    seen.add(prints.lastmod);
    seen.add(prints.day);
    await writeIndexNowSeen(seen);
  }
  await writeIndexNow({
    ...s,
    lastSentAt: new Date(nowMs).toISOString(),
    lastCount: res.ok ? 1 : 0,
    lastStatus: res.status,
    dayKey: today,
    dayCount: usedToday + (res.ok ? 1 : 0),
  });
  return { sent: res.ok ? 1 : 0, status: res.status };
}

/**
 * Vitrin ilanı yayına alındı/düzenlendi. `client`: çağıranın istemcisi (kullanıcı RLS'i ya da eylemin kendi service
 * istemcisi); sorgular ofis kimliğiyle süzülür. Yalnız ofis arama onayı açık, kalıcı noindex listesinde olmayan ve
 * yayındaki (örnek/silinmiş/kapanmış olmayan) ilan bildirilir.
 */
export async function notifyListingIndexNow(
  client: SupabaseClient,
  tenantId: string,
  propertyId: string,
  opts: { nowMs?: number } = {},
): Promise<IndexNowEventOutcome> {
  if (!(await indexNowReady())) return OFF;
  const [{ data: listing }, { data: tenant }, vitrin, neverIndexList, seo] = await Promise.all([
    client
      .from("properties")
      .select(
        "id, status, is_sample, deleted_at, features, updated_at, transaction_type, property_type, district:geo_districts(name), province:geo_provinces(name)",
      )
      .eq("id", propertyId)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    client.from("tenants").select("slug, status, sample_seeded_at, sample_cleared_at").eq("id", tenantId).maybeSingle(),
    loadVitrinSettings(client, tenantId),
    loadNeverIndexList(),
    getSeoSettings(),
  ]);
  const t = tenant as { slug: string | null; status: string | null; sample_seeded_at: string | null; sample_cleared_at: string | null } | null;
  const l = listing as (ListingIndexNowListing & { updated_at: string | null }) | null;
  const verdict = listingIndexNowEligibility({
    // Ayar sütunları yoksa varsayılan: arama onayı yok (bildirilmez).
    tenant: t ? { ...t, vitrinEnabled: vitrin.settings.enabled, seoOptin: vitrin.settings.seoOptin } : null,
    listing: l,
    neverIndexList,
    sitemapListingsOn: seo.sitemap.vitrinListings,
  });
  if (!verdict.ok) return { sent: 0, status: "kapsam dışı", skipped: verdict.reason };
  return sendOne(canonicalUrl(getBaseUrl(), verdict.path), iso(l?.updated_at), opts.nowMs ?? now());
}

/**
 * Rehber yazısı yayına alındı. Yalnız sitemap'teki (yayında, indekslenebilir, ince olmayan) yazı bildirilir; lastmod
 * sitemap girdisiyle aynıdır (günlük farkla ortak parmak izi).
 */
export async function notifyGuideIndexNow(slug: string, opts: { nowMs?: number } = {}): Promise<IndexNowEventOutcome> {
  if (!(await indexNowReady())) return OFF;
  const { guidePath } = await import("@/lib/guides/defaults");
  const { listGuideSitemapEntries } = await import("@/lib/guides/sitemap");
  const base = getBaseUrl();
  const path = guidePath(slug);
  if (!canAutoOptimize(path)) return { sent: 0, status: "kapsam dışı", skipped: "Adres otomatik bildirim kapsamında değil" };
  const entry = (await listGuideSitemapEntries(base)).find((e) => pathOfUrl(e.url) === path);
  if (!entry) return { sent: 0, status: "kapsam dışı", skipped: "Yazı site haritasında değil (indekslenmiyor)" };
  return sendOne(canonicalUrl(base, path), entry.lastModified, opts.nowMs ?? now());
}
