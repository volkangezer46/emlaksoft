import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { topLevelSql } from "./migration-rehearsal/core";

/**
 * SK1/B044 yardımcı kuralı: PostgREST şema yeniden yüklemesi yayın başına TEK kez, deploy.sh'ten gelir
 * (release.sh migrate süresince pgrst DDL izleyicilerini kapatır; deploy.sh yeni sürüm açılmadan önce bir NOTIFY
 * gönderip RPC'leri ısıtır). Bu yüzden 2026-10-16 ve sonrası migration'lar ÜST DÜZEYDE `notify pgrst` içermez.
 * Fonksiyon gövdesindeki NOTIFY (ör. 20261016010100 pgrst_ddl_watch) üst düzey sayılmaz. Eski dosyalar değişmez.
 */
const DIR = join(process.cwd(), "supabase/migrations");
const CUTOFF = "20261016000000";

describe("yeni migration'larda üst düzey 'notify pgrst' yok (SK1/B044)", () => {
  it(`${CUTOFF} ve sonrası`, () => {
    const offenders = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql") && f.slice(0, 14) >= CUTOFF)
      .filter((f) => /\bnotify\s+pgrst\b/i.test(topLevelSql(readFileSync(join(DIR, f), "utf8"))));
    expect(
      offenders,
      `Bu dosyalardan üst düzey 'notify pgrst' satırını kaldırın (yeniden yüklemeyi deploy.sh yapar):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("kural fonksiyon gövdesindeki NOTIFY'ı saymaz, üst düzeydekini yakalar", () => {
    const body = "create function f() returns void language plpgsql as $$ begin notify pgrst, 'reload schema'; end $$;";
    expect(/\bnotify\s+pgrst\b/i.test(topLevelSql(body))).toBe(false);
    expect(/\bnotify\s+pgrst\b/i.test(topLevelSql(`${body}\nnotify pgrst, 'reload schema';`))).toBe(true);
  });
});
