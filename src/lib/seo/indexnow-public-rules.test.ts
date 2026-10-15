import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLOSED_LISTING_FEATURE_KEY } from "@/lib/closed-listing";
import { resolveNeverIndexList } from "@/lib/vitrin-seo/never-index";
import { indexNowEventAlreadySent, indexNowEventPrints, listingIndexNowEligibility, type ListingIndexNowTenant } from "./indexnow-public-rules";

const LIST = resolveNeverIndexList(null);
const ID = "4f1c2a9e-1111-4222-8333-944455556666";
const tenant = (o: Partial<ListingIndexNowTenant> = {}): ListingIndexNowTenant => ({
  slug: "gezer-emlak",
  status: "active",
  sample_seeded_at: null,
  sample_cleared_at: null,
  vitrinEnabled: true,
  seoOptin: true,
  ...o,
});
const listing = (o: Record<string, unknown> = {}) => ({ id: ID, status: "live", is_sample: false, deleted_at: null, features: {}, ...o });
const check = (t = tenant(), l: ReturnType<typeof listing> | null = listing(), sitemapListingsOn = true) =>
  listingIndexNowEligibility({ tenant: t, listing: l, neverIndexList: LIST, sitemapListingsOn });

describe("ilan IndexNow uygunluğu", () => {
  it("arama onaylı, açık vitrindeki yayında ilan → vitrin ilan yolu", () => {
    expect(check()).toEqual({ ok: true, path: `/vitrin/gezer-emlak/${ID}` });
  });

  it("ofis arama onayı yoksa bildirilmez", () => {
    expect(check(tenant({ seoOptin: false })).ok).toBe(false);
  });

  it("kalıcı noindex listesi (demo/test/admin) ve örnek veri kiracısı onay açık olsa bile bildirilmez", () => {
    expect(check(tenant({ slug: "demo-ofis" })).ok).toBe(false);
    expect(check(tenant({ slug: "e2e-test" })).ok).toBe(false);
    expect(check(tenant({ sample_seeded_at: "2026-10-01T00:00:00Z" })).ok).toBe(false);
    expect(
      listingIndexNowEligibility({ tenant: tenant({ slug: "ozel-liste" }), listing: listing(), neverIndexList: [...LIST, "ozel-liste"], sitemapListingsOn: true }).ok,
    ).toBe(false);
  });

  it("vitrin kapalı, ofis askıda/iptal ya da sitemap'te ilanlar kapalıysa bildirilmez", () => {
    expect(check(tenant({ vitrinEnabled: false })).ok).toBe(false);
    expect(check(tenant({ status: "suspended" })).ok).toBe(false);
    expect(check(tenant({ status: "cancelled" })).ok).toBe(false);
    expect(check(tenant(), listing(), false).ok).toBe(false);
  });

  it("ilan yayında değil, silinmiş, örnek ya da kapanmışsa bildirilmez", () => {
    expect(check(tenant(), listing({ status: "draft" })).ok).toBe(false);
    expect(check(tenant(), listing({ status: "reserved" })).ok).toBe(false);
    expect(check(tenant(), listing({ deleted_at: "2026-10-10T00:00:00Z" })).ok).toBe(false);
    expect(check(tenant(), listing({ is_sample: true })).ok).toBe(false);
    expect(check(tenant(), listing({ features: { [CLOSED_LISTING_FEATURE_KEY]: true } })).ok).toBe(false);
    expect(check(tenant(), null).ok).toBe(false);
    expect(listingIndexNowEligibility({ tenant: null, listing: listing(), neverIndexList: LIST, sitemapListingsOn: true }).ok).toBe(false);
  });

  it("geçersiz slug/kimlik adres üretmez", () => {
    expect(check(tenant({ slug: "../x" })).ok).toBe(false);
    expect(check(tenant(), listing({ id: "abc def" })).ok).toBe(false);
  });
});

describe("IndexNow olay tekrarı/sıklığı", () => {
  const url = `https://emlaksoft.com.tr/vitrin/gezer-emlak/${ID}`;
  const t0 = Date.parse("2026-10-16T09:00:00Z");

  it("aynı lastmod ya da aynı gün ikinci kez gönderilmez; ertesi gün yeni sürüm gönderilir", () => {
    const first = indexNowEventPrints(url, "2026-10-16T08:59:00.000Z", t0);
    const seen = new Set([first.lastmod, first.day]);
    // Aynı gün yeni düzenleme (farklı lastmod): gün parmak izi engeller.
    expect(indexNowEventAlreadySent(seen, indexNowEventPrints(url, "2026-10-16T12:00:00.000Z", t0 + 3 * 3600_000))).toBe(true);
    // Ertesi gün aynı sürüm: lastmod parmak izi engeller.
    expect(indexNowEventAlreadySent(seen, indexNowEventPrints(url, "2026-10-16T08:59:00.000Z", t0 + 86_400_000))).toBe(true);
    // Ertesi gün yeni sürüm: gönderilir.
    expect(indexNowEventAlreadySent(seen, indexNowEventPrints(url, "2026-10-17T10:00:00.000Z", t0 + 86_400_000))).toBe(false);
  });

  it("lastmod parmak izi günlük sitemap farkıyla aynı biçimdedir (url|lastmod)", async () => {
    const { indexNowPrint } = await import("./indexnow-events");
    expect(indexNowEventPrints(url, "2026-10-16T08:59:00.000Z", t0).lastmod).toBe(indexNowPrint(url, "2026-10-16T08:59:00.000Z"));
  });
});

describe("yayın eylemleri IndexNow'u yanıt sonrası çağırır", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("ilan düzenleme ve yayına alma afterSafe içinde notifyListingIndexNow", () => {
    const src = read("src/app/actions/properties.ts");
    expect(src.match(/afterSafe\(async \(\) => \{\s*const \{ notifyListingIndexNow \}/g)?.length).toBe(2);
  });
  it("rehber yayını/geri dönüşü afterSafe içinde notifyGuideIndexNow", () => {
    const src = read("src/app/actions/site-guides.ts");
    expect(src).toMatch(/afterSafe\(async \(\) => \{\s*const \{ notifyGuideIndexNow \}/);
    expect(src.match(/notifyGuideAfterPublish\(res\.entry\.slug\)/g)?.length).toBe(2);
  });
});
