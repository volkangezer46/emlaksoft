import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261007000620 portal_customer_request — token doğrulama, KVKK (yalnız kendi kaydı),
 * taslak teklif + danışman bildirimi, erteleme → görev, kiracı bakım talebi, frenler, rollback. Şema sadeleştirilmiş taklit.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select null::uuid $$;
create function public.has_effective_permission(text, text) returns boolean language sql stable as $$ select false $$;
create table public.tenants(id uuid primary key default gen_random_uuid(), status text not null default 'active');
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid);
create table public.customers(id uuid primary key default gen_random_uuid(), tenant_id uuid, full_name text, assigned_to uuid,
  is_sample boolean not null default false, deleted_at timestamptz);
create table public.customer_portal_tokens(id uuid primary key default gen_random_uuid(), tenant_id uuid, customer_id uuid,
  token text not null unique, expires_at timestamptz not null);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_code text, title text, status text,
  assigned_to uuid, is_sample boolean not null default false, deleted_at timestamptz);
create type public.offer_status as enum ('draft', 'submitted', 'countered', 'accepted', 'rejected', 'withdrawn');
create table public.offers(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid, customer_id uuid, created_by uuid,
  amount numeric(14,2) not null, status public.offer_status not null default 'draft', notes text, created_at timestamptz default now());
create table public.appointments(id uuid primary key default gen_random_uuid(), tenant_id uuid, customer_id uuid, property_id uuid,
  assigned_to uuid, scheduled_at timestamptz, status text);
create table public.tasks(id uuid primary key default gen_random_uuid(), tenant_id uuid, title text not null, notes text, kind text, priority text,
  status text, due_at timestamptz, assigned_to uuid, customer_id uuid, property_id uuid, created_at timestamptz default now());
create table public.rentals(id uuid primary key default gen_random_uuid(), tenant_id uuid, property_id uuid, renter_customer_id uuid,
  status text not null default 'active', created_by uuid);
create table public.maintenance_requests(id uuid primary key default gen_random_uuid(), tenant_id uuid, rental_id uuid, title text not null,
  description text, status text not null default 'open', created_at timestamptz default now());
create table public.notifications(id uuid primary key default gen_random_uuid(), tenant_id uuid, user_id uuid, title text not null, body text,
  href text, kind text not null default 'info', meta jsonb not null default '{}', created_at timestamptz default now());
