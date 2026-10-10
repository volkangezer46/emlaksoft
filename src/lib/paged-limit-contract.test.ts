import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Ratchet: `.limit(N)` ile N > 1000 PostgREST `max_rows` (1000) yüzünden SESSİZCE 1000 satırda kesilir.
 * Yeni kod 1000'den büyük limit YAZMAZ; tam liste gerekiyorsa `readAllPaged` (src/lib/supabase/read-all-paged.ts)
 * veya `fetchAllRows` kullanılır. Aşağıdaki liste mevcut kullanımların GEREKÇELİ istisnasıdır: yalnız küçülebilir
 * (bir dosya düzelince girdisi silinir/azaltılır; sayı artırmak ya da yeni dosya eklemek bu testi kırar).
 * Para cron'ları (kira-tahakkuk, proje-vade, anket-gorevleri, anahtar-gecikme) artık sayfalıdır ve burada YOKTUR.
 */
const R_CRON = "Cron/hatırlatma: büyük tenant'ta kesilebilir; sayfalı okumaya (readAllPaged) taşınacak.";
const R_LOADER = "Okuma yardımcısı/yükleyici: sayfa içi listede kesme kabul edilmiş; tam liste gerekirse readAllPaged'e taşınacak.";
const R_UI = "Arayüz listesi/sayfa verisi: kullanıcıya dönük tavan; sayfalama/uyarı eklenince kaldırılacak.";
const R_ACTION = "Toplu işlem (içe aktarma/geri alma/denetim): işlem tavanı bilinçli; sayfalı okumaya taşınacak.";

const BASELINE: Record<string, { count: number; reason: string }> = {
  "src/app/actions/audit-dossier.ts": { count: 2, reason: R_ACTION },
  "src/app/actions/building-management.ts": { count: 2, reason: R_ACTION },
  "src/app/actions/import-data.ts": { count: 3, reason: R_ACTION },
  "src/app/actions/import-rollback.ts": { count: 1, reason: R_ACTION },
  "src/app/actions/network.ts": { count: 1, reason: R_ACTION },
  "src/app/actions/projects.ts": { count: 1, reason: R_ACTION },
  "src/app/admin/billing/planlar/page.tsx": { count: 1, reason: R_UI },
  "src/app/admin/billing/planlar/seat-data.ts": { count: 3, reason: R_LOADER },
  "src/app/admin/tickets/page.tsx": { count: 1, reason: R_UI },
  "src/app/api/admin/tenants/[id]/export/route.ts": { count: 1, reason: R_ACTION },
  "src/app/api/cron/lig-snapshot/route.ts": { count: 1, reason: R_CRON },
  "src/app/app/aidat/page.tsx": { count: 2, reason: R_UI },
  "src/app/app/ayarlar/is-akislari/page.tsx": { count: 1, reason: R_UI },
  "src/app/app/giderler/faturalar/faturalar-tab.tsx": { count: 1, reason: R_UI },
  "src/app/app/ilan-kontrol/eklenti/page.tsx": { count: 1, reason: R_UI },
  "src/app/app/musteriler/data.ts": { count: 1, reason: R_LOADER },
  "src/app/app/musteriler/tenant-tags.ts": { count: 1, reason: R_LOADER },
  "src/lib/admin/office-360.ts": { count: 1, reason: R_LOADER },
  "src/lib/advisor/advisor-store.ts": { count: 1, reason: R_LOADER },
  "src/lib/automation-engine.ts": { count: 1, reason: R_CRON },
  "src/lib/building-management/load.ts": { count: 4, reason: R_LOADER },
  "src/lib/building-management/reminders.ts": { count: 1, reason: R_CRON },
  "src/lib/custom-fields/load.ts": { count: 1, reason: R_LOADER },
  "src/lib/ef-credits/admin-data.ts": { count: 1, reason: R_LOADER },
  "src/lib/geo/admin-store.ts": { count: 1, reason: R_LOADER },
  "src/lib/geo/reader.ts": { count: 1, reason: R_LOADER },
  "src/lib/geo/resolve.ts": { count: 1, reason: R_LOADER },
  "src/lib/growth/store.ts": { count: 1, reason: R_LOADER },
  "src/lib/lead-routing/server.ts": { count: 2, reason: R_LOADER },
  "src/lib/league/daily.ts": { count: 1, reason: R_CRON },
  "src/lib/license-reminders.ts": { count: 2, reason: R_CRON },
  "src/lib/listing-control/market-export.ts": { count: 1, reason: R_LOADER },
  "src/lib/listing-control/server/daily-match.ts": { count: 1, reason: R_CRON },
  "src/lib/listing-control/server/duplicates.ts": { count: 1, reason: R_LOADER },
  "src/lib/offer-expiry-reminders.ts": { count: 1, reason: R_CRON },
  "src/lib/office-center/store.ts": { count: 2, reason: R_LOADER },
  "src/lib/owner-report/run.ts": { count: 1, reason: R_CRON },
  "src/lib/property-authority-reminders.ts": { count: 1, reason: R_CRON },
  "src/lib/property-management/load.ts": { count: 2, reason: R_LOADER },
  "src/lib/property-management/payout-reminders.ts": { count: 1, reason: R_CRON },
  "src/lib/property-management/portal.ts": { count: 2, reason: R_LOADER },
  "src/lib/seo/sitemap-data.ts": { count: 2, reason: R_LOADER },
};

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function countBigLimits(source: string): number {
  let n = 0;
  for (const m of source.matchAll(/\.limit\(\s*([0-9][0-9_]*)\s*\)/g)) {
    if (Number(m[1].replace(/_/g, "")) > 1000) n += 1;
  }
  return n;
}

describe("sayfalı okuma ratchet'i (.limit > 1000)", () => {
  const actual: Record<string, number> = {};
  for (const file of walk(join(ROOT, "src"))) {
    const c = countBigLimits(readFileSync(file, "utf8"));
    if (c > 0) actual[relative(ROOT, file).replace(/\\/g, "/")] = c;
  }

  it("istisna listesinde olmayan dosyada .limit(>1000) yok", () => {
    const fresh = Object.keys(actual).filter((f) => !BASELINE[f]);
    expect(fresh, "Yeni .limit(>1000): readAllPaged (src/lib/supabase/read-all-paged.ts) kullan").toEqual([]);
  });

  it("istisnalı dosyada kullanım sayısı artmaz; azalınca liste güncellenir", () => {
    const grew = Object.keys(BASELINE).filter((f) => (actual[f] ?? 0) > BASELINE[f].count);
    expect(grew).toEqual([]);
    const stale = Object.keys(BASELINE).filter((f) => (actual[f] ?? 0) < BASELINE[f].count);
    expect(stale, "Düzelen dosyanın girdisini sil/azalt (ratchet yalnız küçülür)").toEqual([]);
  });

  it("her istisnanın gerekçesi var", () => {
    for (const [file, entry] of Object.entries(BASELINE)) {
      expect(entry.reason.length, file).toBeGreaterThan(10);
    }
  });

  it("dört para cron'u ve yardımcı sayfalı okur, tavan kullanmaz", () => {
    for (const job of ["kira-tahakkuk", "proje-vade", "anket-gorevleri", "anahtar-gecikme"]) {
      const src = readFileSync(join(ROOT, "src/app/api/cron", job, "route.ts"), "utf8");
      expect(src, job).toMatch(/readAllPaged/);
      expect(src, job).toMatch(/heartbeatFor/);
      expect(countBigLimits(src), job).toBe(0);
    }
  });
});
