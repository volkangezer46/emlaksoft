import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261013003000 Büyüme Kokpiti tabloları. CHECK listeleri uygulama tipleriyle aynı,
 * anon/authenticated yetkisi yok, budama 180 gün/2 yıl, rollback her şeyi kaldırır. Gerçek RLS DENENMEZ.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const MIG = "supabase/migrations/20261013003000_site_issues.sql";

describe.skipIf(!mod)("site_issues migration (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const ins = (status: string, url: string, lastSeenDaysAgo = 0, resolvedDaysAgo: number | null = null) =>
    q(
      `insert into public.site_issues (area, url, code, severity, title, fingerprint, status, last_seen, resolved_at)
       values ('seo', $1, 'x', 'uyari', 't', 'seo|x|' || $1, $2, now() - make_interval(days => $3), case when $4::int is null then null else now() - make_interval(days => $4::int) end)`,
      [url, status, lastSeenDaysAgo, resolvedDaysAgo],
    );

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec("create role service_role; create role authenticated; create role anon;");
    await db.exec(read(MIG).replace(/notify pgrst[^;]*;/g, ""));
  });

  it("RLS açık, anon/authenticated yetkisi yok, RPC yalnız service_role", async () => {
    const rls = await q(`select relname, relrowsecurity from pg_class where relname in ('site_issues', 'site_optimizer_actions') order by relname`);
    expect(rls.map((r) => r.relrowsecurity)).toEqual([true, true]);
    for (const role of ["anon", "authenticated"]) {
      for (const t of ["site_issues", "site_optimizer_actions"]) {
        expect((await q(`select has_table_privilege($1, 'public.${t}', 'select') as p`, [role]))[0]!.p, `${role} ${t}`).toBe(false);
      }
      expect((await q(`select has_function_privilege($1, 'public.site_issues_prune()', 'execute') as p`, [role]))[0]!.p).toBe(false);
    }
    expect((await q(`select has_function_privilege('service_role', 'public.site_issues_prune()', 'execute') as p`))[0]!.p).toBe(true);
    expect((await q(`select count(*)::int as n from pg_policies where tablename in ('site_issues', 'site_optimizer_actions')`))[0]!.n).toBe(0);
  });

  it("CHECK: alan/önem/durum listeleri, sorgulu URL ve uzunluk sınırları reddedilir; parmak izi tekil", async () => {
    await ins("acik", "/a");
    await expect(ins("acik", "/a")).rejects.toThrow(); // aynı parmak izi
    await expect(ins("kapali", "/b")).rejects.toThrow();
    await expect(q(`insert into public.site_issues (area, url, code, severity, title, fingerprint) values ('sosyal', '/c', 'x', 'uyari', 't', 'f1')`)).rejects.toThrow();
    await expect(q(`insert into public.site_issues (area, url, code, severity, title, fingerprint) values ('seo', '/c?x=1', 'x', 'uyari', 't', 'f2')`)).rejects.toThrow();
    await expect(q(`insert into public.site_issues (area, url, code, severity, title, fingerprint) values ('seo', '/c', 'x', 'orta', 't', 'f3')`)).rejects.toThrow();
    await expect(q(`insert into public.site_issues (area, url, code, severity, title, fingerprint) values ('seo', '/c', 'x', 'uyari', repeat('a', 161), 'f4')`)).rejects.toThrow();
    await expect(q(`insert into public.site_optimizer_actions (kind, source, status) values ('sync', 'robot', 'ok')`)).rejects.toThrow();
    await q(`insert into public.site_optimizer_actions (kind, source, status) values ('sync', 'otopilot', 'ok')`);
  });

  it("budama: doğrulanan/yoksayılan 180 günden eski silinir, açık bulgu ve yeni kayıt kalır; işlem kaydı 2 yıl", async () => {
    await ins("dogrulandi", "/eski", 200, 190);
    await ins("yoksayildi", "/eski-yok", 200, 185);
    await ins("dogrulandi", "/yeni", 10, 5);
    await ins("acik", "/acik-eski", 400);
    await q(`insert into public.site_optimizer_actions (kind, source, status, created_at) values ('sync', 'cron', 'ok', now() - interval '3 years')`);
    const removed = (await q(`select public.site_issues_prune() as n`))[0]!.n;
    expect(removed).toBe(3);
    const urls = (await q(`select url from public.site_issues order by url`)).map((r) => r.url);
    expect(urls).toEqual(["/a", "/acik-eski", "/yeni"]);
    expect((await q(`select count(*)::int as n from public.site_optimizer_actions`))[0]!.n).toBe(1);
  });

  it("migration tekrar çalıştırılabilir; rollback her şeyi kaldırır", async () => {
    await db.exec(read(MIG).replace(/notify pgrst[^;]*;/g, ""));
    await db.exec(read("supabase/rollbacks/20261013003000_site_issues.rollback.sql").replace(/notify pgrst[^;]*;/g, ""));
    const left = await q(`select count(*)::int as n from pg_class where relname in ('site_issues', 'site_optimizer_actions')`);
    expect(left[0]!.n).toBe(0);
    expect((await q(`select count(*)::int as n from pg_proc where proname = 'site_issues_prune'`))[0]!.n).toBe(0);
  });
});