`;

describe.skipIf(!mod)("müşteri portalı istek RPC'si (pglite)", () => {
  let db: Db;
  const TOKEN = "a".repeat(64);
  const OTHER = "b".repeat(64);
  let T: string, C: string, C2: string, ADV: string, P: string, APPT: string, APPT2: string, RENT: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const call = async (token: string, kind: string, payload: unknown) =>
    (await q(`select public.portal_customer_request($1, $2, $3::jsonb) as r`, [token, kind, JSON.stringify(payload)]))[0]!.r as { ok: boolean; code: string };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    T = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    ADV = (await q(`insert into public.profiles(tenant_id) values ($1) returning id`, [T]))[0]!.id as string;
    C = (await q(`insert into public.customers(tenant_id, full_name, assigned_to) values ($1, 'Ayşe Alıcı', $2) returning id`, [T, ADV]))[0]!.id as string;
    C2 = (await q(`insert into public.customers(tenant_id, full_name) values ($1, 'Başka Kişi') returning id`, [T]))[0]!.id as string;
    await q(`insert into public.customer_portal_tokens(tenant_id, customer_id, token, expires_at) values ($1,$2,$3, now() + interval '1 day'), ($1,$4,$5, now() - interval '1 day')`, [T, C, TOKEN, C2, OTHER]);
    P = (await q(`insert into public.properties(tenant_id, property_code, status, assigned_to) values ($1, 'P-1', 'live', $2) returning id`, [T, ADV]))[0]!.id as string;
    APPT = (await q(`insert into public.appointments(tenant_id, customer_id, property_id, assigned_to, scheduled_at, status) values ($1,$2,$3,$4, now() + interval '2 days', 'pending') returning id`, [T, C, P, ADV]))[0]!.id as string;
    APPT2 = (await q(`insert into public.appointments(tenant_id, customer_id, scheduled_at, status) values ($1,$2, now() + interval '2 days', 'pending') returning id`, [T, C2]))[0]!.id as string;
    RENT = (await q(`insert into public.rentals(tenant_id, property_id, renter_customer_id) values ($1,$2,$3) returning id`, [T, P, C]))[0]!.id as string;
    await db.exec(read("supabase/migrations/20261007000620_customer_portal_requests.sql"));
  });

  it("geçersiz / süresi dolmuş token reddedilir", async () => {
    expect((await call("kisa", "offer", { property_id: P, amount: 100 })).code).toBe("invalid_link");
    expect((await call(OTHER, "cancel", { appointment_id: APPT2 })).code).toBe("invalid_link");
  });

  it("teklif: taslak offers satırı (alıcı notu teklife yazılmaz) + danışmana bildirim", async () => {
    const r = await call(TOKEN, "offer", { property_id: P, amount: 4500000, note: "Peşin ödeyebilirim" });
    expect(r).toMatchObject({ ok: true, code: "ok" });
    const o = (await q(`select status::text, amount::text, notes from public.offers`))[0]!;
    expect(o.status).toBe("draft");
    expect(String(o.notes)).not.toContain("Peşin");
    const n = (await q(`select user_id, body from public.notifications where title = 'Portaldan yeni teklif'`))[0]!;
    expect(n.user_id).toBe(ADV);
    expect(String(n.body)).toContain("Peşin");
    expect((await call(TOKEN, "offer", { property_id: P, amount: 4500000 })).code).toBe("duplicate");
    expect((await call(TOKEN, "offer", { property_id: P, amount: -5 })).code).toBe("invalid_amount");
  });

  it("KVKK: başkasının randevusuna erteleme talebi yazılamaz; kendi randevusu görev üretir, randevu değişmez", async () => {
    expect((await call(TOKEN, "reschedule", { appointment_id: APPT2 })).code).toBe("not_found");
    expect((await call(TOKEN, "reschedule", { appointment_id: APPT, preferred: "Cumartesi öğleden sonra" })).ok).toBe(true);
    const t = (await q(`select title, assigned_to, priority, notes from public.tasks`))[0]!;
    expect(t).toMatchObject({ title: "Randevu erteleme talebi", assigned_to: ADV, priority: "high" });
    expect(String(t.notes)).toContain("Cumartesi");
    expect((await q(`select status from public.appointments where id = $1`, [APPT]))[0]!.status).toBe("pending");
  });

  it("kiracı bakım talebi yalnız kendi aktif kira kaydına; başlık zorunlu", async () => {
    expect((await call(TOKEN, "maintenance", { rental_id: RENT, title: "x" })).code).toBe("invalid_title");
    expect((await call(TOKEN, "maintenance", { rental_id: RENT, title: "Kombi arızalı", description: "Sıcak su yok" })).ok).toBe(true);
    expect((await q(`select count(*)::int n from public.maintenance_requests`))[0]!.n).toBe(1);
  });

  it("günlük tavan 10 istek; rollback RPC ve iz tablosunu düşürür, iş kayıtları kalır", async () => {
    for (let i = 0; i < 10; i++) await q(`insert into public.portal_customer_requests(tenant_id, customer_id, kind, ref_id) values ($1,$2,'offer', gen_random_uuid())`, [T, C]);
    expect((await call(TOKEN, "cancel", { appointment_id: APPT })).code).toBe("rate_limited");
    await db.exec(read("supabase/rollbacks/20261007000620_customer_portal_requests.rollback.sql"));
    expect((await q(`select count(*)::int n from public.offers`))[0]!.n).toBe(1);
    await expect(call(TOKEN, "cancel", { appointment_id: APPT })).rejects.toThrow();
  });
});
