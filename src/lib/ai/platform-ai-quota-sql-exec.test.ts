import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ: platform AI kotası (20261013003100) gerçek PL/pgSQL ile (pglite, bellek içi Postgres).
 * Kanıtlanan: eşzamanlı 20 çağrıda limit AŞILMAZ; ay değişince sayaç sıfırlanır; geçersiz girdi false; yetkiler
 * yalnız service_role. Modül yüklenemezse ATLANIR (`describe.skipIf`).
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `create role service_role; create role authenticated; create role anon;`;

describe.skipIf(!mod)("platform_ai_quota_take — gerçek PL/pgSQL (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const take = async (key: string, limit: number) => (await q(`select public.platform_ai_quota_take($1, $2) as ok`, [key, limit]))[0]!.ok as boolean;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261013003100_platform_ai_quota.sql").replace(/notify pgrst[^;]*;/g, ""));
  });

  // SINIR: pglite tek bağlantılıdır; Promise.all çağrıları fiilen SIRALI yürütür. Bu test SQL mantığını (koşullu
  // artırma) kanıtlar, gerçek satır kilidi yarışını DEĞİL; o yalnız gölge DB'de elle 20 eşzamanlı psql ile denendi.
  it("eşzamanlı 20 çağrıda limit (5) aşılmaz", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => take("seo.ai", 5)));
    expect(results.filter(Boolean)).toHaveLength(5);
    const row = (await q(`select used from public.platform_ai_quota where key = 'seo.ai'`))[0]!;
    expect(row.used).toBe(5);
    expect(await take("seo.ai", 5)).toBe(false);
    // Anahtarlar birbirinden bağımsız.
    expect(await take("advisor.ai", 1)).toBe(true);
    expect(await take("advisor.ai", 1)).toBe(false);
  });

  it("ay değişince sayaç sıfırlanır (yeni dönemde ilk çağrı 1 olur)", async () => {
    await q(`update public.platform_ai_quota set period = '2000-01', used = 999 where key = 'seo.ai'`);
    expect(await take("seo.ai", 5)).toBe(true);
    const row = (await q(`select used, period from public.platform_ai_quota where key = 'seo.ai'`))[0]!;
    expect(row.used).toBe(1);
    expect(row.period).not.toBe("2000-01");
  });

  it("geçersiz anahtar ve limit false döner, satır yazılmaz", async () => {
    expect(await take("Kötü Anahtar", 5)).toBe(false);
    expect(await take("seo.ai", 0)).toBe(false);
    expect((await q(`select count(*)::int as n from public.platform_ai_quota where key = 'Kötü Anahtar'`))[0]!.n).toBe(0);
  });

  it("fonksiyon SECURITY DEFINER, search_path boş; yalnız service_role çalıştırır, tabloda RLS açık", async () => {
    const fn = (await q(`select prosecdef, proconfig from pg_proc where proname = 'platform_ai_quota_take'`))[0]!;
    expect(fn.prosecdef).toBe(true);
    expect(String(fn.proconfig)).toContain("search_path");
    const priv = (await q(
      `select has_function_privilege('anon', 'public.platform_ai_quota_take(text, integer)', 'execute') as anon,
              has_function_privilege('authenticated', 'public.platform_ai_quota_take(text, integer)', 'execute') as auth,
              has_function_privilege('service_role', 'public.platform_ai_quota_take(text, integer)', 'execute') as svc`,
    ))[0]!;
    expect(priv).toEqual({ anon: false, auth: false, svc: true });
    const rls = (await q(`select relrowsecurity from pg_class where relname = 'platform_ai_quota'`))[0]!;
    expect(rls.relrowsecurity).toBe(true);
    const tbl = (await q(`select has_table_privilege('authenticated', 'public.platform_ai_quota', 'select') as s`))[0]!;
    expect(tbl.s).toBe(false);
  });
});
