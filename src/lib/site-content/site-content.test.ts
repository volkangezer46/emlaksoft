import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PLANS, type PlanDef } from "@/lib/billing/plans";
import { platformCanAccess } from "@/lib/platform-access";
import { HUB_CARDS, pageFileFor } from "@/lib/site-hub/cards";
import { cardForAction } from "@/lib/site-hub/last-changes";
import { ValuationSection } from "@/components/marketing/valuation-section";
import { buildHomeFaqs, faqForJsonLd } from "@/components/marketing/faq";
import { PIONEER_CLAIM } from "./claims";
import { defaultSiteContent } from "./defaults";
import { daysAgoIso } from "@/lib/clock";
import { efValuationStatus } from "./ef-status";
import { hasErrors, riskyWordsIn, validateSiteContent, type SiteContent } from "./schema";
import { efMonthlyAllowanceText, resolveTokens, tx } from "./tokens";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const clone = (): SiteContent => structuredClone(defaultSiteContent());

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(f);
  }
  return out;
}

/** Paket tanımında aylık hak alanı olmayan kopya (alan yokken satırın gizlendiğini sınamak için). */
const NO_FIELD_PLANS: readonly PlanDef[] = PLANS.map((p) => ({ ...p, efCreditsMonthly: undefined }));

describe("varsayılan içerik", () => {
  it("hatasız doğrulanır (uyarılar engellemez)", () => {
    const { issues, config } = validateSiteContent(defaultSiteContent());
    expect(config).not.toBeNull();
    expect(hasErrors(issues)).toBe(false);
  });

  it("bugünkü metni taşır: kilit cümleler ve sayılar", () => {
    const c = defaultSiteContent();
    expect(c.hero).toMatchObject({ title: "Emlak işlerinizi", em: "tek platformda", tail: "yönetin" });
    expect(c.faq.slice(0, 8).map((f) => f.q)).toEqual([
      "Deneme için kredi kartı gerekir mi?",
      "Kurulum ne kadar sürer?",
      "Verilerim nerede saklanıyor?",
      "Portal ilanlarımı otomatik çekiyor veya yayınlıyor musunuz?",
      "Dijital imza e-imza mıdır?",
      "Sözleşme veya taahhüt var mı?",
      "Hangi paketi seçmeliyim, modülleri kapatabilir miyim?",
      "Mevcut CRM’den geçiş yapabilir miyim?",
    ]);
    expect(c.valueCards).toHaveLength(5);
    expect(c.steps).toHaveLength(3);
  });

  it("ana sayfa çıktısının eski halle birebir aynılığı altın dosyalarla kilitli", () => {
    expect(existsSync(join(root, "src/lib/site-content/__golden__/landing-sync-deneme-var.html"))).toBe(true);
    expect(existsSync(join(root, "src/lib/site-content/__golden__/landing-async.html"))).toBe(true);
  });
});

describe("değişkenler", () => {
  it("deneme günü ve yıllık teklif çözülür; teklif yokken değişkenli madde 'missing' olur", () => {
    expect(tx("{deneme}", { trialDays: 30, plans: [] })).toBe("30 gün ücretsiz");
    expect(tx("{deneme}", { plans: [] })).toBe("Ücretsiz");
    expect(tx("{deneme_dene}", { trialDays: 14, plans: [] })).toBe("14 gün ücretsiz dene");
    expect(tx("Kayıt {deneme_gun}ücretsiz", { trialDays: 14, plans: [] })).toBe("Kayıt 14 gün ücretsiz");
    expect(tx("Kayıt {deneme_gun}ücretsiz", { plans: [] })).toBe("Kayıt ücretsiz");
    expect(resolveTokens("Yıllık ödemede {yillik}", { plans: [] })).toMatchObject({ missing: true });
    expect(tx("{bilinmeyen}", { plans: [] })).toBe("{bilinmeyen}");
  });

  it("aylık değerleme hakkı plan alanından gelir; alan yoksa null (satır gizlenir)", () => {
    expect(efMonthlyAllowanceText(NO_FIELD_PLANS)).toBeNull();
    const withField = NO_FIELD_PLANS.map((p, i) => (i === 0 ? ({ ...p, efCreditsMonthly: 7 } as PlanDef) : p));
    expect(efMonthlyAllowanceText(withField)).toBe(`${PLANS[0]!.name} 7`);
    // {ef_hak}: canlı değilse "(planlanan)", canlıysa etiketsiz
    expect(tx("{ef_hak}", { plans: withField })).toBe(`${PLANS[0]!.name} 7 (planlanan)`);
    expect(tx("{ef_hak}", { plans: withField, efLive: true })).toBe(`${PLANS[0]!.name} 7`);
  });
});

