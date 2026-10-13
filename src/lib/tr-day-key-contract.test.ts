import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * "Bugün" Türkiye günüdür: `new Date().toISOString().slice(0, 10)` UTC günüdür ve TR 00:00–03:00 arasında
 * DÜNÜ verir (teklif son tarihi reddi, kira bitişi bir gün eksik, vade sayımı kayık). Sunucu action'ları ve
 * API rotaları gün anahtarını `trDayKey()` / `trDayKey(now() + N * DAY_MS)` (`src/lib/clock.ts`) ile alır.
 */
const ROOTS = ["src/app/actions", "src/app/api"];

const FORBIDDEN = /new Date\((?:|Date\.now\(\)[^)]*)\)\.toISOString\(\)\.slice\(0,\s*10\)/;

/** Gerekçeli istisnalar: dosya → neden. Kapanan satır buradan silinir (aşağıdaki test bayat girdiyi yakalar). */
const EXCEPTIONS: Record<string, string> = {
  // Kira tahakkuk cron'u UTC 00:xx'te çalışır; gün anahtarlarının geçişi tahakkuk idempotens anahtarlarını
  // etkiler, ayrı iş paketiyle (veri geçişi değerlendirmesiyle) ele alınacak.
  "src/app/api/cron/kira-tahakkuk/route.ts": "tahakkuk gün anahtarı geçişi ayrı iş",
  // Proje vade cron'u: aynı sebeple ayrı iş paketinde.
  "src/app/api/cron/proje-vade/route.ts": "vade gün anahtarı geçişi ayrı iş",
};

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

const files = ROOTS.flatMap(sourceFiles).map((f) => relative(".", f).replaceAll("\\", "/"));

describe("TR gün anahtarı sözleşmesi", () => {
  it("src/app/actions ve src/app/api UTC gününü 'bugün' diye kullanmaz", () => {
    const offenders = files
      .filter((file) => !(file in EXCEPTIONS))
      .flatMap((file) =>
        readFileSync(file, "utf8")
          .split("\n")
          .flatMap((line, i) => (FORBIDDEN.test(line) ? [`${file}:${i + 1}`] : [])),
      );
    expect(offenders).toEqual([]);
  });

  it("istisna listesi bayat değil (her istisna hâlâ deseni içerir)", () => {
    for (const file of Object.keys(EXCEPTIONS)) {
      expect(FORBIDDEN.test(readFileSync(file, "utf8")), file).toBe(true);
    }
  });

  it("desen hem bugün hem gelecek gün biçimini yakalar", () => {
    expect(FORBIDDEN.test("const t = new Date().toISOString().slice(0, 10);")).toBe(true);
    expect(FORBIDDEN.test("new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0,10)")).toBe(true);
    expect(FORBIDDEN.test("trDayKey(now() + 3 * DAY_MS)")).toBe(false);
  });
});
