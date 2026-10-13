import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261013005100 legal_help_content — tablolar kurulur, kısıtlar (slug başına tek taslak,
 * slug listesi, onay tekilliği, sabit tarih tekilliği, makale slug biçimi) çalışır, istemci rolleri erişemez, geri alma
 * dosyası temiz siler ve migration tekrar uygulanabilir (idempotent).
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid());
create table public.tenants(id uuid primary key default gen_random_uuid());
`;

describe.skipIf(!mod)("legal_help_content (pglite)", () => {
  let db: Db;
  let U: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const fails = async (sql: string) => {
    try {
      await db.exec(sql);
      return false;
    } catch {
      return true;
    }
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261013005100_legal_help_content.sql"));
    U = (await q(`insert into auth.users default values returning id`))[0]!.id as string;
  });

  it("slug başına tek taslak; bilinmeyen slug reddedilir; yayın tarihsiz yayın olmaz", async () => {
    await db.exec(`insert into public.legal_documents(slug, version, title, body) values ('kullanim-sartlari', 2, 'KŞ', '## 1. A')`);
    expect(await fails(`insert into public.legal_documents(slug, version, title, body) values ('kullanim-sartlari', 3, 'KŞ', 'x')`)).toBe(true);
    expect(await fails(`insert into public.legal_documents(slug, version, title, body) values ('baska', 2, 'x', 'x')`)).toBe(true);
    expect(await fails(`insert into public.legal_documents(slug, version, status, title, body) values ('gizlilik', 2, 'published', 'x', 'x')`)).toBe(true);
    await db.exec(`update public.legal_documents set status = 'published', published_at = now() where slug = 'kullanim-sartlari'`);
    await db.exec(`insert into public.legal_documents(slug, version, title, body) values ('kullanim-sartlari', 3, 'KŞ', 'x')`);
    expect((await q(`select count(*)::int as n from public.legal_documents`))[0]!.n).toBe(2);
  });

  it("yayın RPC'si: tek transaction'da eskiyi arşivler, taslağı yayınlar; slug başına tek yayın; taslak yoksa boş", async () => {
    await db.exec(`insert into public.legal_documents(slug, version, title, body, requires_reconsent) values ('gizlilik', 2, 'G', '## 1. A', true)`);
    const r1 = await q(`select * from public.legal_publish_draft('gizlilik', '${U}')`);
    expect(r1).toEqual([{ out_version: 2, out_requires_reconsent: true }]);
    await db.exec(`insert into public.legal_documents(slug, version, title, body) values ('gizlilik', 3, 'G', '## 1. B')`);
    expect(await q(`select * from public.legal_publish_draft('gizlilik', '${U}')`)).toEqual([{ out_version: 3, out_requires_reconsent: false }]);
    const st = await q(`select version, status, published_by is not null as by from public.legal_documents where slug = 'gizlilik' order by version`);
    expect(st).toEqual([
      { version: 2, status: "archived", by: true },
      { version: 3, status: "published", by: true },
    ]);
    expect(await q(`select * from public.legal_publish_draft('gizlilik', '${U}')`)).toEqual([]);
    expect(await fails(`update public.legal_documents set status = 'published' where slug = 'gizlilik' and version = 2`)).toBe(true);
    const g = await q(`select has_function_privilege('authenticated', 'public.legal_publish_draft(text, uuid)', 'execute') as a, has_function_privilege('service_role', 'public.legal_publish_draft(text, uuid)', 'execute') as s`);
    expect(g[0]).toEqual({ a: false, s: true });
  });

  it("onay: kullanıcı + belge + sürüm tekil", async () => {
    await db.exec(`insert into public.legal_consents(user_id, document, version, ip) values ('${U}', 'kullanim-sartlari', 2, '203.0.113.5')`);
    expect(await fails(`insert into public.legal_consents(user_id, document, version) values ('${U}', 'kullanim-sartlari', 2)`)).toBe(true);
    const r = await q(`select ip, accepted_at is not null as stamped from public.legal_consents`);
    expect(r[0]).toEqual({ ip: "203.0.113.5", stamped: true });
  });

  it("mevzuat sabiti: aynı anahtar + aynı gün tekil; anahtar biçimi denetlenir", async () => {
    await db.exec(`insert into public.legal_constants(key, value, valid_from) values ('vatGeneralPct', 20, '2027-01-01')`);
    expect(await fails(`insert into public.legal_constants(key, value, valid_from) values ('vatGeneralPct', 21, '2027-01-01')`)).toBe(true);
    expect(await fails(`insert into public.legal_constants(key, value, valid_from) values ('drop table;', 1, '2027-01-01')`)).toBe(true);
  });

  it("yardım makalesi ve oy kısıtları", async () => {
    await db.exec(`insert into public.help_articles(slug, kind, title, body, status) values ('yeni-soru', 'faq', 'S', 'Y', 'published')`);
    expect(await fails(`insert into public.help_articles(slug, kind, title) values ('yeni-soru', 'faq', 'S2')`)).toBe(true);
    expect(await fails(`insert into public.help_articles(slug, kind, title) values ('Kötü Slug', 'faq', 'S')`)).toBe(true);
    expect(await fails(`insert into public.help_articles(slug, kind, title, href) values ('dis-link', 'faq', 'S', '//evil.example')`)).toBe(true);
    await db.exec(`insert into public.help_article_votes(kind, slug, user_id, helpful) values ('faq', 'yeni-soru', '${U}', true)`);
    expect(await fails(`insert into public.help_article_votes(kind, slug, user_id, helpful) values ('faq', 'yeni-soru', '${U}', false)`)).toBe(true);
  });

  it("istemci rolleri (anon/authenticated) hiçbir tabloya erişemez", async () => {
    for (const t of ["legal_documents", "legal_consents", "legal_constants", "help_articles", "help_article_votes"]) {
      const r = await q(`select has_table_privilege('authenticated', 'public.${t}', 'select') as a, has_table_privilege('anon', 'public.${t}', 'select') as b, has_table_privilege('service_role', 'public.${t}', 'insert') as s`);
      expect(r[0], t).toEqual({ a: false, b: false, s: true });
    }
  });

  it("geri alma temiz siler; migration yeniden uygulanabilir", async () => {
    await db.exec(read("supabase/rollbacks/20261013005100_legal_help_content.rollback.sql"));
    expect((await q(`select to_regclass('public.legal_documents') is null as gone`))[0]!.gone).toBe(true);
    expect((await q(`select to_regprocedure('public.legal_publish_draft(text, uuid)') is null as gone`))[0]!.gone).toBe(true);
    await db.exec(read("supabase/migrations/20261013005100_legal_help_content.sql"));
    await db.exec(read("supabase/migrations/20261013005100_legal_help_content.sql"));
    expect((await q(`select to_regclass('public.help_articles') is not null as ok`))[0]!.ok).toBe(true);
  });
});