describe("doğrulama", () => {
  it("javascript:, data: ve olmayan yollar kaydedilemez", () => {
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "/olmayan-sayfa", "//evil.com", "/#olmayan-bolum"]) {
      const c = clone();
      c.hero.primary.href = bad;
      const { issues } = validateSiteContent(c);
      expect(issues.some((i) => i.path === "hero.primary.href" && i.level === "error"), bad).toBe(true);
    }
    for (const ok of ["/kayit", "/#degerleme", "https://emlaksoft.com.tr", "mailto:a@b.co", "tel:+905321234567"]) {
      const c = clone();
      c.hero.primary.href = ok;
      expect(validateSiteContent(c).issues.some((i) => i.path === "hero.primary.href" && i.level === "error"), ok).toBe(false);
    }
  });

  it("HTML/script girilemez; bilinmeyen değişken reddedilir; uzunluk sınırı işler", () => {
    const html = clone();
    html.hero.lead = "Merhaba <script>alert(1)</script>";
    expect(validateSiteContent(html).issues.some((i) => i.path === "hero.lead" && i.level === "error")).toBe(true);
    const tok = clone();
    tok.hero.badge = "{kotu_degisken}";
    expect(validateSiteContent(tok).issues.some((i) => i.path === "hero.badge" && /Bilinmeyen değişken/.test(i.message))).toBe(true);
    const long = clone();
    long.hero.badge = "x".repeat(200);
    expect(validateSiteContent(long).config).toBeNull();
    const nl = clone();
    nl.hero.badge = "iki\nsatır";
    expect(hasErrors(validateSiteContent(nl).issues)).toBe(true);
    const ml = clone();
    ml.hero.lead = "birinci\nikinci";
    expect(hasErrors(validateSiteContent(ml).issues)).toBe(false);
  });

  it("riskli kelimeler UYARI verir, engellemez", () => {
    for (const w of ["Ücretsiz deneyin", "Bedava", "%100 doğru", "Garanti ediyoruz", "Risksiz", "Kesin sonuç", "Türkiye'de ilk ve tek"]) {
      expect(riskyWordsIn(w).length, w).toBeGreaterThan(0);
    }
    expect(riskyWordsIn("{deneme}, kredi kartı gerekmez")).toEqual([]);
    const c = clone();
    c.hero.badge = "Garanti sonuç";
    const { issues } = validateSiteContent(c);
    expect(issues.some((i) => i.path === "hero.badge" && i.level === "warn")).toBe(true);
    expect(hasErrors(issues)).toBe(false);
  });

  it("sahte yorum/sayaç alanı yok: şemada müşteri yorumu veya sayaç anahtarı bulunmaz", () => {
    const keys = JSON.stringify(Object.keys(defaultSiteContent()));
    expect(keys).not.toMatch(/testimonial|review|yorum|counter|sayac/i);
    const trust = read("src/components/marketing/trust-strip.tsx");
    expect(trust).toContain("DEĞERLER koddan gelir");
  });
});

