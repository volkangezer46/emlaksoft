import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(rel);
  }
  return out;
}

/**
 * ÜRÜN KARARI: raporlar YALNIZ Raporlar sayfasında (/app/raporlar, /admin/raporlar). Diğer sayfalarda
 * "Raporlarda aç" bağlantısı, rapor indirme ucu bağlantısı ya da kaldırılmış bileşen bulunmaz.
 * İzinli yerler gerekçelidir.
 */
const ALLOWED_PREFIXES: { prefix: string; why: string }[] = [
  { prefix: "src/app/app/raporlar/", why: "Raporlar sayfası ve alt raporları" },
  { prefix: "src/app/admin/raporlar/", why: "Platform Raporlar sayfası" },
  { prefix: "src/app/api/app/rapor/", why: "İndirme ucunun kendisi" },
  { prefix: "src/app/api/admin/rapor/", why: "İndirme ucunun kendisi" },
  { prefix: "src/components/report-center/", why: "Rapor merkezi bileşenlerinin kendisi" },
];

const BANNED: RegExp[] = [/ReportOpenLink/, /Raporlarda aç/, /\/api\/app\/rapor/, /\/api\/admin\/rapor/, /reportDownloadHref/];

describe("rapor düğmeleri yalnız Raporlar sayfasında", () => {
  it("/app ve /admin sayfalarında rapor bağlantısı/indirme ucu yok", () => {
    const offenders: string[] = [];
    for (const file of [...walk("src/app/app"), ...walk("src/app/admin"), ...walk("src/components")]) {
      if (ALLOWED_PREFIXES.some((a) => file.startsWith(a.prefix))) continue;
      const text = readFileSync(join(ROOT, file), "utf8");
      for (const re of BANNED) if (re.test(text)) offenders.push(`${file}: ${re}`);
    }
    expect(offenders).toEqual([]);
  });

  it("ReportOpenLink bileşeni geri gelmez", () => {
    expect(() => readFileSync(join(ROOT, "src/components/report-center/report-open-link.tsx"))).toThrow();
  });
});
