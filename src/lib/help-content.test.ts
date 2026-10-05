import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALL_NAV_HREFS } from "@/lib/nav-config";
import { FAQ, FAQ_CATEGORIES, FAQ_PRICE_PATTERN } from "./help-faq";
import { GUIDES, HELP_TABS, OWNER_REQUIRED_SUMMARY, matchesQuery, resolveHelpTab } from "./help-content";

const guideText = (slug: string) => {
  const g = GUIDES.find((x) => x.slug === slug);
  expect(g, slug).toBeTruthy();
  return [g!.title, g!.intro, ...g!.steps].join(" ");
};

describe("yardım rehberleri", () => {
  it("rehber sayısı genişledi ve slug'lar benzersiz", () => {
    expect(GUIDES.length).toBeGreaterThanOrEqual(25);
    expect(new Set(GUIDES.map((g) => g.slug)).size).toBe(GUIDES.length);
  });

  it("her rehberin adımı, bağlantısı ve düğme adı vardır; bağlantı /app ile başlar", () => {
    for (const g of GUIDES) {
      expect(g.steps.length, g.slug).toBeGreaterThanOrEqual(3);
      expect(g.href.startsWith("/app"), g.slug).toBe(true);
      expect(g.cta.length, g.slug).toBeGreaterThan(2);
    }
  });

  it("rehber bağlantıları menü/yol envanterinde ya da bilinen alt yoldadır", () => {
    const known = new Set(ALL_NAV_HREFS);
    for (const g of GUIDES) {
      const path = g.href.split("?")[0];
      const ok = known.has(path) || [...known].some((k) => path.startsWith(`${k}/`)) || path === "/app/ice-aktarma" || path === "/app/baslangic";
      expect(ok, `${g.slug} -> ${g.href}`).toBe(true);
    }
  });

  it("yanlış rehber düzeltildi: Ayarlar'daki İçe Aktarma kartı ve 'Kazanıldı + komisyon' düğmesi yok", () => {
    const all = GUIDES.flatMap((g) => g.steps).join("\n");
    expect(all).not.toContain("Ayarlar sayfasındaki");
    expect(all).not.toContain("Kazanıldı + komisyon");
    const tasima = guideText("ice-aktar");
    expect(tasima).toContain("Müşteriler");
    expect(tasima).toContain("/app/ice-aktarma");
    expect(tasima).toContain("5.000");
    expect(tasima).toContain("geri alınabilir");
    const komisyon = guideText("komisyon-hesabi");
    expect(komisyon).toContain("Kapanış sekmesi");
    expect(komisyon).toContain("Tutar, Kazanıldı, Paylar, Vade, Belgeler, Anket, Bitiş");
    expect(komisyon).toContain("%3");
    expect(komisyon).toContain("%20");
    expect(komisyon).toContain("50/50");
  });

  it("portföy rehberi zorunlu 8 alanı sayar (property-owner/info.ts ile aynı)", () => {
    expect(OWNER_REQUIRED_SUMMARY).toHaveLength(8);
    const src = readFileSync("src/lib/property-owner/info.ts", "utf8");
    const required = (src.match(/required: true/g) ?? []).length;
    expect(required).toBe(OWNER_REQUIRED_SUMMARY.length - 1); // authDates koşullu zorunlu (required: needsDates)
    const t = guideText("portfoy-ekle");
    for (const word of ["telefon", "ilişki türü", "tapu", "yetki", "ilan kaynağı", "KVKK"]) expect(t).toContain(word);
  });

  it("istenen konuların rehberi var", () => {
    for (const slug of [
      "ilk-gun", "ice-aktar", "portfoy-ekle", "ilan-yayinla", "ekip-davet", "roller-izinler", "talep-kaydi", "whatsapp",
      "randevu-takvim", "anlasma-kapanis", "komisyon-defteri", "komisyon-disa-aktar", "giderler-aidat", "degerleme",
      "krediler", "paketler", "deneme-odeme", "faturalar", "davet-kazan", "destek-asistan",
    ])
      expect(GUIDES.some((g) => g.slug === slug), slug).toBe(true);
    // mevcut Krediler rehberi korunur
    expect(guideText("krediler")).toContain("Hesap kredisi");
  });

  it("fiyat ve tarife sabit yazılmaz; /fiyatlar ve Abonelik'e yönlendirilir", () => {
    for (const g of GUIDES) expect(FAQ_PRICE_PATTERN.test([g.intro, ...g.steps].join(" ")), g.slug).toBe(false);
    expect(guideText("paketler")).toContain("/fiyatlar");
    expect(guideText("degerleme")).toContain("işlem öncesi ekranda gösterilir");
  });

  it("muhasebe için expenses izni ve komisyon faturası farkı anlatılır", () => {
    expect(guideText("roller-izinler")).toContain("expenses");
    expect(guideText("faturalar")).toContain("komisyon faturası EmlakSoft'ta kesilmez");
    expect(guideText("ekip-davet")).toContain("Daveti yinele");
  });
});

describe("arama süzgeci", () => {
  it("boş sorgu hepsini, Türkçe büyük/küçük harf duyarsız eşleşir", () => {
    expect(matchesQuery(["Komisyon defteri"], "")).toBe(true);
    expect(matchesQuery(["Komisyon defteri"], "KOMİSYON")).toBe(true);
    expect(matchesQuery(["Işık"], "ışık")).toBe(true);
    expect(matchesQuery(["Komisyon"], "randevu")).toBe(false);
  });

  it("gerçek rehberlerde arama sonuç döndürür", () => {
    const hits = GUIDES.filter((g) => matchesQuery([g.title, g.intro, ...g.steps], "kontör"));
    expect(hits.length).toBeGreaterThanOrEqual(2);
  });
});

describe("sekmeler ve SSS", () => {
  it("SSS sekmesi çözülür", () => {
    expect(HELP_TABS.map((t) => t.id)).toContain("sss");
    expect(resolveHelpTab("sss")).toBe("sss");
    expect(resolveHelpTab("yok")).toBe("baslangic");
  });

  it("en az 40 soru, benzersiz kimlik, geçerli kategori", () => {
    expect(FAQ.length).toBeGreaterThanOrEqual(40);
    expect(new Set(FAQ.map((f) => f.id)).size).toBe(FAQ.length);
    const cats = new Set(FAQ_CATEGORIES.map((c) => c.id));
    for (const f of FAQ) {
      expect(cats.has(f.category), f.id).toBe(true);
      expect(f.q.endsWith("?"), f.id).toBe(true);
      expect(f.a.length, f.id).toBeGreaterThan(30);
      if (f.href) expect(f.href.startsWith("/app"), f.id).toBe(true);
    }
  });

  it("SSS'de sabit fiyat/TL rakamı yok; fiyat sorusu /fiyatlar ve Abonelik'e yönlendirir", () => {
    for (const f of FAQ) expect(FAQ_PRICE_PATTERN.test(f.a), f.id).toBe(false);
    const fiyat = FAQ.find((f) => f.id === "fiyat");
    expect(fiyat?.a).toContain("/fiyatlar");
    expect(fiyat?.a).toContain("Abonelik");
  });

  it("SSS dosyasında doğrudan OpenAI çağrısı yok", () => {
    const src = readFileSync("src/lib/help-faq.ts", "utf8");
    expect(src).not.toContain("api.openai.com");
    expect(src).not.toMatch(/\bfetch\(/);
  });
});
