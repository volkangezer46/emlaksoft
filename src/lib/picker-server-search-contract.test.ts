import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Müşteri/portföy seçici sözleşmesi.
 *
 * Eskiden bu formlar sayfa yüklenirken `customers`/`properties` için
 * `.limit(200|300|500)` havuzu çekip native `<select>`e basıyordu: 300+ müşterisi
 * olan ofiste alfabetik sıra dışındaki kayıt SEÇİLEMİYORDU. Artık seçiciler
 * `Combobox` + `src/app/actions/lookup.ts` (searchCustomers/searchProperties/...)
 * ile sunucu taraflı arar; sayfa yalnız ön dolgudaki tek kaydı `.eq('id')` ile getirir.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const PAGES = [
  "src/app/app/teklifler/yeni/page.tsx",
  "src/app/app/talepler/yeni/page.tsx",
  "src/app/app/portfoyler/sunumlar/yeni/page.tsx",
  "src/app/app/belgeler/evrak-linkleri/page.tsx",
  "src/app/app/uyum/talepler/page.tsx",
  "src/app/app/uyum/kayit-defteri/page.tsx",
  "src/app/app/tavsiyeler/page.tsx",
];

const FORMS = [
  "src/app/app/teklifler/yeni/new-offer-form.tsx",
  "src/app/app/talepler/yeni/demand-form.tsx",
  "src/app/app/portfoyler/sunumlar/yeni/presentation-form.tsx",
  "src/app/app/belgeler/evrak-linkleri/evrak-forms.tsx",
  "src/app/app/uyum/talepler/request-forms.tsx",
  "src/app/app/uyum/kayit-defteri/ledger-forms.tsx",
  "src/app/app/tavsiyeler/referral-actions.tsx",
];

describe("müşteri/portföy seçicileri sunucu taraflı aranır", () => {
  it.each(PAGES)("%s: customers/properties için limit havuzu çekmez", (path) => {
    const src = read(path);
    // `.from("customers")` / `.from("properties")` ile başlayan her sorgu parçasında
    // (bir sonraki `.from(`'a kadar) `.limit(` olmamalı — havuz değil tek kayıt gelir.
    const chunks = src.split(/\.from\(/).slice(1);
    const offenders = chunks
      .filter((c) => /^"(customers|properties)"\)/.test(c))
      .filter((c) => /\.limit\(\s*\d+\s*\)/.test(c.split(/\n\s*\n|\.from\(/)[0].slice(0, 400)))
      .map((c) => c.slice(0, 60));
    expect(offenders, `${path}: seçici havuzu (limit) geri geldi`).toEqual([]);
  });

  it.each(FORMS)("%s: müşteri/portföy listesi native select seçeneği olarak basılmaz", (path) => {
    const src = read(path);
    expect(src).not.toMatch(/\b(customers|properties)\.map\([^)]*\)\s*=>\s*\(\s*<option/);
    expect(src).not.toMatch(/\b(customers|properties)\.map\(\(\w+\)\s*=>\s*\(\s*<option/);
  });

  it("seçici formları lookup.ts sunucu aramasını kullanır", () => {
    for (const path of FORMS) {
      expect(read(path), path).toMatch(/@\/app\/actions\/lookup/);
    }
  });

  it("lookup.ts yeni aramaları yetki kapısından geçirir", () => {
    const src = read("src/app/actions/lookup.ts");
    for (const fn of ["searchOfferProperties", "getPropertyPriceSummary", "searchLivePropertiesForPresentation"]) {
      const body = src.slice(src.indexOf(`export async function ${fn}`)).split(/\nexport /)[0];
      expect(body, fn).toMatch(/requirePermission\("properties", "view"\)/);
    }
    expect(src).not.toMatch(/createAdminClient/);
  });
});
