import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const legalPageTitles = {
  "src/app/gizlilik/page.tsx": "Gizlilik Politikası",
  "src/app/kvkk-aydinlatma/page.tsx": "KVKK Aydınlatma Metni",
  "src/app/kullanim-sartlari/page.tsx": "Kullanım Şartları",
  "src/app/iptal-iade/page.tsx": "İptal & İade Politikası",
  "src/app/cerez-politikasi/page.tsx": "Çerez Politikası",
  "src/app/on-bilgilendirme/page.tsx": "Ön Bilgilendirme Formu",
  "src/app/mesafeli-satis/page.tsx": "Mesafeli Satış Sözleşmesi",
} as const;

function source(file: string): string {
  return readFileSync(resolve(process.cwd(), file), "utf8");
}

describe("metadata title contract", () => {
  it("keeps the brand suffix centralized in the root title template", () => {
    expect(source("src/app/layout.tsx")).toContain('template: "%s | EmlakSoft"');
  });

  it.each(Object.entries(legalPageTitles))(
    "does not duplicate the brand in %s",
    (file, title) => {
      const content = source(file);
      expect(content).toContain(`title: "${title}",`);
      expect(content).not.toContain(`title: "${title} | EmlakSoft",`);
    },
  );
});