describe("SSS <-> JSON-LD tutarlılığı", () => {
  it("gizlenen soru ikisinden de çıkar; JSON-LD yalnız satır sonlarını boşluğa çevirir", () => {
    const c = clone();
    c.faq[0]!.hidden = true;
    c.faq[1]!.a = "Birinci satır\nikinci satır";
    const visible = buildHomeFaqs({ plans: PLANS, content: c.faq });
    expect(visible.some((f) => f.q === c.faq[0]!.q)).toBe(false);
    const ld = faqForJsonLd(visible);
    expect(ld.map((f) => f.q)).toEqual(visible.map((f) => f.q));
    expect(ld.find((f) => f.q === c.faq[1]!.q)!.a).toBe("Birinci satır ikinci satır");
    expect(ld.every((f, i) => f.a.replace(/\s+/g, " ") === visible[i]!.a.replace(/\s+/g, " "))).toBe(true);
  });

  it("ana sayfa aynı listeyi hem Faq hem JSON-LD'ye verir", () => {
    const page = read("src/app/page.tsx");
    expect(page).toContain("buildHomeFaqs({ trialDays, plans, content: content.faq })");
    expect(page).toContain("faqForJsonLd(faqs)");
    expect(page).toContain("<Faq items={faqs}");
  });

  it("değerleme SSS'leri var ve resmi ekspertiz değildir diye cevaplar", () => {
    const faqs = buildHomeFaqs({ trialDays: 14, plans: PLANS });
    const q = faqs.find((f) => /resmi ekspertiz/.test(f.q));
    expect(q?.a).toMatch(/^Hayır\./);
    expect(q?.a).toMatch(/bilgilendirme amaçlı/);
    expect(q?.a).toMatch(/ilan ve emsal verisine dayanır/);
    expect(faqs.some((f) => /Değerleme nasıl/.test(f.q))).toBe(true);
    expect(faqs.some((f) => /Kontör/.test(f.q))).toBe(true);
  });
});

