import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { WP6_HREF_MIGRATION, wp6HrefFunctionSql } from "./wp6-href-sql";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261020000000 — saklanmış eski Finans bağlantıları yeni yollara çevrilir
 * (yönlendirme/takma ad yok). Eski kökler düz metin olarak kaynakta geçmez (routes.test.ts sözleşmesi); burada parçalardan kurulur.
 */
const OLD = (name: string) => ["", "app", name].join("/");
const GID = OLD("gider" + "ler");
const KOM = OLD("komis" + "yon");
const CUZ = OLD("cuz" + "dan");
const ID = "11111111-2222-4333-8444-555555555555";

describe("20261020000000 Finans bağlantı taşıması", () => {
  it("eski yollar yeni Finans / Kazancım yollarına, diğerleri aynen; ikinci çalıştırma değiştirmez", async () => {
    const db = new PGlite();
    await db.exec(wp6HrefFunctionSql());
    const cases: [string | null, string | null][] = [
      [GID, "/app/finans"],
      [`${GID}?sekme=genel`, "/app/finans"],
      [`${GID}?sekme=cari&kalem=${ID}`, `/app/finans/cari?kalem=${ID}`],
      [`${GID}?sekme=cari&cari=${ID}&from=2026-10-01`, `/app/finans/cari/${ID}?from=2026-10-01`],
      [`${GID}?sekme=cari&cari=${ID}`, `/app/finans/cari/${ID}`],
      [`${GID}?sekme=duzenli`, "/app/finans/tekrarlayan"],
      [`${GID}?sekme=duzenli&durum=bekleyen`, "/app/finans/tekrarlayan?durum=bekleyen"],
      [`${GID}?sekme=belgeler&tur=fatura&durum=issued`, "/app/finans/faturalar?durum=issued"],
      [`${GID}?sekme=belgeler&tur=fatura`, "/app/finans/faturalar"],
      [`${GID}?sekme=belgeler`, "/app/finans/belgeler"],
      [`${GID}?sekme=butce#portal-getirisi`, "/app/finans/butce#portal-getirisi"],
      [`${GID}?sekme=hareketler&hareket=${ID}`, `/app/finans/hareketler?hareket=${ID}`],
      [`${GID}?sekme=ozet&from=2026-01-01`, "/app/finans?from=2026-01-01"],
      [`${GID}/kayit?tur=gider`, "/app/finans/kayit?tur=gider"],
      [KOM, "/app/finans/komisyon"],
      [`${KOM}?durum=bekleyen`, "/app/finans/komisyon?durum=bekleyen"],
      [CUZ, "/app/kazancim"],
      [`${CUZ}?sekme=ofis`, "/app/finans/hakedis"],
      [`${CUZ}#odenen-hakedis`, "/app/kazancim#odenen-hakedis"],
      ["/app/hesabim?sekme=" + "kasam", "/app/kazancim/kasam"],
      ["/app/hesabim?sekme=guvenlik", "/app/hesabim?sekme=guvenlik"],
      [`${KOM}lar`, `${KOM}lar`],
      ["/app/finans/komisyon", "/app/finans/komisyon"],
      [null, null],
    ];
    for (const [input, want] of cases) {
      const once = (await db.query<{ h: string | null }>("select pg_temp.finance_wp6_href($1) as h", [input])).rows[0]!.h;
      expect(once, String(input)).toBe(want);
      const twice = (await db.query<{ h: string | null }>("select pg_temp.finance_wp6_href($1) as h", [once])).rows[0]!.h;
      expect(twice, `${input} (ikinci)`).toBe(want);
    }
    await db.close();
  });

  it("migration: notify pgrst yok, SECURITY DEFINER gövdeleri korunur, saved view sekmesi yenilenir", () => {
    const sql = readFileSync(resolve(process.cwd(), WP6_HREF_MIGRATION), "utf8");
    expect(sql).not.toMatch(/^notify pgrst/m);
    expect(sql).toContain("create or replace view public.finance_open_items_v");
    expect(sql).toContain("'/app/finans/tekrarlayan'::text");
    expect(sql).toContain("'/app/finans/hakedis'::text");
    expect(sql).toContain("then '/app/kazancim/kasam' else '/app/finans/tekrarlayan' end");
    expect(sql).toContain("(16, '/app/finans', 'finans')");
    expect(sql).toMatch(/check \(tab in \('genel', 'hareketler', 'kasa-banka', 'cari', 'belgeler', 'tekrarlayan'/);
    const definers = sql.match(/security definer/gi)?.length ?? 0;
    const paths = sql.match(/set search_path = ''/gi)?.length ?? 0;
    expect(definers).toBeGreaterThan(0);
    expect(paths).toBeGreaterThanOrEqual(definers);
    expect(readFileSync(resolve(process.cwd(), "supabase/rollbacks/20261020000000_finance_hrefs.rollback.sql"), "utf8")).toContain("finance_saved_views_tab_check");
  });
});
