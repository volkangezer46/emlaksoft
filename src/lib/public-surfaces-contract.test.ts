import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { officeMessageHref, resolvePublicContact } from "./public-contact";
import { approximateCoords, osmEmbedSrc, PUBLIC_EXACT_LOCATION, publicLocation } from "./public-location";
import { formatPublicPrice, listingCurrency } from "./public-price";
import { buildVitrinListingLd } from "./vitrin-seo/listing-ld";

/**
 * SK8 — herkese açık müşteri yüzeyleri sözleşmesi (vitrin, ilan, paylaşım, sunum, müşteri/malik portalı, randevu
 * teyidi, açık ev, tavsiye, değerleme hunisi). Her blok bir bulguyu kilitler; ayrıntı ilgili modülün başlık yorumunda.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const exists = (p: string) => existsSync(join(process.cwd(), p));

const TOKEN_TREES = ["paylas", "sunum", "randevu-teyit", "musteri-portali", "malik-portali", "degerleme-raporu", "acik-ev-kayit"];

const CONTACT_SURFACES = [
  "src/app/paylas/[token]/page.tsx",
  "src/app/sunum/[token]/page.tsx",
  "src/app/malik-portali/[token]/page.tsx",
  "src/app/musteri-portali/[token]/page.tsx",
  "src/app/randevu-teyit/[token]/page.tsx",
  "src/app/acik-ev-kayit/[token]/page.tsx",
  "src/app/tavsiye/[token]/page.tsx",
  "src/app/vitrin/[slug]/page.tsx",
  "src/app/vitrin/[slug]/[ilan]/page.tsx",
];

describe("B149: malik portalına iç teklif notu (offers.notes) sızmaz", () => {
  it("malik portalı veri sorgusu offers.notes seçmez; yalnız owner_visible_note", () => {
    const src = read("src/app/actions/owner-portal.ts");
    const offerSelects = [...src.matchAll(/offersQuery\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(offerSelects.length).toBeGreaterThan(0);
    for (const cols of offerSelects) {
      expect(cols.split(",").map((c) => c.trim())).not.toContain("notes");
    }
    expect(src).not.toMatch(/notes:\s+o\.notes/);
  });

  it("malik portalı sayfası iç notu basmaz; müşteri portalı teklif sorgusu da notes seçmez", () => {
    expect(read("src/app/malik-portali/[token]/page.tsx")).not.toMatch(/o\.notes\b/);
    const customer = read("src/app/actions/customer-portal.ts");
    for (const m of customer.matchAll(/from\("offers"\)\s*\.select\("([^"]+)"\)/g)) {
      expect(m[1].split(",").map((c) => c.trim())).not.toContain("notes");
    }
  });

  it("teklif formu iç not ile malike görünen açıklamayı ayrı etiketler", () => {
    const form = read("src/app/app/teklifler/yeni/new-offer-form.tsx");
    expect(form).toContain("İç not (yalnız ofis içi)");
    expect(form).toContain("Malike görünen açıklama (isteğe bağlı)");
    expect(form).toContain('name="owner_visible_note"');
    expect(read("src/app/app/teklifler/[id]/offer-edit-dialog.tsx")).toContain('name="owner_visible_note"');
    expect(read("supabase/migrations/20261016080000_public_surfaces.sql")).toContain("add column if not exists owner_visible_note");
  });
});

describe("B150: token yüzeylerinde bot isteği yan etki üretmez", () => {
  it("isLinkPreviewRequest TEK kaynaktır (src/lib/link-preview.ts)", () => {
    expect(read("src/lib/presentation-open.ts")).not.toMatch(/export function isLinkPreviewRequest/);
    expect(read("src/lib/link-preview.ts")).toMatch(/export function isLinkPreviewRequest/);
  });

  it("paylaşım: sayaç render yolunda yazılmaz; after() + atomik RPC + önizleme kapısı", () => {
    const src = read("src/app/paylas/[token]/page.tsx");
    expect(src).not.toMatch(/\.update\(\{\s*view_count/);
    expect(src).not.toContain("notifyTenant(");
    expect(src).toContain("isLinkPreviewHeaders(");
    expect(src).toMatch(/after\(\(\) =>\s*recordShareOpen\(/);
    const lib = read("src/lib/presentation-open.ts");
    expect(lib).toContain('rpc("increment_share_view"');
    expect(lib).toMatch(/if \(opts\.isPreviewBot\) return;\s*const \{ data, error \} = await admin\.rpc\("increment_share_view"/);
    expect(lib).toContain("Number(data) !== 1");
  });

  it("portallar: last_seen_at yalnız recordSeen ile, sayfa önizleme kapısından geçirir", () => {
    for (const f of ["src/app/actions/owner-portal.ts", "src/app/actions/customer-portal.ts"]) {
      const src = read(f);
      expect(src, f).toMatch(/opts\.recordSeen\s*\?\s*admin\.from\("(owner|customer)_portal_tokens"\)\s*\.update\(\{ last_seen_at/);
    }
    expect(read("src/app/malik-portali/[token]/page.tsx")).toMatch(/recordSeen: !isPreviewBot/);
    expect(read("src/app/musteri-portali/[token]/page.tsx")).toMatch(/recordSeen: !isLinkPreviewHeaders\(/);
  });

  it("tavsiye tıklaması ve sunum açılışı önizleme kapısından geçer", () => {
    expect(read("src/app/tavsiye/[token]/page.tsx")).toMatch(/if \(active && !isLinkPreviewHeaders\(requestHeaders\)\)/);
    expect(read("src/app/sunum/[token]/page.tsx")).toContain("isLinkPreviewHeaders(requestHeaders)");
  });

  it("increment_share_view atomik, yeni değeri döndürür, yalnız service_role", () => {
    const sql = read("supabase/migrations/20261016080000_public_surfaces.sql");
    expect(sql).toMatch(/set view_count = coalesce\(view_count, 0\) \+ 1/);
    expect(sql).toContain("returning view_count");
    expect(sql).toContain("revoke all on function public.increment_share_view(text) from public, anon, authenticated");
    expect(exists("supabase/rollbacks/20261016080000_public_surfaces.rollback.sql")).toBe(true);
  });
});

describe("B147: /paylas koyu başlık bloğu theme-dark taşır", () => {
  it("h1'in bulunduğu koyu hero bloğunda theme-dark var", () => {
    const src = read("src/app/paylas/[token]/page.tsx");
    const hero = src.indexOf('className="theme-dark relative border-b border-white/10');
    expect(hero).toBeGreaterThan(0);
    expect(src.indexOf("<h1", hero)).toBeGreaterThan(hero);
  });
});

describe("B148: tek iletişim kaynağı (danışman → ofis telefonu; sahip kişisel telefonu yok)", () => {
  it("sıra: danışman, sonra ofis; ikisi yoksa null", () => {
    expect(resolvePublicContact({ advisorPhone: "05321234567", officePhone: "02161234567" })).toMatchObject({
      source: "advisor",
      telHref: "tel:05321234567",
    });
    const office = resolvePublicContact({ advisorPhone: null, officePhone: "05551234567", whatsappText: "Merhaba" });
    expect(office).toMatchObject({ source: "office", callLabel: "Ofisi ara", telHref: "tel:05551234567" });
    expect(office?.waHref).toBe("https://wa.me/905551234567?text=Merhaba");
    expect(resolvePublicContact({ advisorPhone: "", officePhone: null })).toBeNull();
  });

  it("sabit hatta WhatsApp bağlantısı üretilmez", () => {
    const landline = resolvePublicContact({ officePhone: "02161234567" });
    expect(landline?.telHref).toBe("tel:02161234567");
    expect(landline?.waHref).toBeNull();
  });

  it("'Ofise mesaj bırakın' yalnız açık talep formunda", () => {
    expect(officeMessageHref({ lead_capture_token: "abc", lead_capture_enabled: true })).toBe("/lead/abc");
    expect(officeMessageHref({ lead_capture_token: "abc", lead_capture_enabled: false })).toBeNull();
    expect(officeMessageHref(null)).toBeNull();
  });

  it("modül sahip/kayıt profiline yedek düşmez (yalnız iki girdi)", () => {
    const src = read("src/lib/public-contact.ts");
    expect(src).not.toMatch(/\.from\(|ownerPhone|"profiles"/);
  });

  it.each(CONTACT_SURFACES)("%s tek bileşeni kullanır, sahte 'Telefon yok' basmaz", (file) => {
    const src = read(file);
    expect(src).toContain("PublicContactActions");
    expect(src).not.toContain("Telefon yok");
  });

  it("paylaşım 'Soru sor' WhatsApp yoksa hiç basılmaz (tıklanamayan span yok)", () => {
    const src = read("src/components/public/share-feedback.tsx");
    expect(src).not.toMatch(/<span[^>]*>\s*<MessageCircleQuestion[^>]*\/>\s*Soru sor/);
  });
});

describe("B153/B046: token linkleri gerçek 404 + ortak ekran; açılış ekranı yok", () => {
  it.each(TOKEN_TREES)("%s: loading.tsx yok, not-found.tsx PublicLinkNotFound", (tree) => {
    expect(exists(`src/app/${tree}/loading.tsx`)).toBe(false);
    expect(read(`src/app/${tree}/not-found.tsx`)).toContain("PublicLinkNotFound");
  });

  it("ilan detayı: loading.tsx yok; yayından kalkan ilan ofis markalı 404", () => {
    expect(exists("src/app/vitrin/[slug]/[ilan]/loading.tsx")).toBe(false);
    expect(read("src/app/vitrin/[slug]/[ilan]/not-found.tsx")).toContain("Bu ilan yayından kalktı");
    expect(read("src/app/vitrin/[slug]/not-found.tsx")).toContain("PublicLinkNotFound");
    const page = read("src/app/vitrin/[slug]/[ilan]/page.tsx");
    expect(page).toMatch(/settleNotFound\(await loadRemovedListingCtx\(/);
    expect(page).toMatch(/finally \{\s*slot\.settle\(null\);/);
  });

  it("ortak 404 ekranında pazarlama bağlantısı yok", () => {
    const src = read("src/components/public/public-link-not-found.tsx");
    // Bileşen kendi bağlantısını taşımaz (EmlakSoft pazarlama/giriş yok); ofise ait yol yalnız `children` ile gelir.
    expect(src).not.toMatch(/href=|<Link|SoftLink/);
  });

  it("portallar geçersiz tokenda notFound() çağırır (200 + geçersiz kartı yok)", () => {
    for (const f of ["src/app/malik-portali/[token]/page.tsx", "src/app/musteri-portali/[token]/page.tsx"]) {
      const src = read(f);
      expect(src, f).toContain("if (!data) notFound();");
      expect(src, f).not.toContain("PortalInvalidLink");
    }
    expect(read("src/app/paylas/[token]/page.tsx")).toContain("if (isPast(share.expires_at)) notFound();");
  });

  it("harita dokunuşla yüklenir (ilk çizimde iframe yok)", () => {
    const src = read("src/app/vitrin/[slug]/[ilan]/map-embed.tsx");
    expect(src).toContain("Haritayı göster");
    expect(src).toMatch(/\{shown \? \(/);
  });
});

describe("B151: önizleme kartları", () => {
  it.each([
    ["musteri-portali", "customer_portal"],
    ["malik-portali", "owner_portal"],
    ["acik-ev-kayit", "open_house"],
  ])("%s: generateMetadata ofis markalı + opengraph-image", (tree, kind) => {
    expect(read(`src/app/${tree}/[token]/page.tsx`)).toContain(`loadDocLinkOg("${kind}", token)`);
    expect(read(`src/app/${tree}/[token]/opengraph-image.tsx`)).toContain(`loadDocLinkOg("${kind}", token)`);
  });

  it("vitrin ilanı metadata'sında images anahtarı yok (dosya kartı eklenir); twitter-image var", () => {
    const page = read("src/app/vitrin/[slug]/[ilan]/page.tsx");
    const meta = page.slice(page.indexOf("export async function generateMetadata"), page.indexOf("export default async function"));
    expect(meta).not.toMatch(/\bimages\s*:/);
    expect(exists("src/app/vitrin/[slug]/[ilan]/twitter-image.tsx")).toBe(true);
  });
});

describe("B152: herkese açık konum mahalle/ilçe düzeyinde", () => {
  const input = {
    id: "36cdbdc0-ae6a-439c-b108-dc44f3eeeb57",
    addressLine: "Ataşehir'de işyeri — cadde üstü — demo adres",
    lat: 40.99312,
    lng: 29.12845,
    neighborhood: "Atatürk",
    district: "Ataşehir",
    province: "İstanbul",
  };

  it("varsayılan gizli: açık adres yok, Google ilçe araması, JSON-LD streetAddress yok", () => {
    expect(PUBLIC_EXACT_LOCATION).toBe(false);
    const loc = publicLocation(input);
    expect(loc.text).toBe("Atatürk, Ataşehir, İstanbul");
    expect(loc.text).not.toContain("demo adres");
    expect(loc.streetAddress).toBeNull();
    expect(loc.mapsHref).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.text)}`);
    expect(loc.exact).toBe(false);
  });

  it("koordinat ≤3 ondalık, ilana sabit ve ≤~250 m kaydırılmış; gömülü haritada işaret yok", () => {
    const a = approximateCoords(input.id, input.lat, input.lng);
    expect(a).toEqual(approximateCoords(input.id, input.lat, input.lng));
    for (const v of [a.lat, a.lng]) expect(String(v).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(3);
    expect(Math.abs(a.lat - input.lat)).toBeLessThan(0.0035);
    expect(Math.abs(a.lng - input.lng)).toBeLessThan(0.0035);
    const src = osmEmbedSrc(publicLocation(input))!;
    expect(src).not.toContain("marker=");
    expect(src).not.toMatch(/\d+\.\d{4,}/);
  });

  it("JSON-LD: streetAddress yalnız verilirse; para birimi ilanınki", () => {
    const ld = buildVitrinListingLd({
      base: "https://x.test",
      slug: "demo-ofis",
      listing: { id: input.id },
      name: "İşyeri",
      description: null,
      officeName: "Demo",
      imageIds: [],
      price: 850000,
      currency: "USD",
      sqm: null,
      streetAddress: publicLocation(input).streetAddress,
      district: "Ataşehir",
      province: "İstanbul",
    }) as { "@graph": Record<string, unknown>[] };
    const listing = ld["@graph"][0] as { address: Record<string, unknown>; offers: Record<string, unknown> };
    expect(listing.address).not.toHaveProperty("streetAddress");
    expect(listing.offers.priceCurrency).toBe("USD");
  });

  it("public sayfalar address_line basmaz; vitrin araması address_line'da yapılmaz", () => {
    const vitrin = read("src/app/vitrin/[slug]/page.tsx");
    expect(vitrin).toMatch(/PUBLIC_EXACT_LOCATION \? \["title", "property_code", "address_line"\] : \["title", "property_code"\]/);
    expect(read("src/app/paylas/[token]/page.tsx")).not.toMatch(/property\.address_line \?/);
    const detail = read("src/app/vitrin/[slug]/[ilan]/page.tsx");
    expect(detail).not.toMatch(/streetAddress: property\.address_line/);
    expect(detail).not.toContain("google.com/maps?q=");
  });
});

describe("B154: koyu formlarda telefon ülke seçici koyu ton", () => {
  it("PhoneInput tone='dark' varyantı; değerleme hunisi kullanır (talep formu COM-13 ile açık temada)", () => {
    const input = read("src/components/ui/phone-input.tsx");
    expect(input).toContain('tone?: "light" | "dark"');
    expect(input).toContain("border-white/15 bg-white/[0.06] text-white");
    // Talep formu ofis markalı açık kabuğa (PublicTokenPage) taşındı: koyu ton kullanılmaz.
    expect(read("src/app/lead/[token]/lead-form.tsx")).not.toContain('tone="dark"');
    expect(read("src/app/lead/[token]/page.tsx")).toContain("PublicTokenPage");
    expect(read("src/components/public/valuation-funnel.tsx")).toContain('tone="dark"');
  });
});

describe("B156: değerleme hesaplaması onay istemez; yeni onay metni bayrak arkasında", () => {
  it("sunucu: hesaplamada kvkk koşulu yok; yeni düzen bayrağı kapalı", () => {
    const src = read("src/app/actions/public-valuation.ts");
    const estimate = src.slice(src.indexOf("export async function estimatePublicValuation"), src.indexOf("export type PublicValuationLeadInput"));
    expect(estimate).not.toContain("input.kvkk");
    expect(src).toContain("const VALUATION_CONSENT_V2_ENABLED = false;");
  });

  it("istemci: 1. adımda onay kutusu yok, düğme onaya bağlı değil; yeni metin yalnız v2'de", () => {
    const src = read("src/components/public/valuation-funnel.tsx");
    const step1 = src.slice(src.indexOf("// ---- 1. adım"));
    expect(step1).not.toContain('type="checkbox"');
    expect(step1).toContain("disabled={pending}");
    expect(src).toMatch(/consentMode === "v2" \? \(/);
  });
});

describe("B094 (sözleşme f): public fiyat ilanın para biriminden", () => {
  it("850.000 USD → $850.000; TL/boş → ₺; kiralık /ay", () => {
    expect(listingCurrency({ currency: "USD" })).toBe("USD");
    expect(listingCurrency({ currency: "TL" })).toBe("TRY");
    expect(listingCurrency(null)).toBe("TRY");
    expect(formatPublicPrice(850000, "Satılık", "USD")).toBe("$850.000");
    expect(formatPublicPrice(25000, "Kiralık", "TRY")).toBe("₺25.000/ay");
    expect(formatPublicPrice(null, "Satılık", "EUR")).toBe("Fiyat için sorun");
  });

  it("vitrin, ilan, paylaşım, sunum ve önizleme kartı formatPublicPrice kullanır", () => {
    for (const f of [
      "src/app/vitrin/[slug]/page.tsx",
      "src/app/vitrin/[slug]/[ilan]/page.tsx",
      "src/app/paylas/[token]/page.tsx",
      "src/app/sunum/[token]/page.tsx",
      "src/lib/public-link-og.ts",
      "src/app/vitrin/[slug]/[ilan]/opengraph-image.tsx",
    ]) {
      const src = read(f);
      expect(src, f).toContain("formatPublicPrice");
      expect(src, f).not.toMatch(/format\(n\) \+ " ₺"/);
    }
  });
});