describe("EmlakFiyati değerleme bölümü", () => {
  const html = (status: "live" | "soon", content?: SiteContent["valuation"], plans: readonly PlanDef[] = PLANS) =>
    renderToStaticMarkup(createElement(ValuationSection, { status, trialDays: 14, plans, content }));

  it("durum: bayrak AÇIK ve son yoklama başarılıysa canlı, aksi halde yakında", () => {
    const fresh = daysAgoIso(1);
    expect(efValuationStatus("on", fresh)).toBe("live");
    expect(efValuationStatus("on", daysAgoIso(8))).toBe("soon"); // eski damga: stale -> vitrinde yakında
    expect(efValuationStatus("on", null)).toBe("soon");
    expect(efValuationStatus("on", "  ")).toBe("soon");
    expect(efValuationStatus("off", fresh)).toBe("soon");
    expect(efValuationStatus(null, null)).toBe("soon");
  });

  it("canlı değilken 'Yakında' + ücretsiz deneme CTA'sı; 'Hemen deneyin' yok", () => {
    const out = html("soon");
    expect(out).toContain('id="degerleme"');
    expect(out).toContain("Yakında");
    expect(out).toMatch(/cretsiz dene/);
    expect(out).toContain('href="/kayit"');
    expect(out).not.toContain("Hemen deneyin");
    expect(out).toContain("ÖRNEK");
  });

  it("canlıyken 'Hemen deneyin' + kayıt CTA'sı; 'Yakında' rozeti yok", () => {
    const out = html("live");
    expect(out).toContain("Hemen deneyin");
    expect(out).toContain('href="/kayit"');
    expect(out).not.toContain("Yakında");
  });

  it("'ilk ve tek' ayrı cümle: kapatılınca kalkar, somut tanım kalır; metin claims.ts'ten gelir", () => {
    expect(html("soon")).toContain(PIONEER_CLAIM.text.replace(/\x27/g, "&#x27;"));
    const c = clone().valuation;
    c.claim.hidden = true;
    const out = html("soon", c);
    expect(out).not.toContain(PIONEER_CLAIM.text.replace(/\x27/g, "&#x27;"));
    expect(out).toContain("ada/parsel bazlı değerleme ve PDF rapor sunan entegre sistem");
    expect(defaultSiteContent().valuation.claim.text).toBe(PIONEER_CLAIM.text);
    expect(defaultSiteContent().valuation.claim.hidden).toBe(false);
  });

  it("iddia TEK sabitte: 'ilk ve tek' cümlesi yalnız claims.ts'te yazılıdır", () => {
    const files = [...walk(join(root, "src/components/marketing")), ...walk(join(root, "src/app")), ...walk(join(root, "src/lib/site-content"))];
    const offenders = files.filter((f) => !/claims\.ts$|\.test\.ts$/.test(f) && /ilk ve tek/i.test(readFileSync(f, "utf8")));
    // schema.ts risky-word deseni iddianın KENDİSİ değil, uyarı kuralıdır.
    expect(offenders.filter((f) => !/site-content[\\/]schema\.ts$/.test(f))).toEqual([]);
    expect(PIONEER_CLAIM.evidenceWarning).toMatch(/KANITLANABİLİR OLMALI/);
  }, 120_000);

  it("aylık hak satırı plan alanı yokken gizlidir; alan varsa sayı plandan gelir (kodda sabit değil)", () => {
    expect(html("soon", undefined, NO_FIELD_PLANS)).not.toContain("Aylık sorgu hakkı");
    const withField = NO_FIELD_PLANS.map((p, i) => (i === 0 ? ({ ...p, efCreditsMonthly: 11 } as PlanDef) : p));
    const out = html("soon", undefined, withField);
    expect(out).toContain(`${PLANS[0]!.name} 11`);
    expect(read("src/components/marketing/valuation-section.tsx")).not.toMatch(/efCreditsMonthly\s*[:=]\s*\d/);
  });

  it("bölüm gizlenirse hiçbir şey çizilmez; resmi ekspertiz dipnotu görünür; sahte rakam/garanti dili yok", () => {
    const c = clone().valuation;
    expect(html("soon")).toContain("resmi ekspertiz veya banka değerlemesi yerine geçmez");
    expect(html("soon")).not.toMatch(new RegExp(["garanti", "kesin değer", "end" + "eksa", "tapu" + "sor"].join("|"), "i"));
    c.hidden = true;
    expect(html("soon", c)).toBe("");
  });

  it("mega menü: 'EmlakFiyati ile değerleme' #degerleme bölümüne gider", () => {
    const menu = read("src/lib/site-menu/defaults.ts");
    expect(menu).toContain('"EmlakFiyati ile değerleme"');
    expect(menu).toContain('"/#degerleme"');
    expect(read("src/components/marketing/valuation-section.tsx")).toContain('id="degerleme"');
  });
});

