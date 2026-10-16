import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { memo, readCached, walkSource } from "./test-support/src-tree";
import { LOSS_TERMS, TERMINOLOGY_FORBIDDEN, TERMS } from "./terminology";
import { FORBIDDEN_TERMS, PLAIN_FORBIDDEN, PLAIN_LABELS } from "./terms";

/**
 * Terim sözleşmesi: kullanıcıya görünen metinde (boşluk içeren string literal ve JSX metni)
 * yasaklı varyant geçmez. Yol adları, import yolları ve kod tanımlayıcıları taranmaz.
 */

const ROOT = join(process.cwd(), "src");

/** Bilinçli istisnalar (gerekçeli). Yeni istisna eklemek yerine metni düzelt. */
const ALLOW: Record<string, string> = {
  // Platform satış CRM'i eylemleri platform satış adayını "lead" diye anar (ofis kullanıcısına görünmez).
  "src/app/actions/platform-sales.ts": "platform satış CRM'i mesajları (yalnız /admin)",
  // Sözlük ve test dosyaları yasaklı terimi tanımlamak/anlatmak için anar.
  "src/lib/terminology.ts": "sözlük tanımı",
  "src/lib/terminology-contract.test.ts": "sözleşme testi",
  // Platform destek kuyruğu ve platform raporları: "SLA" yalnız /admin personelinin gördüğü destek süre hedefidir.
  "src/app/admin/tickets": "platform destek kuyruğu (yalnız /admin personeli)",
  "src/lib/report-center/catalog/platform.ts": "platform raporları (yalnız /admin personeli)",
  // Havuz besleme/bildirim metinleri başka ajanın kapsamında (UX-3); sonraki dalgada "Gecikti/süre" diline çekilecek.
  "src/lib/pool": "havuz besleme ajanı kapsamı (UX-3): SLA metinleri sonraki dalgada düzeltilecek",
  // Platform migration prova aracı (yalnız /admin): teknik tablo adlarını ("kontör cüzdanı") anlatır.
  "src/lib/migration-rehearsal": "yalnız /admin migration provası",
};

/**
 * Tek satırlık string literal ve JSX metin parçalarını çıkarır (yorum satırları atlanır).
 * `singleWords`: boşluksuz, büyük harfle başlayan tek kelimelik etiketleri de alır ("Kanban", "Cari" gibi sekme adları).
 */
