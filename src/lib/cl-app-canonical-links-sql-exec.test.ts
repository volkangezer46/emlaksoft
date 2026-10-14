import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261014009000 — kaldırılan /app yollarına giden KAYITLI bağlantılar kanonik yola
 * çevrilir (yönlendirme/takma ad yok). Yalnız href düzeltme bloğu çalıştırılır (fonksiyon tanımı auth şeması ister).
 */
const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/20261014009000_cl_app_canonical_links.sql"), "utf8");
const fixBlock = sql.slice(sql.indexOf("create or replace function pg_temp.cl_app_canonical_href"), sql.indexOf("notify pgrst"));

describe("20261014009000 kanonik bağlantı düzeltmesi", () => {
  it("eski yollar kanonik yola, diğerleri aynen kalır; ikinci çalıştırma değiştirmez", async () => {
    const db = new PGlite();
    await db.exec(`
      create table public.notifications (id serial primary key, href text);
      create table public.insights (id serial primary key, href text not null);
    `);
    const cases: [string, string][] = [
      ["/app/ayarlar?sekme=entegrasyon#portal-uyelikleri", "/app/ayarlar/entegrasyonlar#portal-uyelikleri"],
      ["/app/ayarlar?sekme=entegrasyon", "/app/ayarlar/entegrasyonlar#eids"],
      ["/app/ayarlar?sekme=tum", "/app/ayarlar"],
      ["/app/portallar?durum=teyit", "/app/ilan-kontrol/portallar?durum=teyit"],
      ["/app/portallarim", "/app/portallarim"],
      ["/app/kayip-kacak#kapanislar", "/app/ilan-kontrol/kapanis#kapanislar"],
      ["/app/akilli-listeler?segment=churn", "/app/musteriler?segment=risk"],
      ["/app/denetim?risk=yuksek", "/app/ofis-kontrol/kayit?risk=yuksek"],
      ["/app/ayarlar/roller?role=advisor", "/app/ayarlar/yetkilendirme?sekme=roller"],
      ["/app/raporlar/kar-zarar", "/app/giderler?sekme=raporlar"],
      ["/app/raporlar/memnuniyet", "/app/anketler?sekme=sonuc"],
      ["/app/ofis-kontrol/karne", "/app/danisman-kpi"],
      ["/app/giderler?sekme=faturalar&durum=issued", "/app/giderler?sekme=belgeler&tur=fatura&durum=issued"],
      ["/app/giderler?portal=sahibinden#portal-getirisi", "/app/giderler?sekme=butce#portal-getirisi"],
      ["/app/musteriler/1", "/app/musteriler/1"],
    ];
    for (const [href] of cases) {
      await db.query("insert into public.notifications (href) values ($1)", [href]);
      await db.query("insert into public.insights (href) values ($1)", [href]);
    }
    await db.query("insert into public.notifications (href) values (null)");
    await db.exec(fixBlock);
    for (const table of ["notifications", "insights"]) {
      const { rows } = await db.query<{ href: string | null }>(`select href from public.${table} order by id`);
      expect(rows.slice(0, cases.length).map((r) => r.href), table).toEqual(cases.map(([, want]) => want));
    }
    await db.exec(fixBlock);
    const again = await db.query<{ href: string | null }>("select href from public.notifications order by id");
    expect(again.rows.slice(0, cases.length).map((r) => r.href)).toEqual(cases.map(([, want]) => want));
    expect(again.rows.at(-1)?.href).toBeNull();
    await db.close();
  });
});
