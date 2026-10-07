import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261007000720 imza hatırlatması — yalnız sözleşmenin ofisindeki contracts:edit yetkilisi,
 * tam token DÖNMEZ (kısa kod), 10 dk fren, kısa kod → token çözümü yalnız bekleyen imzacı + gönderilmiş sözleşme +
 * public-aktif ofis; rollback.
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
create type public.contract_status as enum ('draft', 'sent', 'signed', 'rejected', 'cancelled');
create type public.signer_status as enum ('pending', 'signed', 'rejected');
create table public.tenants(id uuid primary key default gen_random_uuid(), status text not null default 'active');
create table public.contracts(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, title text not null,
  status public.contract_status not null default 'draft', expires_at timestamptz);
create table public.contract_signers(id uuid primary key default gen_random_uuid(), contract_id uuid not null, full_name text not null,
  phone text, token text not null unique, status public.signer_status not null default 'pending');
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text,
  entity_id uuid, new_value jsonb);
`;

describe.skipIf(!mod)("imza hatırlatma RPC'leri (pglite)", () => {
  let db: Db;
  let T: string, T2: string, C: string, CDRAFT: string, S: string, S2: string;
  const U = "00000000-0000-4000-8000-000000000001";
  const TOKEN = "c".repeat(48);
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = (tenant: string, perms: string) =>
    db.exec(`select set_config('request.jwt.claim.sub','${U}',false), set_config('test.tenant','${tenant}',false), set_config('test.perms','${perms}',false)`);
  const payload = async (c: string, s: string) =>
    (await q(`select public.contract_signer_reminder_payload($1::uuid, $2::uuid) as r`, [c, s]))[0]!.r as Record<string, unknown>;
  const resolveCode = async (code: string) => (await q(`select public.contract_signer_resolve_short($1) as t`, [code]))[0]!.t as string | null;

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20261007000720_contract_signer_reminder.sql"));
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    C = (await q(`insert into public.contracts(tenant_id, title, status) values ($1, 'Kira Sözleşmesi', 'sent') returning id`, [T]))[0]!.id as string;
    CDRAFT = (await q(`insert into public.contracts(tenant_id, title) values ($1, 'Taslak') returning id`, [T]))[0]!.id as string;
    S = (await q(`insert into public.contract_signers(contract_id, full_name, phone, token) values ($1, 'Ali Veli', '05321234567', $2) returning id`, [C, TOKEN]))[0]!.id as string;
    S2 = (await q(`insert into public.contract_signers(contract_id, full_name, phone, token) values ($1, 'Taslak Kişi', '05321234568', $2) returning id`, [CDRAFT, "d".repeat(48)]))[0]!.id as string;
  });

  it("yetki: oturum, ofis ve contracts:edit şart; başka ofis = bulunamadı", async () => {
    await db.exec(`select set_config('request.jwt.claim.sub','',false)`);
    expect((await payload(C, S)).code).toBe("unauthorized");
    await as(T, "contracts:view");
    expect((await payload(C, S)).code).toBe("forbidden");
    await as(T2, "contracts:edit");
    expect((await payload(C, S)).code).toBe("not_found");
    await as(T, "contracts:edit");
    expect((await payload(CDRAFT, S2)).code).toBe("invalid_state");
  });

  it("kısa kod üretir, tam token döndürmez; 10 dk içinde ikinci istek frenlenir; denetim kaydı yazılır", async () => {
    await as(T, "contracts:edit");
    const r = await payload(C, S);
    expect(r).toMatchObject({ ok: true, full_name: "Ali Veli", phone: "05321234567", contract_title: "Kira Sözleşmesi" });
    expect(String(r.short_code)).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect((await payload(C, S)).code).toBe("throttled");
    expect((await q(`select action from public.audit_logs`))[0]!.action).toBe("contract.signer_remind");
    expect(await resolveCode(String(r.short_code))).toBe(TOKEN);
  });

  it("çözüm: biçimsiz kod, imzalanmış imzacı ve askıdaki ofis için null", async () => {
    const code = (await q(`select short_code from public.contract_signers where id = $1`, [S]))[0]!.short_code as string;
    expect(await resolveCode("xyz")).toBeNull();
    await q(`update public.tenants set status = 'suspended' where id = $1`, [T]);
    expect(await resolveCode(code)).toBeNull();
    await q(`update public.tenants set status = 'active' where id = $1`, [T]);
    await q(`update public.contract_signers set status = 'signed' where id = $1`, [S]);
    expect(await resolveCode(code)).toBeNull();
  });

  it("rollback RPC ve sütunları düşürür", async () => {
    await db.exec(read("supabase/rollbacks/20261007000720_contract_signer_reminder.rollback.sql"));
    const cols = await q(`select 1 from information_schema.columns where table_name = 'contract_signers' and column_name = 'short_code'`);
    expect(cols).toHaveLength(0);
    await expect(resolveCode("0123456789abcdef")).rejects.toThrow();
  });
});
