import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Vitrin talep formu sözleşmesi (saha denetimi Q2):
 *  - Talep formu açık temalıdır (COM-13). Koyu `.theme-dark` kabuk metin token'larını beyaza çevirir; form oraya
 *    konunca alanlar ve onay metinleri beyaz üstüne beyaz kalıyordu. Form her iki vitrin yüzeyinde de açık zeminde durur.
 *  - Vitrin `brandTheme` stilini taşımaz: formun marka değişkenleri ürün rengine düşen yedekle yazılır (yoksa gönder
 *    düğmesi zeminsiz kalıyordu).
 *  - İlan sayfasındaki talep o portföye bağlanır (`listingRef`) ve arama kriterleri (işlem/tür/il/bütçe) sorulmaz.
 */
const read = (p: string) => readFileSync(p, "utf8");

function containerBefore(src: string, marker: string): string {
  const i = src.indexOf(marker);
  expect(i, `${marker} bulunamadı`).toBeGreaterThan(-1);
  // Formu saran en yakın açılış etiketi.
  const before = src.slice(0, i);
  const open = before.lastIndexOf("<div className=");
  return before.slice(open, before.indexOf(">", open) + 1);
}

describe("vitrin talep formu", () => {
  it("ilan sayfası: form açık zeminde ve portföye bağlı", () => {
    const src = read("src/app/vitrin/[slug]/[ilan]/page.tsx");
    expect(src).toContain("listingRef={property.id}");
    expect(containerBefore(src, "<LazyLeadForm")).not.toContain("theme-dark");
  });

  it("vitrin ana sayfası: form açık zeminde", () => {
    const src = read("src/app/vitrin/[slug]/page.tsx");
    expect(containerBefore(src, "<LazyLeadForm")).not.toContain("theme-dark");
  });

  it("form: marka değişkenleri yedekli; ilan bağlamında arama kriterleri yok", () => {
    const src = read("src/app/lead/[token]/lead-form.tsx");
    expect(src).not.toMatch(/var\(--pb-[a-z-]+\)/);
    expect(src).toContain("{listingRef ? null : (");
  });
});
