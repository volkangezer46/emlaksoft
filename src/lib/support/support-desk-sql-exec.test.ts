import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ: Destek masası 2.0 (20261013004800) gerçek PL/pgSQL ile (pglite, bellek içi Postgres).
 * support_tickets/platform_staff/tenants canlı tabloların SADELEŞTİRİLMİŞ taklididir; tetikleyiciler canlıdaki adlarla
 * kurulur ve migration fonksiyon gövdelerini değiştirir. Modül yüklenemezse ATLANIR.
 */
const mod = await loadPglite();
const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261013004800_support_desk_v2.sql"), "utf8");
const rollback = readFileSync(resolve(process.cwd(), "supabase/rollbacks/20261013004800_support_desk_v2.rollback.sql"), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''),'anon') $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.tenants(id uuid primary key default gen_random_uuid(), name text default 'Ofis', plan text not null default 'office');
create table public.profiles(id uuid primary key, tenant_id uuid, is_active boolean default true);
create table public.platform_staff(id uuid primary key default gen_random_uuid(), full_name text default 'P', role text not null default 'support', is_active boolean not null default true);
create table public.platform_settings(key text primary key, value text);
create table public.support_tickets(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  created_by uuid, created_by_staff_id uuid, assigned_to uuid, assigned_staff_id uuid,
  subject text not null default 'Konu', body text not null default 'Gövde', category text not null default 'general',
  priority text not null default 'normal', status text not null default 'open', ticket_no text default 'ES-1',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  first_response_due_at timestamptz, resolution_due_at timestamptz, first_response_at timestamptz,
  first_response_breached_at timestamptz, resolution_breached_at timestamptz, last_activity_at timestamptz,
  last_customer_reply_at timestamptz, last_staff_reply_at timestamptz, resolved_at timestamptz, closed_at timestamptz,
  reopened_at timestamptz, resolution_code text, resolution_summary text, version bigint not null default 1
);
create table public.ticket_macros(id uuid primary key default gen_random_uuid(), title text not null, body text not null, created_by uuid, created_at timestamptz default now());
create table public.support_ticket_messages(id uuid primary key default gen_random_uuid(), ticket_id uuid not null, author_user_id uuid, author_kind text not null, body text not null, visibility text not null default 'public', request_id uuid, created_at timestamptz not null default now());
create table public.support_ticket_events(id uuid primary key default gen_random_uuid(), ticket_id uuid not null, tenant_id uuid not null, message_id uuid, actor_user_id uuid, actor_kind text not null, event_type text not null, visibility text not null, old_value jsonb, new_value jsonb, created_at timestamptz not null default now());
create function public.support_require_service_role() returns void language plpgsql as $$
begin if auth.role() is distinct from 'service_role' then raise exception 'Service role required.' using errcode = '42501'; end if; end $$;
create function public.support_record_event(p_ticket_id uuid, p_tenant_id uuid, p_actor_id uuid, p_actor_kind text, p_event_type text, p_visibility text, p_old_value jsonb default null, p_new_value jsonb default null, p_message_id uuid default null)
returns uuid language plpgsql as $$
declare v uuid; begin
  insert into public.support_ticket_events(ticket_id, tenant_id, message_id, actor_user_id, actor_kind, event_type, visibility, old_value, new_value)
  values (p_ticket_id, p_tenant_id, p_message_id, p_actor_id, p_actor_kind, p_event_type, p_visibility, p_old_value, p_new_value) returning id into v;
  return v; end $$;
create function public.support_set_derived_ticket_fields() returns trigger language plpgsql as $$ begin return new; end $$;
create function public.support_sync_canonical_assignee() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then new.assigned_staff_id := coalesce(new.assigned_staff_id, new.assigned_to); new.assigned_to := new.assigned_staff_id;
  elsif new.assigned_staff_id is distinct from old.assigned_staff_id then new.assigned_to := new.assigned_staff_id; end if;
  return new;
