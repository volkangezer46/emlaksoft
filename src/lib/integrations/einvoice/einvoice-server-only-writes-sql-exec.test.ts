import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * 20261012001000: sağlayıcı SONUCUNU yazan RPC'ler yalnız service_role'e açık.
 * Açık: commissions.create yetkili kullanıcı einvoice_mark_issued ile sahte "issued" yazabiliyordu.
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

describe.skipIf(!mod)("e-Fatura sağlayıcı sonucu yalnız sunucu (pglite)", () => {
  let db: Db;
  let T: string, T2: string, USER: string;
  const CAN = "commissions:create";
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string, tenant: string, perms: string) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('test.tenant','${tenant}',false),
      set_config('test.perms','${perms}',false)`);
    await db.exec(`set role authenticated`);
  };
  const asService = async () => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false), set_config('test.tenant','',false)`);
    await db.exec(`set role service_role`);
  };
  const attempt = async (sql: string, params?: unknown[]) => {
    try {
      await db.query(sql, params);
      return null;
    } catch (e) {
      return e as { message: string };
    }
  };
  const payload = (key: string) => ({
    provider: "nilvera", mode: "live", source_type: "free", source_label: "Serbest", doc_type: "e-arsiv",
    buyer_name: "Ali Veli", buyer_tax_id: "12345678901",
    lines: [{ description: "Hizmet", quantity: 1, unitPrice: 1000, vatRate: 20 }],
    net_total: 1000, vat_total: 200, gross_total: 1200, issue_date: "2026-10-11", idempotency_key: key,
  });
  const status = async (id: string) => {
    await db.exec(`reset role`);
    return String((await q(`select status from public.einvoices where id = $1`, [id]))[0]!.status);
  };
  const newClaimed = async (key: string) => {
    await as(USER, T, CAN);
    const id = (await q(`select public.einvoice_save_draft(null, $1::jsonb) as r`, [JSON.stringify(payload(key))]))[0]!.r as string;
    await q(`select * from public.einvoice_claim_issue($1)`, [id]);
    return id;
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    USER = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261010000700_einvoice.sql"));
    await db.exec(read("supabase/migrations/20261011000600_einvoice_state_machine.sql"));
    await db.exec(read("supabase/migrations/20261012000100_einvoice_recovery.sql"));
    await db.exec(read("supabase/migrations/20261012001000_einvoice_server_only_writes.sql"));
    await db.exec(`grant all on all tables in schema public to service_role`);
  });

  it("authenticated: sonuç yazan RPC'lerin hiçbiri çağrılamaz (sahte issued yazılamaz)", async () => {
    const id = await newClaimed("free:srv-a:invoice");
    const calls = [
      `select public.einvoice_mark_issued($1, '{"externalId":"fake"}'::jsonb, 'FAKE')`,
      `select public.einvoice_record_progress($1, '{"externalId":"fake"}'::jsonb, null, null, false)`,
      `select public.einvoice_record_status($1, 'issued', 'approved', null, null, null)`,
      `select public.einvoice_mark_cancelled($1, 'x')`,
      `select public.einvoice_recover_issue_mine($1, 'sent', '{"externalId":"fake"}'::jsonb, 'FAKE')`,
      `select public.einvoice_srv_mark_issued('${T}', '${USER}', $1, '{"externalId":"fake"}'::jsonb, 'FAKE')`,
      `select public.einvoice_srv_record_progress('${T}', '${USER}', $1, '{"externalId":"fake"}'::jsonb, null, null, false)`,
      `select public.einvoice_srv_recover_issue('${T}', $1, 'sent', null, null)`,
    ];
    for (const sql of calls) {
      await as(USER, T, CAN);
      expect((await attempt(sql, [id]))?.message, sql).toContain("permission denied");
    }
    expect(await status(id)).toBe("draft");
  });

  it("service_role: eski kullanıcı yolu kapalı, srv yolu çalışır ve ofis dışı satıra dokunmaz", async () => {
    const id = await newClaimed("free:srv-b:invoice");
    await asService();
    expect((await attempt(`select public.einvoice_mark_issued($1, null, null)`, [id]))?.message).toContain("permission denied");
    expect((await q(`select public.einvoice_srv_record_progress($1, $2, $3, '{"externalId":"p"}'::jsonb, 'A1', null, false) as r`, [T2, USER, id]))[0]!.r).toBe(false);
    expect((await q(`select public.einvoice_srv_mark_issued($1, $2, $3, '{"externalId":"p"}'::jsonb, 'A1') as r`, [T2, USER, id]))[0]!.r).toBe(false);
    expect(await status(id)).toBe("draft");
    await asService();
    expect((await q(`select public.einvoice_srv_record_progress($1, $2, $3, '{"externalId":"p"}'::jsonb, 'A1', null, false) as r`, [T, USER, id]))[0]!.r).toBe(true);
    expect((await q(`select public.einvoice_srv_mark_issued($1, $2, $3, '{"externalId":"p"}'::jsonb, 'A1') as r`, [T, USER, id]))[0]!.r).toBe(true);
    expect(await status(id)).toBe("issued");
    await asService();
    expect((await q(`select public.einvoice_srv_record_status($1, $2, $3, 'error', 'failed', null, 'Red', null) as r`, [T, USER, id]))[0]!.r).toBe(true);
    expect(await status(id)).toBe("error");
    expect((await q(`select count(*)::int as n from public.audit_logs where action = 'einvoice.issue' and entity_id = $1`, [id]))[0]!.n).toBe(1);
  });

  it("srv iptal ve kurtarma yalnız doğru ofiste uygulanır; kullanıcı RPC'leri (reopen) authenticated'da kalır", async () => {
    const id = await newClaimed("free:srv-c:invoice");
    await asService();
    await q(`select public.einvoice_srv_mark_issued($1, $2, $3, '{"externalId":"c"}'::jsonb, 'N3')`, [T, USER, id]);
    expect((await q(`select public.einvoice_srv_mark_cancelled($1, $2, $3, 'x') as r`, [T2, USER, id]))[0]!.r).toBe(false);
    expect((await q(`select public.einvoice_srv_mark_cancelled($1, $2, $3, 'x') as r`, [T, USER, id]))[0]!.r).toBe(true);
    expect(await status(id)).toBe("cancelled");

    const stuck = await newClaimed("free:srv-d:invoice");
    await q(`select public.einvoice_mark_issue_sent($1)`, [stuck]).catch(() => null);
    await asService();
    // Kilit dolmadı / işaret yok: kurtarma hiçbir şeyi değiştirmez
    expect((await q(`select public.einvoice_srv_recover_issue($1, $2, 'not_sent', null, null) as r`, [T, stuck]))[0]!.r).toBe(false);
    await as(USER, T, CAN);
    expect((await attempt(`select public.einvoice_reopen($1)`, [stuck]))).toBeNull();
  });
});
