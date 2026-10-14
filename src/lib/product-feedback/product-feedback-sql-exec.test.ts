import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261014008000_feature_flag_rules_product_feedback — ofis başına tek oy + oy sayacı,
 * NPS gösterim sıklık sınırı (platform_nps_mark_shown), hedefleme kuralı CHECK'leri, istemci rollerine erişim yok ve
 * geri alma.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
const MIGRATION = "supabase/migrations/20261014008000_feature_flag_rules_product_feedback.sql";
const ROLLBACK = "supabase/rollbacks/20261014008000_feature_flag_rules_product_feedback.rollback.sql";

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create table auth.users(id uuid primary key);
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.platform_staff(id uuid primary key default gen_random_uuid());
grant usage on schema public, auth to authenticated, service_role;
`;

describe.skipIf(!mod)("bayrak hedefleme + NPS + öneri panosu migration (pglite)", () => {
  let db: Db;
  let T1: string, T2: string, R: string, S1: string, S2: string;
  const U1 = "11111111-1111-4111-8111-111111111111";
  const U2 = "22222222-2222-4222-8222-222222222222";
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T1 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    await q(`insert into auth.users values ($1), ($2)`, [U1, U2]);
    await db.exec(read(MIGRATION));
    R = (await q(`insert into public.product_feature_requests(tenant_id, created_by, title, status) values ($1, $2, 'Toplu SMS şablonu', 'degerlendiriliyor') returning id`, [T1, U1]))[0]!.id as string;
    S1 = (await q(`insert into public.platform_nps_surveys(question) values ('Bizi tavsiye eder misiniz?') returning id`))[0]!.id as string;
    S2 = (await q(`insert into public.platform_nps_surveys(question) values ('İkinci anket sorusu burada') returning id`))[0]!.id as string;
  });

  const votes = async () => (await q(`select vote_count from public.product_feature_requests where id = $1`, [R]))[0]!.vote_count as number;

  it("özellik isteği oyları ofis başına tek oy: aynı ofisin ikinci oyu yazılamaz, sayaç 1 kalır", async () => {
    await q(`insert into public.product_feature_request_votes(request_id, tenant_id, user_id) values ($1, $2, $3)`, [R, T1, U1]);
    // Aynı ofisten BAŞKA kullanıcı da ikinci oy veremez.
    await expect(q(`insert into public.product_feature_request_votes(request_id, tenant_id, user_id) values ($1, $2, $3)`, [R, T1, U2])).rejects.toThrow();
    // Uygulamanın yazım biçimi (upsert ignoreDuplicates) sessizce yok sayar.
    await q(`insert into public.product_feature_request_votes(request_id, tenant_id, user_id) values ($1, $2, $3) on conflict (request_id, tenant_id) do nothing`, [R, T1, U2]);
    expect(await votes()).toBe(1);
    await q(`insert into public.product_feature_request_votes(request_id, tenant_id, user_id) values ($1, $2, $3)`, [R, T2, U2]);
    expect(await votes()).toBe(2);
  });

  it("oy geri alınınca sayaç düşer, sıfırın altına inmez; öneri silinince oylar da silinir", async () => {
    await q(`delete from public.product_feature_request_votes where request_id = $1 and tenant_id = $2`, [R, T2]);
    expect(await votes()).toBe(1);
    await q(`update public.product_feature_requests set vote_count = 0 where id = $1`, [R]);
    await q(`delete from public.product_feature_request_votes where request_id = $1 and tenant_id = $2`, [R, T1]);
    expect(await votes()).toBe(0);
    const tmp = (await q(`insert into public.product_feature_requests(tenant_id, title) values ($1, 'Geçici öneri') returning id`, [T2]))[0]!.id as string;
    await q(`insert into public.product_feature_request_votes(request_id, tenant_id) values ($1, $2)`, [tmp, T1]);
    await q(`delete from public.product_feature_requests where id = $1`, [tmp]);
    expect((await q(`select count(*)::int as n from public.product_feature_request_votes where request_id = $1`, [tmp]))[0]!.n).toBe(0);
  });

  it("geçersiz durum ve kısa başlık reddedilir", async () => {
    await expect(q(`insert into public.product_feature_requests(tenant_id, title, status) values ($1, 'Geçerli başlık', 'acik')`, [T1])).rejects.toThrow();
    await expect(q(`insert into public.product_feature_requests(tenant_id, title) values ($1, 'kısa')`, [T1])).rejects.toThrow();
  });

  it("NPS: sıklık sınırı içinde ikinci gösterim yazılmaz (başka anket olsa da); aralık dolunca yazılır", async () => {
    const first = (await q(`select public.platform_nps_mark_shown($1, $2, $3, 90) as id`, [S1, T1, U1]))[0]!.id;
    expect(first).toBeTruthy();
    expect((await q(`select public.platform_nps_mark_shown($1, $2, $3, 90) as id`, [S1, T1, U1]))[0]!.id).toBeNull();
    expect((await q(`select public.platform_nps_mark_shown($1, $2, $3, 90) as id`, [S2, T1, U1]))[0]!.id).toBeNull();
    // Başka kullanıcı etkilenmez.
    expect((await q(`select public.platform_nps_mark_shown($1, $2, $3, 90) as id`, [S1, T2, U2]))[0]!.id).toBeTruthy();
    // 91 gün önce gösterilmiş say: ikinci anket artık sorulabilir; aynı anket ikinci kez sorulmaz (benzersiz).
    await q(`update public.platform_nps_responses set shown_at = now() - interval '91 days' where user_id = $1`, [U1]);
    expect((await q(`select public.platform_nps_mark_shown($1, $2, $3, 90) as id`, [S1, T1, U1]))[0]!.id).toBeNull();
    expect((await q(`select public.platform_nps_mark_shown($1, $2, $3, 90) as id`, [S2, T1, U1]))[0]!.id).toBeTruthy();
    await expect(q(`select public.platform_nps_mark_shown($1, $2, $3, 0)`, [S1, T1, U1])).rejects.toThrow();
  });

  it("NPS yanıtı: puan 0-10, yorum yalnız puanla", async () => {
    const id = (await q(`select id from public.platform_nps_responses where survey_id = $1 and user_id = $2`, [S1, U2]))[0]!.id as string;
    await expect(q(`update public.platform_nps_responses set score = 11, responded_at = now() where id = $1`, [id])).rejects.toThrow();
    await expect(q(`update public.platform_nps_responses set comment = 'yorum' where id = $1`, [id])).rejects.toThrow();
    await q(`update public.platform_nps_responses set score = 9, comment = 'Harika', responded_at = now() where id = $1`, [id]);
  });

  it("hedefleme kuralı: boş hedef, bilinmeyen plan, %101 ve ters pencere reddedilir", async () => {
    await expect(q(`insert into public.feature_flag_rules(flag_key) values ('nps_survey')`)).rejects.toThrow();
    await expect(q(`insert into public.feature_flag_rules(flag_key, plans, percentage) values ('nps_survey', array['gold'], 10)`)).rejects.toThrow();
    await expect(q(`insert into public.feature_flag_rules(flag_key, percentage) values ('nps_survey', 101)`)).rejects.toThrow();
    await expect(
      q(`insert into public.feature_flag_rules(flag_key, percentage, starts_at, ends_at) values ('nps_survey', 10, now(), now() - interval '1 day')`),
    ).rejects.toThrow();
    await q(`insert into public.feature_flag_rules(flag_key, tenant_ids, plans, percentage) values ('feature_board', array[$1]::uuid[], array['office'], 10)`, [T1]);
  });

  it("istemci rolleri tablolara ve gösterim RPC'sine erişemez", async () => {
    await db.exec("set role authenticated");
    try {
      for (const t of ["feature_flag_rules", "platform_nps_surveys", "platform_nps_responses", "product_feature_requests", "product_feature_request_votes"]) {
        await expect(q(`select 1 from public.${t} limit 1`)).rejects.toThrow();
      }
      await expect(q(`select public.platform_nps_mark_shown($1, $2, $3, 90)`, [S1, T1, U1])).rejects.toThrow();
    } finally {
      await db.exec("reset role");
    }
  });

  it("geri alma tüm nesneleri siler ve yeniden uygulanabilir", async () => {
    await db.exec(read(ROLLBACK));
    const left = await q(
      `select count(*)::int as n from pg_class where relname in ('feature_flag_rules','platform_nps_surveys','platform_nps_responses','product_feature_requests','product_feature_request_votes')`,
    );
    expect(left[0]!.n).toBe(0);
    await db.exec(read(MIGRATION));
  });
});