function visibleTexts(src: string, singleWords = false): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  src.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    // `aka:` arama eş anlamlısıdır (kullanıcı "lead" yazarak da bulabilsin); görünür başlık değildir.
    if (!line || /^aka:/.test(line) || line.startsWith("//") || line.startsWith("*") || line.startsWith("/*") || /^import\s|^export .* from /.test(line)) return;
    for (const m of raw.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\\n]|\\.)*)`/g)) {
      // Şablon ifadeleri (${lead.score}) kod tanımlayıcısıdır; "Lead Ads" Meta ürün adıdır.
      const text = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}/g, "").replace(/Lead Ads/g, "");
      const label = singleWords && /^[A-ZÇĞİÖŞÜ][A-Za-zÇĞİÖŞÜçğıöşü]+$/.test(text);
      if ((label || /\s/.test(text.trim())) && !text.startsWith("/") && !text.includes("@/")) out.push({ line: i + 1, text });
    }
    for (const m of raw.matchAll(/>([^<>{}]*[A-Za-zÇĞİÖŞÜçğıöşü][^<>{}]*)</g)) out.push({ line: i + 1, text: m[1] });
  });
  return out;
}

describe("terim sözlüğü yapısı", () => {
  it("kayıp kavramı üç ayrı adla tanımlı", () => {
    expect(LOSS_TERMS.leak.canonical).not.toBe(LOSS_TERMS.lostDeal.canonical);
    expect(LOSS_TERMS.lostDeal.canonical).not.toBe(LOSS_TERMS.atRisk.canonical);
    expect(LOSS_TERMS.leak.canonical).not.toBe(LOSS_TERMS.atRisk.canonical);
  });
  it("her terimin tanımı var", () => {
    for (const t of Object.values(TERMS)) expect(t.definition.length).toBeGreaterThan(10);
  });
});

describe("kazanç sayfası 'cüzdan' demez", () => {
  it("Kazanç sayfası dosyalarında (yorum dışı) 'cüzdan' geçmez; hesap kredisi ayrı kavramdır", () => {
    const files = ["src/app/app/kazancim/page.tsx", "src/app/app/finans/(merkez)/hakedis/office-earnings.tsx"];
    const hits: string[] = [];
    for (const f of files) {
      for (const { line, text } of visibleTexts(readFileSync(join(process.cwd(), f), "utf8"))) {
        if (/\bcüzdan/i.test(text)) hits.push(`${f}:${line}  ${text.slice(0, 90)}`);
      }
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});

describe("yasaklı terim sözleşmesi (kullanıcıya görünen metin)", () => {
  // Dosya başına görünür metinler TEK sefer çıkarılır (her yasaklı terim için yeniden taranmaz).
  const scanned = () =>
    memo("terminology.visibleTexts", () =>
      walkSource(ROOT)
        .map((f) => ({ f, rel: relative(process.cwd(), f).replace(/\\/g, "/") }))
        .filter(({ rel }) => !Object.keys(ALLOW).some((a) => rel === a || rel.startsWith(`${a}/`)))
        .map(({ f, rel }) => ({ rel, texts: visibleTexts(readCached(f)) })),
    );
  for (const { term, pattern, use } of TERMINOLOGY_FORBIDDEN) {
    it(`"${term}" yasaklı varyantı görünür metinde geçmez (kullan: ${use})`, () => {
      const hits: string[] = [];
      for (const { rel, texts } of scanned()) {
        for (const { line, text } of texts) {
          if (pattern.test(text)) hits.push(`${rel}:${line}  ${text.slice(0, 90)}`);
        }
      }
      expect(hits, `Yasaklı terim "${term}" bulundu:\n${hits.join("\n")}`).toEqual([]);
    }, 30_000);
  }
});

describe("Mülk yönetimi / Kiralık adlandırması", () => {
  it("anlaşma türü etiketi tek kaynaktan: rent -> Kiralık", async () => {
    const { dealTypeLabel } = await import("./deal-type-label");
    expect(dealTypeLabel("rent")).toBe("Kiralık");
    expect(dealTypeLabel("sale")).toBe("Satış");
    expect(TERMS.mulkYonetimi.canonical).toBe("Mülk yönetimi");
  });
  it('anlaşma türü için satır içi "Kiralama" : "Satış" üçlüsü kalmaz (dealTypeLabel kullan)', () => {
    const hits: string[] = [];
    for (const f of walkSource(ROOT)) {
      const rel = relative(process.cwd(), f).replace(/\\/g, "/");
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) continue;
      readCached(f).split("\n").forEach((l, i) => {
        if (/"Kiralama" : "Satış"|rent: "Kiralama"/.test(l)) hits.push(`${rel}:${i + 1}`);
      });
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });
});

/**
 * Sade Türkçe sözlük (basitlik planı §2.6, C30): en basit kullanıcı ve ofis sahibi jargon görmez.
 * Kapsam: uygulama ekranları (`src/app/app/**`), ortak bileşenler (`src/components/**`), menü etiketleri
 * (`src/lib/nav-*.ts`) ve pazarlama metinleri. Yol adları ve kod tanımlayıcıları taranmaz (yalnız görünür metin).
 */