describe("yetkiler ve action kuralları", () => {
  const src = read("src/app/actions/site-content.ts");

  it("operasyon okur, yazamaz; support/billing erişemez", () => {
    expect(platformCanAccess("super_admin", "sitecontent")).toBe(true);
    expect(platformCanAccess("ops", "sitecontent")).toBe(true);
    expect(platformCanAccess("support", "sitecontent")).toBe(false);
    expect(platformCanAccess("billing", "sitecontent")).toBe(false);
    expect(src).toContain('requirePlatformModule("sitecontent")');
    expect(src).toContain('staff.role === "super_admin" ? staff : null');
  });

  it("her dışa açık action önce requireWriter, hız sınırı ve etkinlik kaydı kullanır; 'use server' yalnız async export eder", () => {
    expect(src.startsWith('"use server";')).toBe(true);
    const exported = [...src.matchAll(/^export (async function|function|const|type|class)\s+(\w+)/gm)];
    for (const m of exported) {
      if (m[1] === "type") continue;
      expect(m[1], m[2]).toBe("async function");
    }
    const names = exported.filter((m) => m[1] === "async function").map((m) => m[2]!);
    expect(names.sort()).toEqual(["discardSiteContentDraft", "publishSiteContent", "resetSiteContentToDefault", "rollbackSiteContent", "saveSiteContentDraft"]);
    for (const n of names) {
      const body = src.slice(src.indexOf(`export async function ${n}`)).split(/\nexport async function /)[0]!;
      expect(body, n).toContain("await requireWriter()");
      expect(body, n).toContain("if (!staff) return { error: READONLY }");
      expect(body, n).toContain("logPlatformActivity");
    }
    expect(src.match(/checkRateLimit\(/g)!.length).toBeGreaterThanOrEqual(4);
    expect(src).toContain('failurePolicy: "deny"');
    expect(src).toContain("updateTag(SITE_CONTENT_CACHE_TAG)");
  });
});

describe("public sayfa statik kalır", () => {
  it("ana sayfa, demo ve içerik okuyucuları dinamik API çağırmaz", () => {
    const files = [
      "src/app/page.tsx",
      "src/app/demo/page.tsx",
      "src/lib/site-content/store.ts",
      "src/lib/site-content/ef-status.ts",
      "src/components/marketing/valuation-section.tsx",
      "src/components/marketing/content-link.tsx",
    ];
    for (const f of files) {
      const s = read(f);
      expect(s, f).not.toMatch(/\bcookies\(|\bheaders\(|noStore|unstable_noStore|force-dynamic|searchParams/);
      expect(s, f).not.toMatch(/\bfetch\(/);
    }
    for (const f of walk(join(root, "src/components/marketing"))) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/\bcookies\(|\bheaders\(|force-dynamic/);
    }
    expect(read("src/lib/site-content/store.ts")).toContain("unstable_cache");
    expect(read("src/lib/site-content/store.ts")).toContain("tags: [SITE_CONTENT_CACHE_TAG]");
    expect(read("src/lib/site-content/ef-status.ts")).toMatch(/revalidate: \d+/);
  });

  it("istemci bileşenleri sunucu modülü içe aktarmaz (store/admin client yok)", () => {
    for (const f of walk(join(root, "src/app/admin/site-icerik")).filter((x) => /\.tsx$/.test(x) && !/page\.tsx$|loading\.tsx$/.test(x))) {
      const s = readFileSync(f, "utf8");
      expect(s.split("\n")[0], f).toBe('"use client";');
      expect(s, f).not.toMatch(/site-content\/store|site-hub\/last-changes|platform-settings|supabase/);
    }
  });
});

describe("site yönetimi merkezi", () => {
  it("her kart gerçek bir page.tsx'e gider; kimlik ve modül kayıtları tutarlı", () => {
    expect(new Set(HUB_CARDS.map((c) => c.id)).size).toBe(HUB_CARDS.length);
    for (const c of HUB_CARDS) {
      expect(c.href.startsWith("/admin/"), c.href).toBe(true);
      expect(existsSync(join(root, pageFileFor(c.href))), `${c.href} -> ${pageFileFor(c.href)}`).toBe(true);
      expect(platformCanAccess("super_admin", c.module), c.id).toBe(true);
    }
  });

  it("kapsamdaki alanların hepsi var; olmayan EmlakFiyati kontör ekranı için kart yok", () => {
    const hrefs = HUB_CARDS.map((c) => c.href);
    for (const h of ["/admin/site-menu", "/admin/site-icerik", "/admin/seo", "/admin/ayarlar", "/admin/duyuru", "/admin/billing/planlar", "/admin/billing/kuponlar", "/admin/personel", "/admin/sistem", "/admin/billing"]) {
      expect(hrefs, h).toContain(h);
    }
    if (!existsSync(join(root, "src/app/admin/ef-kontor/page.tsx"))) expect(hrefs.some((h) => h.includes("ef-kontor"))).toBe(false);
  });

  it("son değişiklik eşlemesi: eylem öneki -> kart", () => {
    expect(cardForAction("seo.page.save")).toBe("seo");
    expect(cardForAction("site_menu.publish")).toBe("site-menu");
    expect(cardForAction("site_content.publish")).toBe("site-icerik");
    expect(cardForAction("billing.coupon.create")).toBe("kuponlar");
    expect(cardForAction("billing.plan.save")).toBe("planlar");
    expect(cardForAction("billing.invoice.void")).toBe("muhasebe");
    expect(cardForAction("bilinmeyen.islem")).toBeNull();
  });

  it("merkez yalnız eylem adı, zaman ve personel adı okur (meta/e-posta yok)", () => {
    const s = read("src/lib/site-hub/last-changes.ts");
    expect(s).not.toMatch(/createAdminClient|supabase\/admin/); // kendi service_role'ü yok; kabul listesindeki sorguyu kullanır
    expect(s).toContain("created_at");
    expect(s).toContain("resolveActorNames");
    expect(s).not.toMatch(/\.meta\b|email/);
  });
});

describe("taslak / yayın / geri dönüş / varsayılana dön (ortak depo)", () => {
  const mem = new Map<string, string | null>();
  beforeEach(() => {
    mem.clear();
    vi.resetModules();
    vi.doMock("@/lib/platform-settings", () => ({
      getPlatformSetting: async (k: string) => mem.get(k) ?? null,
      setPlatformSetting: async (k: string, v: string | null) => {
        mem.set(k, v);
        return true;
      },
    }));
  });

  it("yayın -> geçmiş + canlı + taslak; geri dönüş yeni sürüm; varsayılana dön canlıyı siler ve eskisini geçmişe yazar", async () => {
    const { createVersionedStore } = await import("@/lib/versioned-config/store");
    const { parseSiteContent } = await import("./schema");
    const store = createVersionedStore<SiteContent>({ prefix: "t", parseValue: parseSiteContent, unavailableMessage: "x" });
    const a = clone();
    const b = clone();
    b.hero.badge = "Başka rozet";
    expect((await store.saveDraft(a, "s1")).ok).toBe(true);
    expect((await store.readState()).live).toBeNull();
    expect((await store.publish(a, { id: "v1", at: "2026-10-05T10:00:00Z", by: "A", label: "ilk" }, "s1")).ok).toBe(true);
    expect((await store.publish(b, { id: "v2", at: "2026-10-05T11:00:00Z", by: "A", label: "ikinci" }, "s1")).ok).toBe(true);
    let st = await store.readState();
    expect(st.live?.hero.badge).toBe("Başka rozet");
    expect(st.draft?.hero.badge).toBe("Başka rozet");
    expect(st.history.map((h) => h.id)).toEqual(["v2", "v1"]);
    // geri dönüş: eski sürüm yeni sürüm olarak yayınlanır
    const v1 = st.history.find((h) => h.id === "v1")!;
    await store.publish(v1.cfg, { id: "v3", at: "2026-10-05T12:00:00Z", by: "A", label: "Geri dönüş: ilk" }, "s1");
    st = await store.readState();
    expect(st.live?.hero.badge).toBe(a.hero.badge);
    expect(st.history).toHaveLength(3);
    // varsayılana dön
    await store.resetToDefault({ id: "v4", at: "2026-10-05T13:00:00Z", by: "A" }, "s1");
    st = await store.readState();
    expect(st.live).toBeNull();
    expect(st.draft).toBeNull();
    expect(st.history[0]!.label).toBe("Varsayılana dönmeden önceki yayın");
  });

  it("geçmiş en çok 10 sürümle sınırlıdır; bozuk kayıt yok sayılır", async () => {
    const { createVersionedStore, MAX_HISTORY } = await import("@/lib/versioned-config/store");
    const { parseSiteContent } = await import("./schema");
    const store = createVersionedStore<SiteContent>({ prefix: "t", parseValue: parseSiteContent, unavailableMessage: "x" });
    for (let i = 0; i < 13; i++) await store.publish(clone(), { id: `v${i}`, at: "2026-10-05T10:00:00Z", by: "A", label: `n${i}` }, "s1");
    expect((await store.readState()).history).toHaveLength(MAX_HISTORY);
    mem.set("t.live", "{bozuk");
    expect((await store.readState()).live).toBeNull();
  });
});
