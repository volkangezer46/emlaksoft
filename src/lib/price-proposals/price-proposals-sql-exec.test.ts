import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261012000800 property_price_proposals — danışman öneri RPC'si (yetki, malik portalı şartı,
 * tek bekleyen), malik token kararı (token, KVKK: yalnız kendi mülkü, süre, bayat fiyat), onayda portföy fiyatı + fiyat izi,
 * fiyat düşürme DB kapısıyla uyum (onaylı öneri meşru gerekçe; doğrudan düşürme hâlâ 42501), bildirim/görev, anon çağrısı, rollback.
 * Gerçek migration dosyaları (fiyat izi, onay RLS'i, PB53 fiyat kapısı) küçük Supabase taklidi üzerinde koşar.
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
grant usage on schema auth, public to authenticated, anon, service_role;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true), '') $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function public.current_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.current_active_tenant_id() returns uuid language sql stable as $$ select nullif(current_setting('test.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable as $$ select coalesce(current_setting('test.role', true), '') $$;
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable as $$
  select position(p_module || ':' || p_action in coalesce(current_setting('test.perms', true), '')) > 0 $$;
create table public.tenants(id uuid primary key default gen_random_uuid(), status text not null default 'active');
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, role text, is_active boolean not null default true);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  property_code text, title text, assigned_to uuid, list_price numeric, min_price numeric, hidden_price numeric,
  deleted_at timestamptz, created_at timestamptz not null default now());
alter table public.properties enable row level security;
create policy p_sel on public.properties for select to authenticated using (tenant_id = public.current_tenant_id());
create policy p_upd on public.properties for update to authenticated
  using (tenant_id = public.current_tenant_id()) with check (tenant_id = public.current_tenant_id());
