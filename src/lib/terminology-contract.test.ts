import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { LOSS_TERMS, TERMINOLOGY_FORBIDDEN, TERMS } from "./terminology";

/**
 * Terim sözleşmesi: kullanıcıya görünen metinde (boşluk içeren string literal ve JSX metni)
 * yasaklı varyant geçmez. Yol adları, import yolları ve kod tanımlayıcıları taranmaz.
 */

const ROOT = join(process.cwd(), "src");

/** Bilinçli istisnalar (gerekçeli). Yeni istisna eklemek yerine metni düzelt. */
const ALLOW: Record<string, string> = {
  // /admin satış CRM'i platform satış adayını "lead" diye anar (ofis kullanıcısına görünmez).
  "src/app/admin/satis": "platform satış CRM'i (yalnız /admin)",
  "src/app/actions/platform-sales.ts": "platform satış CRM'i mesajları (yalnız /admin)",
  // Müşteriler paketi (başka ajanın sahası): "Lead skoru" metinleri o paketin birleşiminden sonra "Aday skoru" olacak.
  "src/app/app/musteriler": "musteriler paketi sahibi düzeltecek (BIRLESIK_YOL_HARITASI §5.1)",
  // Sözlük ve test dosyaları yasaklı terimi tanımlamak/anlatmak için anar.
  "src/lib/terminology.ts": "sözlük tanımı",
  "src/lib/terminology-contract.test.ts": "sözleşme testi",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** Tek satırlık string literal ve JSX metin parçalarını çıkarır (yorum satırları atlanır). */
function visibleTexts(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  src.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    // `aka:` arama eş anlamlısıdır (kullanıcı "lead" yazarak da bulabilsin); görünür başlık değildir.
    if (!line || /^aka:/.test(line) || line.startsWith("//") || line.startsWith("*") || line.startsWith("/*") || /^import\s|^export .* from /.test(line)) return;
    for (const m of raw.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\\n]|\\.)*)`/g)) {
      // Şablon ifadeleri (${lead.score}) kod tanımlayıcısıdır; "Lead Ads" Meta ürün adıdır.
      const text = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\$\{[^}]*\}/g, "").replace(/Lead Ads/g, "");
      if (/\s/.test(text.trim()) && !text.startsWith("/") && !text.includes("@/")) out.push({ line: i + 1, text });
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

describe("yasaklı terim sözleşmesi (kullanıcıya görünen metin)", () => {
  const files = walk(ROOT);
  for (const { term, pattern, use } of TERMINOLOGY_FORBIDDEN) {
    it(`"${term}" yasaklı varyantı görünür metinde geçmez (kullan: ${use})`, () => {
      const hits: string[] = [];
      for (const f of files) {
        const rel = relative(process.cwd(), f).replace(/\\/g, "/");
        if (Object.keys(ALLOW).some((a) => rel === a || rel.startsWith(`${a}/`))) continue;
        for (const { line, text } of visibleTexts(readFileSync(f, "utf8"))) {
          if (pattern.test(text)) hits.push(`${rel}:${line}  ${text.slice(0, 90)}`);
        }
      }
      expect(hits, `Yasaklı terim "${term}" bulundu:\n${hits.join("\n")}`).toEqual([]);
    });
  }
});
