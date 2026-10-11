import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Kanonik bileşen / tek kaynak sözleşmesi (2026-10 mükerrerlik turu). Silinen kopyalar geri gelmez, @deprecated
 * sarmalayıcılara yeni içe aktarım eklenmez:
 *  - Boş durum TEK `ui/empty-state`; iskelet TEK `ui/skeleton`; sayaç TEK `ui/count-up` (+ canlı değer `ui/animated-number`).
 *  - Para biçimi TEK `lib/format` (admin `moneyTRY` ve ana ekran `_home/format.ts` silindi).
 *  - Randevu türü etiketi TEK `lib/appointment-labels`.
 */
const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|mts)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");

describe("kanonik UI bileşenleri", () => {
  it("silinen kopyalar yok", () => {
    for (const f of [
      "src/components/ui/empty-state-v3.tsx",
      "src/components/app/empty-state.tsx",
      "src/components/app/skeleton.tsx",
      "src/components/admin/count-up.tsx",
      "src/app/app/odometer-number.tsx",
      "src/app/app/_home/format.ts",
      "src/app/app/ofis-merkezi/_tabs/settings-tab.tsx",
      "src/components/app/office-center/module-shortcuts.tsx",
    ]) {
      expect(existsSync(join(ROOT, f)), f).toBe(false);
    }
  });

  it("@deprecated sarmalayıcılara yeni içe aktarım yok (boş durum / iskelet)", () => {
    const offenders = files
      .filter((f) => /["']@\/components\/app\/(empty-state|skeleton)["']/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("para biçimi tek kaynak: moneyTRY yok", () => {
    const offenders = files.filter((f) => /\bmoneyTRY\b/.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("randevu türü etiketleri tek kaynak (lib/appointment-labels)", () => {
    const offenders = files
      .filter((f) => /showing:\s*["']Yer gösterme["']/.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter((f) => f !== "src/lib/appointment-labels.ts");
    expect(offenders).toEqual([]);
  });

  /**
   * Boş durum RATCHET (konsey #34): yeni yerel "Empty*" bileşeni YAZILMAZ, `ui/empty-state` kullanılır.
   * Aşağıdaki liste mevcut gerekçeli istisnalardır (TV panosu kendi koyu CSS'i, public portal kiti, tablo satırı, grafik
   * çizimi vb.); liste yalnız KÜÇÜLEBİLİR.
   */
  it("yerel boş durum bileşeni yok (kanonik ui/empty-state)", () => {
    const ALLOWED = new Set([
      "src/app/app/pano-tv/tv-board.tsx", // TV panosu: kendi yüksek kontrast CSS'i
      "src/components/admin/admin-table.tsx", // AdminEmpty: tablo gövdesi
      "src/components/public/portal-kit.tsx", // PortalEmpty: public token'lı portal kiti
      "src/components/public/vitrin-fav.tsx", // FavEmptyNotice: vitrin favori bilgisi
      "src/components/tools/tool-ui.tsx", // EmptyMsg: public araç mesajı
      "src/components/ui/premium/charts.tsx", // EmptyArt: grafik çizimi
      "src/components/ui/table.tsx", // TableEmptyRow: tablo kanonik satırı
      "src/components/ui/empty-state.tsx", // kanonik bileşenin kendisi
    ]);
    const offenders = files
      .filter((f) => /\bfunction\s+(?:Empty\w*|[A-Z]\w*Empty\w*)\s*\(/.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter((f) => !ALLOWED.has(f));
    expect(offenders).toEqual([]);
  });
});
