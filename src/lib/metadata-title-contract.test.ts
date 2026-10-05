import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Başlıklar artık tek kaynakta (src/lib/seo/registry.ts); sayfalar buildMetadata ile beslenir
// ve marka eki yalnız kök başlık şablonundadır (varsayılan: src/lib/seo/schema.ts).
const legalPages = {
  "src/app/gizlilik/page.tsx": ["/gizlilik", "Gizlilik Politikası"],
  "src/app/kvkk-aydinlatma/page.tsx": ["/kvkk-aydinlatma", "KVKK Aydınlatma Metni"],
  "src/app/kullanim-sartlari/page.tsx": ["/kullanim-sartlari", "Kullanım Şartları"],
  "src/app/iptal-iade/page.tsx": ["/iptal-iade", "İptal & İade Politikası"],
  "src/app/cerez-politikasi/page.tsx": ["/cerez-politikasi", "Çerez Politikası"],
  "src/app/on-bilgilendirme/page.tsx": ["/on-bilgilendirme", "Ön Bilgilendirme Formu"],
  "src/app/mesafeli-satis/page.tsx": ["/mesafeli-satis", "Mesafeli Satış Sözleşmesi"],
  "src/app/davet-kosullari/page.tsx": ["/davet-kosullari", "Davet ve Ortaklık Programı Koşulları"],
} as const;

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

describe("metadata title contract", () => {
  it("keeps the brand suffix centralized in the root title template", () => {
    expect(source("src/lib/seo/schema.ts")).toContain('titleTemplate: "%s | EmlakSoft"');
    expect(source("src/app/layout.tsx")).toContain("buildRootMetadata()");
  });

  it.each(Object.entries(legalPages))("does not duplicate the brand in %s", (file, [path, title]) => {
    expect(source(file)).toContain(`buildMetadata("${path}")`);
    const registry = source("src/lib/seo/registry.ts");
    expect(registry).toContain(`title: "${title}",`);
    expect(registry).not.toContain(`title: "${title} | EmlakSoft",`);
  });
});