describe("sade Türkçe sözlük (PLAIN_LABELS) sözleşmesi", () => {
  const MARKETING = [
    "src/app/page.tsx",
    "src/app/_home",
    "src/app/fiyatlar",
    "src/app/araclar",
    "src/app/rehber",
    "src/app/kariyer",
    "src/app/[...slug]",
    "src/lib/site-content",
    "src/lib/site-menu",
    "src/lib/product-tour-data.ts",
    "src/lib/marketing-nav.ts",
  ];
  const inScope = (rel: string) =>
    rel.startsWith("src/app/app/") ||
    rel.startsWith("src/components/") ||
    /^src\/lib\/nav-[\w-]+\.ts$/.test(rel) ||
    MARKETING.some((m) => rel === m || rel.startsWith(`${m}/`));

  /** Gerekçeli istisnalar: dosya/dizin -> istisna olduğu terimler. */
  const PLAIN_ALLOW: { path: string; terms: string[]; why: string }[] = [
    // "Aday" yalnız ayarlardaki aday yakalama, işe alım (danışman adayı) ve kiracı başvurusu bağlamında gerçek kavramdır.
    { path: "src/app/app/ayarlar", terms: ["aday"], why: "ayarlar: 'Aday yakalama' ayarı (plan §2.6: ayarlar dışında yasak)" },
    { path: "src/app/app/ekip/adaylar", terms: ["aday"], why: "işe alım: danışman adayları" },
    { path: "src/app/app/kiralama/basvurular", terms: ["aday"], why: "kiracı başvuruları: kiracı adayı" },
    { path: "src/app/kariyer", terms: ["aday"], why: "kariyer sayfası: iş başvurusu yapan aday" },
    { path: "src/components/admin", terms: ["aday", "lead", "kpi", "icgoru", "nps", "roi", "hakedis", "cari"], why: "yalnız /admin platform personeli" },
    // Simge arama anahtar kelimeleri: eski adla arayan yöneticinin de bulabilmesi için (görünür başlık değil).
    // Ayarlar menüsündeki "Aday yakalama" ayarı (plan §2.6: ayarlarda serbest).
    { path: "src/lib/nav-config.ts", terms: ["aday"], why: "ayarlar menüsü: Aday yakalama ayarı" },
    { path: "src/lib/nav-roles.ts", terms: ["aday"], why: "ayarlar menüsü: Aday yakalama ayarı" },
    { path: "src/lib/site-menu/icon-registry.tsx", terms: ["hakedis"], why: "simge arama anahtar kelimesi (aka)" },
  ];
  const allowed = (rel: string, term: string) => PLAIN_ALLOW.some((a) => (rel === a.path || rel.startsWith(`${a.path}/`)) && a.terms.includes(term));

  const scanned = () =>
    memo("terminology.plainTexts", () =>
      walkSource(ROOT)
        .map((f) => ({ f, rel: relative(process.cwd(), f).replace(/\\/g, "/") }))
        .filter(({ rel }) => inScope(rel))
        .map(({ f, rel }) => ({ rel, texts: visibleTexts(readCached(f), true) })),
    );

  it("her sade terimin eski ve yeni adı var; kesin yasaklar FORBIDDEN_TERMS içinde", () => {
    for (const l of Object.values(PLAIN_LABELS)) {
      expect(l.old.length).toBeGreaterThan(0);
      expect(l.use.length).toBeGreaterThan(0);
    }
    for (const t of ["Kanban", "KPI", "Lead", "ilan ata", "Mini muhasebe", "momentum"]) {
      expect(FORBIDDEN_TERMS.some((re) => re.test(t)), t).toBe(true);
    }
    // Gerçek kavramlar yasak değil.
    const aday = PLAIN_LABELS.aday.pattern;
    expect(aday.test("Danışman adayı")).toBe(false);
    expect(aday.test("Kiracı adayları")).toBe(false);
    expect(aday.test("Aday skoru")).toBe(true);
    expect(PLAIN_LABELS.nps.pattern.test("Müşteri memnuniyeti (NPS)")).toBe(false);
    expect(PLAIN_LABELS.nps.pattern.test("Ekip NPS")).toBe(true);
  });

  for (const { term, pattern, use } of PLAIN_FORBIDDEN) {
    it(`"${term}" eski adı görünür metinde geçmez (kullan: ${use})`, () => {
      const hits: string[] = [];
      for (const { rel, texts } of scanned()) {
        if (allowed(rel, term)) continue;
        for (const { line, text } of texts) if (pattern.test(text)) hits.push(`${rel}:${line}  ${text.slice(0, 90)}`);
      }
      expect(hits, `Sade sözlük ihlali "${term}" (kullan: ${use}):\n${hits.join("\n")}`).toEqual([]);
    }, 30_000);
  }
});
