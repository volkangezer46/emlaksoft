import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLATFORM_REPORT_EXPORT_ACTION_NAME, REPORT_EXPORT_ACTION_NAME } from "@/lib/report-center/export-actions";

/**
 * Soğuk başlangıç sözleşmesi (2026-10-10 ölçümü): her /app sayfasının SUNUCU paketi (yaklaşık 1,7-2,3 MB eager JS) ağır
 * paketleri yalnız kullanıldıkları yolda yüklemeli. Rapor merkezi sayfası pdf-lib'i (1,1 MB) `history.ts → download.ts →
 * render.ts` zinciriyle çekiyordu; web-push (110 KB) `notify.ts → push.ts` ile 43 modüle taşınıyordu.
 */
const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** `import type` hariç değer içe aktarmaları. */
function valueImportSpecs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^;]*?\s*from\s*["']([^"']+)["']/g)) {
    if (!m[1]) out.push(m[2]!);
  }
  return out;
}

describe("soğuk başlangıç: ağır modüller yalnız kullanıldığı yolda", () => {
  it("rapor merkezi sayfa tarafı modülleri indirme/PDF/XLSX üreticisini içe aktarmaz", () => {
    // Sayfaların (ReportCenter bileşeni) eriştiği modüller; yalnız /api/*/rapor/[id] rotaları download.ts'i çeker.
    for (const f of ["history.ts", "registry.ts", "context.ts", "engine.ts", "filters.ts", "links.ts", "values.ts", "types.ts"]) {
      const specs = valueImportSpecs(read(`src/lib/report-center/${f}`));
      const bad = specs.filter((s) => /(^|\/)(download|render)$|format\/(pdf|xlsx|zip)$|^pdf-lib$|^@pdf-lib\/|read-excel-file/.test(s));
      expect(bad, `${f} ağır modülü statik içe aktarıyor`).toEqual([]);
    }
  });

  it("hafif eylem adı kopyası download.ts'teki tek kaynakla birebir aynı", () => {
    const dl = read("src/lib/report-center/download.ts");
    expect(dl).toContain(`REPORT_EXPORT_ACTION = "${REPORT_EXPORT_ACTION_NAME}"`);
    expect(dl).toContain(`PLATFORM_REPORT_EXPORT_ACTION = "${PLATFORM_REPORT_EXPORT_ACTION_NAME}"`);
  });

  it("push.ts web-push'u statik içe aktarmaz (yalnız gönderirken dinamik yüklenir)", () => {
    const specs = valueImportSpecs(read("src/lib/push.ts"));
    expect(specs).not.toContain("web-push");
    expect(read("src/lib/push.ts")).toMatch(/await import\("web-push"\)/);
  });
});
