import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261011000600_einvoice_state_machine — durum matrisi, çift talep (5 dk kilit),
 * yetki (commissions.create), ofis izolasyonu, silme kuralı (yalnız taslak + provider_ref boş), doğrudan yazma kapalı, audit.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, old_value jsonb, new_value jsonb, created_at timestamptz default now());
grant usage on schema public to authenticated, service_role;
`;

describe.skipIf(!mod)("einvoices durum makinesi (pglite)", () => {
  let db: Db;
  let T: string, T2: string, USER: string, USER2: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, tenant: string, perms: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${tenant}',false),
      set_config('test.perms','${perms}',false)`);
    await db.exec(`set role authenticated`);
  };
  const CAN = "commissions:create";
  const draftPayload = (key: string) => ({
    provider: "nilvera",
    mode: "live",
    source_type: "free",
    source_label: "Serbest fatura",
    doc_type: "e-arsiv",
    buyer_name: "Ali Veli",
    buyer_tax_id: "12345678901",
    lines: [{ description: "Hizmet", quantity: 1, unitPrice: 1000, vatRate: 20 }],
    net_total: 1000,
    vat_total: 200,
    gross_total: 1200,
    issue_date: "2026-10-11",
    idempotency_key: key,
  });
  const save = async (key: string, id: string | null = null) =>
    (await q(`select public.einvoice_save_draft($1::uuid, $2::jsonb) as r`, [id, JSON.stringify(draftPayload(key))]))[0]!.r as string;
  const status = async (id: string) => String((await q(`select status from public.einvoices where id = $1`, [id]))[0]!.status);
  const attempt = async (sql: string, params?: unknown[]) => {
    try {
      await db.query(sql, params);
      return null;
    } catch (e) {
      return e as { message: string; code?: string };
    }
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    USER = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    USER2 = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T2]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261010000700_einvoice.sql"));
    await db.exec(read("supabase/migrations/20261011000600_einvoice_state_machine.sql"));
    await db.exec(`grant all on all tables in schema public to service_role`);
  });

  it("doğrudan INSERT/UPDATE/DELETE kapalı; yazma yalnız RPC", async () => {
    await as(USER, T, CAN);
    const id = await save("free:direct:invoice");
    expect(await attempt(`update public.einvoices set status = 'issued' where id = $1`, [id])).not.toBeNull();
    expect(await attempt(`delete from public.einvoices where id = $1`, [id])).not.toBeNull();
    expect(await attempt(`insert into public.einvoices(tenant_id) values ($1)`, [T])).not.toBeNull();
    expect((await q(`select count(*)::int as n from public.einvoices where id = $1`, [id]))[0]!.n).toBe(1);
  });

  it("yetki: commissions.create olmadan RPC'ler reddeder", async () => {
    await as(USER, T, CAN);
    const id = await save("free:perm:invoice");
    await as(USER, T, "commissions:view");
    expect((await attempt(`select public.einvoice_claim_issue($1)`, [id]))?.message).toContain("yetkiniz yok");
    expect((await attempt(`select public.einvoice_save_draft(null, $1::jsonb)`, [JSON.stringify(draftPayload("free:x:invoice"))]))?.message).toContain("yetkiniz yok");
    expect((await attempt(`select public.einvoice_delete_draft($1)`, [id]))?.message).toContain("yetkiniz yok");
  });

  it("ofis izolasyonu: başka ofisin faturası talep edilemez/silinemez/yeniden açılamaz", async () => {
    await as(USER, T, CAN);
    const id = await save("free:iso:invoice");
    await as(USER2, T2, CAN);
    expect((await q(`select count(*)::int as n from public.einvoice_claim_issue($1)`, [id]))[0]!.n).toBe(0);
    expect((await q(`select public.einvoice_delete_draft($1) as r`, [id]))[0]!.r).toBe(false);
    expect((await attempt(`select public.einvoice_save_draft($1, $2::jsonb)`, [id, JSON.stringify(draftPayload("free:iso:invoice"))]))?.message).toContain("bulunamadi");
    await db.exec(`reset role`);
    expect(await status(id)).toBe("draft");
  });

  it("çift talep: ikinci claim satır döndürmez; 5 dk sonra yeniden alınabilir; kilitliyken taslak düzenlenemez", async () => {
    await as(USER, T, CAN);
    const id = await save("free:claim:invoice");
    expect((await q(`select count(*)::int as n from public.einvoice_claim_issue($1)`, [id]))[0]!.n).toBe(1);
    expect((await q(`select count(*)::int as n from public.einvoice_claim_issue($1)`, [id]))[0]!.n).toBe(0);
    expect((await attempt(`select public.einvoice_save_draft($1, $2::jsonb)`, [id, JSON.stringify(draftPayload("free:claim:invoice"))]))?.message).toContain("suruyor");
    expect((await q(`select public.einvoice_delete_draft($1) as r`, [id]))[0]!.r).toBe(false);
    await db.exec(`reset role; update public.einvoices set issue_claimed_at = now() - interval '6 minutes' where id = '${id}'`);
    await as(USER, T, CAN);
    expect((await q(`select count(*)::int as n from public.einvoice_claim_issue($1)`, [id]))[0]!.n).toBe(1);
  });

  it("resmileştirme: draft->issued; issued tekrar talep edilemez; issued->draft yasak; içerik değişmez", async () => {
    await as(USER, T, CAN);
    const id = await save("free:issue:invoice");
    await q(`select * from public.einvoice_claim_issue($1)`, [id]);
    expect((await q(`select public.einvoice_record_progress($1, '{"externalId":"x1"}'::jsonb, 'A1', null, false) as r`, [id]))[0]!.r).toBe(true);
    expect((await q(`select public.einvoice_mark_issued($1, '{"externalId":"x1"}'::jsonb, 'A1') as r`, [id]))[0]!.r).toBe(true);
    expect(await status(id)).toBe("issued");
    expect((await q(`select count(*)::int as n from public.einvoice_claim_issue($1)`, [id]))[0]!.n).toBe(0);
    expect((await q(`select public.einvoice_mark_issued($1, null, null) as r`, [id]))[0]!.r).toBe(false);
    expect((await q(`select public.einvoice_delete_draft($1) as r`, [id]))[0]!.r).toBe(false);
    await db.exec(`reset role`);
    expect((await attempt(`update public.einvoices set status = 'draft' where id = $1`, [id]))?.message).toContain("durum gecisi");
    expect((await attempt(`update public.einvoices set gross_total = 1 where id = $1`, [id]))?.message).toContain("icerigi degistirilemez");
    expect((await attempt(`update public.einvoices set status = 'error' where id = $1`, [id])) ).toBeNull();
  });

  it("matris: issued->error|cancelled, error->draft (reopen, yeni external_id), cancelled kalıcı", async () => {
    await as(USER, T, CAN);
    const a = await save("free:matrix-a:invoice");
    await q(`select * from public.einvoice_claim_issue($1)`, [a]);
    await q(`select public.einvoice_mark_issued($1, '{"externalId":"a"}'::jsonb, 'N1')`, [a]);
    expect((await q(`select public.einvoice_record_status($1, 'error', 'failed', null, 'Reddedildi', null) as r`, [a]))[0]!.r).toBe(true);
    expect(await status(a)).toBe("error");
    const before = String((await q(`select external_id from public.einvoices where id = $1`, [a]))[0]!.external_id);
    expect((await q(`select public.einvoice_reopen($1) as r`, [a]))[0]!.r).toBe(true);
    expect(await status(a)).toBe("draft");
    const row = (await q(`select external_id, provider_ref from public.einvoices where id = $1`, [a]))[0]!;
    expect(String(row.external_id)).not.toBe(before);
    expect(row.provider_ref).toEqual({});
    expect((await q(`select public.einvoice_reopen($1) as r`, [a]))[0]!.r).toBe(false);

    const b = await save("free:matrix-b:invoice");
    await q(`select * from public.einvoice_claim_issue($1)`, [b]);
    await q(`select public.einvoice_mark_issued($1, '{"externalId":"b"}'::jsonb, 'N2')`, [b]);
    expect((await q(`select public.einvoice_mark_cancelled($1, 'Hatalı tutar') as r`, [b]))[0]!.r).toBe(true);
    expect(await status(b)).toBe("cancelled");
    expect((await q(`select public.einvoice_reopen($1) as r`, [b]))[0]!.r).toBe(false);
    await db.exec(`reset role`);
    expect((await attempt(`update public.einvoices set status = 'draft' where id = $1`, [b]))?.message).toContain("degistirilemez");
    // draft -> cancelled yasak
    const c = await (async () => {
      await as(USER, T, CAN);
      return save("free:matrix-c:invoice");
    })();
    await db.exec(`reset role`);
    expect((await attempt(`update public.einvoices set status = 'cancelled' where id = $1`, [c]))?.message).toContain("durum gecisi");
    // error -> issued yasak
    await db.exec(`update public.einvoices set status = 'error' where id = '${c}'`);
    expect((await attempt(`update public.einvoices set status = 'issued' where id = $1`, [c]))?.message).toContain("durum gecisi");
  });

  it("silme: yalnız taslak ve provider_ref boşken", async () => {
    await as(USER, T, CAN);
    const clean = await save("free:del-a:invoice");
    expect((await q(`select public.einvoice_delete_draft($1) as r`, [clean]))[0]!.r).toBe(true);
    const withRef = await save("free:del-b:invoice");
    await q(`select * from public.einvoice_claim_issue($1)`, [withRef]);
    await q(`select public.einvoice_record_progress($1, '{"externalId":"z"}'::jsonb, null, 'hata', true)`, [withRef]);
    expect((await q(`select public.einvoice_delete_draft($1) as r`, [withRef]))[0]!.r).toBe(false);
  });

  it("aynı kaynak+tür ikinci taslak açılamaz (23505) ve audit_logs kaydı düşer", async () => {
    await as(USER, T, CAN);
    await save("commission:dup:invoice");
    const err = await attempt(`select public.einvoice_save_draft(null, $1::jsonb)`, [JSON.stringify(draftPayload("commission:dup:invoice"))]);
    expect(err?.code ?? err?.message).toBeTruthy();
    await db.exec(`reset role`);
    const actions = (await q(`select distinct action from public.audit_logs where entity_type = 'einvoice'`)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["einvoice.draft_create", "einvoice.issue_claim", "einvoice.issue", "einvoice.cancel", "einvoice.reopen", "einvoice.draft_delete"]));
  });

  it("rollback: eski yetkiler ve guard geri gelir", async () => {
    await db.exec(`reset role`);
    await db.exec(read("supabase/rollbacks/20261011000600_einvoice_state_machine.rollback.sql"));
    expect((await q(`select count(*)::int as n from pg_proc where proname like 'einvoice\\_%' and proname in ('einvoice_claim_issue','einvoice_save_draft')`))[0]!.n).toBe(0);
    expect((await q(`select has_table_privilege('authenticated', 'public.einvoices', 'UPDATE') as p`))[0]!.p).toBe(true);
  });
});