grant select, update on public.properties to authenticated;
create table public.approval_requests(
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  kind text not null default 'fiyat_degisikligi', title text not null default 'x', description text,
  amount numeric(14,2), current_value numeric(14,2), requested_value numeric(14,2), entity_type text, entity_id uuid,
  status text not null default 'bekliyor', requested_by uuid, decided_by uuid, decided_at timestamptz, decision_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
grant all on public.approval_requests to authenticated, service_role;
create table public.oversight_settings(tenant_id uuid primary key references public.tenants(id), approval_rules jsonb not null default '{}'::jsonb);
create table public.owner_portal_tokens(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, property_id uuid not null,
  owner_name text, token text not null unique, expires_at timestamptz not null);
create table public.notifications(id uuid primary key default gen_random_uuid(), tenant_id uuid, user_id uuid, title text not null, body text,
  href text, kind text not null default 'info', meta jsonb not null default '{}', created_at timestamptz default now());
create table public.tasks(id uuid primary key default gen_random_uuid(), tenant_id uuid, title text not null, notes text, kind text, priority text,
  status text, due_at timestamptz, assigned_to uuid, customer_id uuid, property_id uuid, created_at timestamptz default now());
`;

describe.skipIf(!mod)("fiyat revizyonu önerisi + mülk sahibi onayı (pglite)", () => {
  let db: Db;
  let T1: string, T2: string, ADV: string, ADV2: string, OTHER: string, P: string, P2: string, PX: string, PNOPORTAL: string;
  const TOK = "a".repeat(64);
  const TOK2 = "b".repeat(64);
  const TOKX = "c".repeat(64);
  const TOKEXP = "d".repeat(64);
  const PRICE = 1_000_000;

  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const admin = async () =>
    db.exec(`reset role; select set_config('request.jwt.claim.role','service_role',false), set_config('request.jwt.claim.sub','',false)`);
  const as = async (uid: string, tenant: string, perms = "properties:edit properties:view", role = "advisor") => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('request.jwt.claim.role','authenticated',false),
      set_config('test.tenant','${tenant}',false), set_config('test.role','${role}',false), set_config('test.perms','${perms}',false)`);
    await db.exec(`set role authenticated`);
  };
  const asAnon = async () => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false), set_config('request.jwt.claim.role','anon',false)`);
    await db.exec(`set role anon`);
  };
  const create = async (prop: string, price: number, reason = "Son 60 günde 3 gösterim") =>
    (await q(`select public.create_property_price_proposal($1, $2, $3, $4::jsonb) as r`, [prop, price, reason, JSON.stringify({ v: 1, low: 800000, high: 950000 })]))[0]!.r as { ok: boolean; code: string; id?: string };
  const decide = async (token: string, id: string, decision: string, note?: string) =>
    (await q(`select public.decide_property_price_proposal_by_token($1, $2, $3, $4) as r`, [token, id, decision, note ?? null]))[0]!.r as { ok: boolean; code: string };
  const state = async (id: string) => {
    await admin();
    return (await q(`select status, owner_note, decided_at from public.property_price_proposals where id = $1`, [id]))[0]!;
  };
  const price = async (id: string) => {
    await admin();
    return Number((await q(`select list_price from public.properties where id = $1`, [id]))[0]!.list_price);
  };
  const reset = async () => {
    await admin();
    await q(`delete from public.property_price_proposals`);
    await q(`delete from public.notifications`);
    await q(`delete from public.tasks`);
    await q(`update public.properties set list_price = $1 where id in ($2, $3)`, [PRICE, P, P2]);
    await q(`delete from public.property_price_history`);
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20260725000049_property_price_history.sql"));
    await db.exec(read("supabase/migrations/20260823000100_sec3_approval_requests_rls.sql"));
    await db.exec(read("supabase/migrations/20261007000800_properties_price_drop_db_guard.sql"));
    await db.exec(read("supabase/migrations/20261012000800_property_price_proposals.sql"));
    await db.exec(`grant select on public.property_price_history to authenticated`);
    await admin();
    T1 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    const prof = async (t: string, role: string) =>
      (await q(`insert into public.profiles(tenant_id, role) values ($1,$2) returning id`, [t, role]))[0]!.id as string;
    ADV = await prof(T1, "advisor");
    ADV2 = await prof(T1, "advisor");
    OTHER = await prof(T2, "advisor");
    const mk = async (t: string, code: string, adv: string | null) =>
      (await q(`insert into public.properties(tenant_id, property_code, title, assigned_to, list_price) values ($1,$2,'Kadıköy 3+1',$3,$4) returning id`, [t, code, adv, PRICE]))[0]!.id as string;
    P = await mk(T1, "KDK-1", ADV);
    P2 = await mk(T1, "BSK-2", ADV);
    PNOPORTAL = await mk(T1, "SRY-3", ADV);
    PX = await mk(T2, "BYK-9", OTHER);
    const tok = async (t: string, p: string, token: string, interval: string) =>
      q(`insert into public.owner_portal_tokens(tenant_id, property_id, owner_name, token, expires_at) values ($1,$2,'Ayşe Hanım',$3, now() + $4::interval)`, [t, p, token, interval]);
    await tok(T1, P, TOK, "30 days");
    await tok(T1, P2, TOK2, "30 days");
    await tok(T2, PX, TOKX, "30 days");
    await q(`insert into public.owner_portal_tokens(tenant_id, property_id, owner_name, token, expires_at) values ($1,$2,'Eski',$3, now() - interval '1 day')`, [T1, PNOPORTAL, TOKEXP]);
    // Ofis fiyat düşürme onay kuralı AÇIK (%10 esik): doğrudan düşüş danışman için 42501.
    await q(`insert into public.oversight_settings(tenant_id, approval_rules) values ($1, $2::jsonb)`, [T1, JSON.stringify({ price_drop: { enabled: true, threshold: 10 } })]);
  });

  it("danışman: yetkisiz, başka ofis, geçersiz fiyat/gerekçe, portal yok, aynı fiyat reddedilir; tablo doğrudan yazılamaz", async () => {
    await reset();
    await as(ADV, T1, "properties:view");
    expect((await create(P, 900_000)).code).toBe("forbidden");
    await as(ADV, T1);
    expect((await create(PX, 900_000)).code).toBe("not_found");
    expect((await create(P, -5)).code).toBe("invalid_price");
    expect((await create(P, 900_000, "a")).code).toBe("invalid_reason");
    expect((await create(P, PRICE)).code).toBe("same_price");
    expect((await create(PNOPORTAL, 900_000)).code).toBe("no_owner_portal");
    await expect(q(`insert into public.property_price_proposals(tenant_id, property_id, old_price, new_price, reason, status) values ($1,$2,1,2,'abc','approved')`, [T1, P])).rejects.toThrow();
    await expect(q(`update public.property_price_proposals set status = 'approved'`)).rejects.toThrow();
  });

  it("danışman: öneri oluşur, ikinci bekleyen reddedilir; RLS yalnız kendi ofisini gösterir; iptal edilebilir", async () => {
    await reset();
    await as(ADV, T1);
    const r = await create(P, 800_000);
    expect(r).toMatchObject({ ok: true, code: "ok" });
    expect((await create(P, 750_000)).code).toBe("already_pending");
    expect(await q(`select id from public.property_price_proposals`)).toHaveLength(1);
    await as(OTHER, T2);
    expect(await q(`select id from public.property_price_proposals`)).toHaveLength(0);
    await as(ADV, T1);
    expect((await q(`select public.cancel_property_price_proposal($1) as r`, [r.id]))[0]!.r).toMatchObject({ ok: true });
    expect((await state(r.id!)).status).toBe("expired");
    await as(ADV, T1);
    expect((await create(P, 750_000)).ok).toBe(true); // iptalden sonra yeni öneri
  });

  it("malik: onay -> portföy fiyatı ve fiyat izi güncellenir, danışmana bildirim; kural açıkken %20 düşüş geçer, doğrudan düşüş 42501", async () => {
    await reset();
    await as(ADV, T1);
    const r = await create(P, 800_000); // %20 düşüş (> %10 eşik)
    // Doğrudan düşürme hâlâ kapıya takılır.
    await expect(q(`update public.properties set list_price = 800000 where id = $1`, [P])).rejects.toThrow(/onay/i);
    // Malik, oturumlu bir danışman tarayıcısından bile olsa (authenticated rolü) onayı geçer: onaylı öneri meşru gerekçedir.
    await as(ADV2, T1, "");
    const d = await decide(TOK, r.id!, "approved", "Olur, teşekkürler");
    expect(d).toMatchObject({ ok: true, code: "ok" });
    expect(await price(P)).toBe(800_000);
    expect((await state(r.id!)).status).toBe("approved");
    const h = (await q(`select old_price::float8 as old_price, new_price::float8 as new_price, reason from public.property_price_history where property_id = $1 and new_price = 800000`, [P]))[0]!;
    expect(h).toMatchObject({ old_price: 1000000, new_price: 800000 });
    expect(String(h.reason)).toContain("Mülk sahibi onaylı");
    const n = await q(`select user_id, title, kind from public.notifications`);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ user_id: ADV, kind: "success" });
    // Karar tekrar verilemez.
    expect((await decide(TOK, r.id!, "rejected")).code).toBe("already_decided");
    expect(await price(P)).toBe(800_000);
  });

  it("onaylı öneri YALNIZ kendi hedef fiyatını açar: daha derin düşüş ve başka portföy hâlâ kapıya takılır", async () => {
    await reset();
    await as(ADV, T1);
    const r = await create(P, 800_000);
    await decide(TOK, r.id!, "approved");
    await as(ADV, T1);
    await expect(q(`update public.properties set list_price = 500000 where id = $1`, [P])).rejects.toThrow(/onay/i);
    await expect(q(`update public.properties set list_price = 500000 where id = $1`, [P2])).rejects.toThrow(/onay/i);
    // Sonraki işlemde (decided_at != now()) eski onay kapıyı açmaz: 800000 -> 700000 (referans 30 gün zirvesi 1.000.000: %30).
    await expect(q(`update public.properties set list_price = 700000 where id = $1`, [P])).rejects.toThrow(/onay/i);
  });

  it("malik: KVKK - başka mülkün tokenı öneriyi göremez; geçersiz/süresi dolmuş/başka ofis tokenı reddedilir", async () => {
    await reset();
    await as(ADV, T1);
    const r = await create(P, 800_000);
    await asAnon();
    expect((await decide(TOK2, r.id!, "approved")).code).toBe("not_found"); // P2'nin tokenı
    expect((await decide(TOKX, r.id!, "approved")).code).toBe("not_found"); // başka ofis
    expect((await decide(TOKEXP, r.id!, "approved")).code).toBe("invalid_link");
    expect((await decide("kisa", r.id!, "approved")).code).toBe("invalid_link");
    expect((await decide(TOK, r.id!, "hack")).code).toBe("invalid_request");
    expect((await state(r.id!)).status).toBe("pending");
    expect(await price(P)).toBe(PRICE);
    // Anon tabloyu doğrudan okuyamaz.
    await asAnon();
    await expect(q(`select 1 from public.property_price_proposals`)).rejects.toThrow();
  });

  it("malik: anon rolüyle onay çalışır; red -> bildirim + görev; not -> bekleyen kalır, görev açılır; fiyat değişmez", async () => {
    await reset();
    await as(ADV, T1);
    const r = await create(P, 800_000);
    await asAnon();
    expect((await decide(TOK, r.id!, "note")).code).toBe("note_required");
    expect(await decide(TOK, r.id!, "note", "Biraz daha yüksek olsun")).toMatchObject({ ok: true });
    let s = await state(r.id!);
    expect(s).toMatchObject({ status: "pending", owner_note: "Biraz daha yüksek olsun" });
    expect(await q(`select title from public.tasks where assigned_to = $1`, [ADV])).toHaveLength(1);
    await asAnon();
    expect(await decide(TOK, r.id!, "rejected", "Kabul etmiyorum")).toMatchObject({ ok: true });
    s = await state(r.id!);
    expect(s.status).toBe("rejected");
    expect(await price(P)).toBe(PRICE);
    expect(await q(`select id from public.tasks`)).toHaveLength(2);
    expect(await q(`select id from public.notifications`)).toHaveLength(2);
    await asAnon();
    expect(await decide(TOK, r.id!, "approved")).toMatchObject({ ok: false, code: "already_decided" });
  });

  it("süresi dolmuş öneri onaylanamaz (expired yazılır, fiyat değişmez); 14 gün varsayılan; yeni öneri açılabilir", async () => {
    await reset();
    await as(ADV, T1);
    const r = await create(P, 800_000);
    await admin();
    const ttl = (await q(`select extract(day from expires_at - created_at)::int d from public.property_price_proposals where id = $1`, [r.id]))[0]!.d;
    expect(ttl).toBe(14);
    await q(`update public.property_price_proposals set expires_at = now() - interval '1 minute' where id = $1`, [r.id]);
    await asAnon();
    expect(await decide(TOK, r.id!, "approved")).toMatchObject({ ok: false, code: "expired" });
    expect((await state(r.id!)).status).toBe("expired");
    expect(await price(P)).toBe(PRICE);
    await as(ADV, T1);
    expect((await create(P, 850_000)).ok).toBe(true);
  });

  it("bayat öneri: danışman öneriden sonra fiyat değiştiyse onay uygulanmaz (price_changed)", async () => {
    await reset();
    await as(ADV, T1);
    const r = await create(P, 800_000);
    await admin();
    await q(`update public.properties set list_price = 1100000 where id = $1`, [P]);
    await asAnon();
    expect(await decide(TOK, r.id!, "approved")).toMatchObject({ ok: false, code: "price_changed" });
    expect((await state(r.id!)).status).toBe("expired");
    expect(await price(P)).toBe(1_100_000);
  });

  it("rollback: fiyat kapısı eski gövdeye döner, tablo ve RPC'ler düşer", async () => {
    await admin();
    await db.exec(read("supabase/rollbacks/20261012000800_property_price_proposals.rollback.sql"));
    await expect(q(`select 1 from public.property_price_proposals`)).rejects.toThrow();
    expect(await q(`select 1 from pg_proc where proname like '%price_proposal%'`)).toHaveLength(0);
    const body = String((await q(`select prosrc from pg_proc where proname = 'guard_property_list_price_drop'`))[0]!.prosrc);
    expect(body).not.toContain("property_price_proposals");
    expect(body).toContain("approval_requests");
  });
});