end $$;
create trigger trg_support_set_derived_ticket_fields before insert or update on public.support_tickets for each row execute function public.support_set_derived_ticket_fields();
create trigger trg_support_sync_canonical_assignee before insert or update of assigned_staff_id, assigned_to on public.support_tickets for each row execute function public.support_sync_canonical_assignee();
`;

describe.skipIf(!mod)("Destek masası 2.0 SQL — gerçek PL/pgSQL (pglite)", () => {
  let db: Db;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const one = async (sql: string, params?: unknown[]) => Object.values((await q(sql, params))[0] ?? {})[0];
  const iso = (v: unknown) => new Date(v as string).toISOString();

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(migration);
  });

  it("iş saati: cuma 17:30 + 2 iş saati = pazartesi 10:30 (İstanbul)", async () => {
    // 2026-10-16 cuma 17:30 +03 = 14:30Z
    const due = await one(`select public.support_add_business_minutes('2026-10-16T14:30:00Z', 120)`);
    expect(iso(due)).toBe("2026-10-19T07:30:00.000Z");
  });

  it("tatil günü atlanır (29 Ekim perşembe)", async () => {
    // 2026-10-28 çarşamba 17:00 +03 + 2 saat → 1 saat çarşamba, perşembe tatil, cuma 10:00
    const due = await one(`select public.support_add_business_minutes('2026-10-28T14:00:00Z', 120)`);
    expect(iso(due)).toBe("2026-10-30T07:00:00.000Z");
  });

  it("Pro plan + yüksek öncelik 2 iş saati: yeni biletin first_response_due_at iş saatine göre", async () => {
    await q(`insert into public.support_sla_policies(plan, priority, first_response_minutes, resolution_minutes) values ('professional','high',120,960)`);
    const tenant = await one(`insert into public.tenants(plan) values ('professional') returning id`);
    const row = (await q(
      `insert into public.support_tickets(tenant_id, priority, created_at) values ($1, 'high', '2026-10-16T14:30:00Z') returning first_response_due_at, resolution_due_at`,
      [tenant],
    ))[0];
    expect(iso(row.first_response_due_at)).toBe("2026-10-19T07:30:00.000Z");
    // 960 dk: cuma 30 dk + pzt 540 + salı 390 → salı 15:30 +03
    expect(iso(row.resolution_due_at)).toBe("2026-10-20T12:30:00.000Z");
    // Plana özel satır yoksa '*' varsayılanı (yüksek = 240 dk)
    const office = await one(`insert into public.tenants(plan) values ('office') returning id`);
    const due = await one(`insert into public.support_tickets(tenant_id, priority, created_at) values ($1, 'high', '2026-10-16T14:30:00Z') returning first_response_due_at`, [office]);
    expect(iso(due)).toBe("2026-10-19T09:30:00.000Z");
  });

  it("öncelik değişince hedef iş saatine göre yeniden hesaplanır; aralık fonksiyonu tabloyu okur", async () => {
    const tenant = await one(`insert into public.tenants(plan) values ('office') returning id`);
    const id = await one(`insert into public.support_tickets(tenant_id, priority, created_at) values ($1, 'low', '2026-10-16T14:30:00Z') returning id`, [tenant]);
    const due = await one(`update public.support_tickets set priority = 'urgent' where id = $1 returning first_response_due_at`, [id]);
    expect(iso(due)).toBe("2026-10-19T06:30:00.000Z"); // 30 dk cuma + 30 dk pazartesi → 09:30 +03
    expect(await one(`select extract(epoch from public.support_first_response_interval('normal'))::int`)).toBe(480 * 60);
  });

  it("'billing' kategorisi muhasebe rolüne sıralı dağıtımla atanır; izinli personel atlanır", async () => {
    const tenant = await one(`insert into public.tenants(plan) values ('office') returning id`);
    const b1 = await one(`insert into public.platform_staff(id, role) values ('00000000-0000-4000-8000-000000000001','billing') returning id`);
    const b2 = await one(`insert into public.platform_staff(id, role) values ('00000000-0000-4000-8000-000000000002','billing') returning id`);
    await q(`insert into public.platform_staff(role) values ('support')`);
    const pick = async () => one(`insert into public.support_tickets(tenant_id, category) values ($1, 'billing') returning assigned_staff_id`, [tenant]);
    expect(await pick()).toBe(b1);
    expect(await pick()).toBe(b2);
    expect(await pick()).toBe(b1);
    await q(`insert into public.support_staff_availability(staff_id, is_away) values ($1, true)`, [b2]);
    expect(await pick()).toBe(b1);
    // Genel kategori için kural yok → atanmaz
    expect(await one(`insert into public.support_tickets(tenant_id, category) values ($1, 'general') returning assigned_staff_id`, [tenant])).toBeNull();
    // Otomatik atama olayı kaydedilir
    expect(Number(await one(`select count(*) from public.support_ticket_events where event_type = 'assign' and actor_kind = 'system'`))).toBeGreaterThanOrEqual(4);
    // Ana anahtar kapalıysa atama yok
    await q(`insert into public.platform_settings(key, value) values ('support.auto_assign_enabled','off')`);
    expect(await pick()).toBeNull();
    await q(`delete from public.platform_settings where key = 'support.auto_assign_enabled'`);
  });

  it("etiketler: ekle/çıkar, tekrar yok, en çok 10; service_role şart", async () => {
    const tenant = await one(`insert into public.tenants(plan) values ('office') returning id`);
    const staff = await one(`insert into public.platform_staff(role) values ('support') returning id`);
    const id = await one(`insert into public.support_tickets(tenant_id) values ($1) returning id`, [tenant]);
    await expect(q(`select public.support_update_ticket_tags($1, $2, array['iade'], '{}')`, [id, staff])).rejects.toThrow(/Service role/);
    await q(`set request.jwt.claim.role = 'service_role'`);
    const r1 = (await one(`select public.support_update_ticket_tags($1, $2, array['iade','fatura','iade'], '{}')`, [id, staff])) as { tags: string[] };
    expect(r1.tags).toEqual(["iade", "fatura"]);
    const r2 = (await one(`select public.support_update_ticket_tags($1, $2, '{}', array['iade'])`, [id, staff])) as { tags: string[] };
    expect(r2.tags).toEqual(["fatura"]);
    const many = Array.from({ length: 11 }, (_, i) => `e${i}`);
    await expect(q(`select public.support_update_ticket_tags($1, $2, $3, '{}')`, [id, staff, many])).rejects.toThrow(/Too many tags/);
    await q(`reset request.jwt.claim.role`);
  });

  it("makro kullanım sayacı artar", async () => {
    const macro = await one(`insert into public.ticket_macros(title, body) values ('M','Merhaba {{kullanici.ad}}') returning id`);
    await q(`set request.jwt.claim.role = 'service_role'`);
    expect(await one(`select public.support_macro_used($1)`, [macro])).toBe(1);
    expect(await one(`select public.support_macro_used($1)`, [macro])).toBe(2);
    await q(`reset request.jwt.claim.role`);
  });

  it("yanıt bekleyen bilet: N gün sonra hatırlatma (bir kez), M gün sonra otomatik kapanış", async () => {
    const tenant = await one(`insert into public.tenants(plan) values ('office') returning id`);
    const remind = await one(
      `insert into public.support_tickets(tenant_id, status, last_staff_reply_at) values ($1, 'waiting', now() - interval '4 days') returning id`,
      [tenant],
    );
    const close = await one(
      `insert into public.support_tickets(tenant_id, status, last_staff_reply_at) values ($1, 'waiting', now() - interval '8 days') returning id`,
      [tenant],
    );
    const answered = await one(
      `insert into public.support_tickets(tenant_id, status, last_staff_reply_at, last_customer_reply_at) values ($1, 'waiting', now() - interval '9 days', now() - interval '1 day') returning id`,
      [tenant],
    );
    await q(`set request.jwt.claim.role = 'service_role'`);
    const res = (await one(`select public.process_support_ticket_waiting_automation(3, 7, 100)`)) as {
      reminded: { ticketId: string }[];
      closed: { ticketId: string }[];
    };
    expect(res.closed.map((c) => c.ticketId)).toEqual([close]);
    expect(res.reminded.map((c) => c.ticketId)).toContain(remind);
    expect(res.reminded.map((c) => c.ticketId)).not.toContain(close);
    expect(res.reminded.map((c) => c.ticketId)).not.toContain(answered);
    const closedRow = (await q(`select status, resolution_code, closed_at from public.support_tickets where id = $1`, [close]))[0];
    expect(closedRow.status).toBe("closed");
    expect(closedRow.resolution_code).toBe("auto_closed_no_reply");
    expect(Number(await one(`select count(*) from public.support_ticket_messages where ticket_id = $1 and author_kind = 'system'`, [remind]))).toBe(1);
    const again = (await one(`select public.process_support_ticket_waiting_automation(3, 7, 100)`)) as { reminded: unknown[]; closed: unknown[] };
    expect(again.reminded).toHaveLength(0);
    expect(again.closed).toHaveLength(0);
    await q(`reset request.jwt.claim.role`);
  });

  it("rollback temiz uygulanır ve sabit takvim saatlerine döner", async () => {
    await db.exec(rollback);
    expect(await one(`select to_regclass('public.support_sla_policies')`)).toBeNull();
    expect(await one(`select extract(epoch from public.support_first_response_interval('high'))::int`)).toBe(4 * 3600);
    const tenant = await one(`insert into public.tenants(plan) values ('office') returning id`);
    const due = await one(`insert into public.support_tickets(tenant_id, priority, created_at) values ($1, 'high', '2026-10-16T14:30:00Z') returning first_response_due_at`, [tenant]);
    expect(iso(due)).toBe("2026-10-16T18:30:00.000Z");
  });
});
