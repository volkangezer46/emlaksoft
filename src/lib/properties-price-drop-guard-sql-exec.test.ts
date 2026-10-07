import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): 20261007000800 — properties fiyat düşürme DB kapısı + property_price_history salt-okunur.
 * Gerçek migration dosyaları (approval_requests guard'ı, price_history tablo/tetikleyicisi, PB53 kapısı) küçük bir
 * Supabase taklidi (roller, auth.*, JWT GUC'leri) üzerinde koşar; çağrılar `set role authenticated` ile RLS'li yapılır.
 * Senaryolar: danışman doğrudan düşüremez, onaylı akış geçer (tüketilmemiş ve uygulama yolundaki "önce tüket"),
 * owner/gm geçer, başka ofis görünmez, fiyat izi silinemez/değiştirilemez, service_role etkilenmez, rollback.
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
create table public.tenants(id uuid primary key default gen_random_uuid());
create table public.profiles(id uuid primary key default gen_random_uuid(), tenant_id uuid, role text);
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
  title text, list_price numeric, min_price numeric, hidden_price numeric, deleted_at timestamptz, created_at timestamptz not null default now());
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
`;

describe.skipIf(!mod)("properties fiyat düşürme DB kapısı + price_history salt-okunur (pglite)", () => {
  let db: Db;
  let T1: string, T2: string, OWNER: string, GM: string, ADV: string, ADV2: string, MGR: string, OUT: string;
  let P: string, P2: string, PX: string, PF: string;

  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  /** Superuser + service_role kimliği (kurulum): tetikleyici ve RLS dışı. */
  const admin = async () =>
    db.exec(`reset role; select set_config('request.jwt.claim.role','service_role',false), set_config('request.jwt.claim.sub','',false)`);
  /** RLS'li kullanıcı oturumu (PostgREST'in authenticated rolü). */
  const as = async (uid: string, tenant: string, role: string, perms = "properties:edit") => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${uid}',false), set_config('request.jwt.claim.role','authenticated',false),
      set_config('test.tenant','${tenant}',false), set_config('test.role','${role}',false), set_config('test.perms','${perms}',false)`);
    await db.exec(`set role authenticated`);
  };
  const setPrice = async (id: string, price: number) =>
    q(`update public.properties set list_price = $2 where id = $1 returning id`, [id, price]);
  const price = async (id: string) => {
    await admin();
    return Number((await q(`select list_price from public.properties where id = $1`, [id]))[0]!.list_price);
  };
  const resetPrice = async (id: string, v = 1_000_000) => {
    await admin();
    await q(`update public.properties set list_price = $2 where id = $1`, [id, v]);
  };
  const approval = async (o: { by: string; prop: string; value: number; status?: string; ageHours?: number; consumed?: boolean }) => {
    await admin();
    return (
      await q(
        `insert into public.approval_requests(tenant_id, description, requested_value, current_value, requested_by, status, decided_at, decided_by, consumed_at)
         values ($1, '[oversight:price_drop:' || $2::text || '] test', $3, 1000000, $4, $5,
                 case when $5 = 'onaylandi' then now() - ($6 || ' hours')::interval end,
                 case when $5 = 'onaylandi' then $7::uuid end,
                 case when $8::boolean then now() end) returning id`,
        [T1, o.prop, o.value, o.by, o.status ?? "onaylandi", String(o.ageHours ?? 0), OWNER, o.consumed ?? false],
      )
    )[0]!.id as string;
  };

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await db.exec(read("supabase/migrations/20260725000049_property_price_history.sql"));
    await db.exec(read("supabase/migrations/20260823000100_sec3_approval_requests_rls.sql"));
    await db.exec(read("supabase/migrations/20261007000800_properties_price_drop_db_guard.sql"));
    await db.exec(`grant select on public.property_price_history to authenticated`);
    await admin();
    T1 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    T2 = (await q(`insert into public.tenants default values returning id`))[0]!.id as string;
    const prof = async (t: string, role: string) =>
      (await q(`insert into public.profiles(tenant_id, role) values ($1,$2) returning id`, [t, role]))[0]!.id as string;
    OWNER = await prof(T1, "owner");
    GM = await prof(T1, "gm");
    ADV = await prof(T1, "advisor");
    ADV2 = await prof(T1, "advisor");
    MGR = await prof(T1, "branch_manager");
    OUT = await prof(T2, "advisor");
    const mk = async (t: string, p: number) =>
      (await q(`insert into public.properties(tenant_id, title, list_price) values ($1,'Daire',$2) returning id`, [t, p]))[0]!.id as string;
    P = await mk(T1, 1_000_000);
    P2 = await mk(T1, 1_000_000);
    PX = await mk(T2, 1_000_000); // kuralı hiç olmayan ofis
    PF = await mk(T1, 1_000_000);
    await q(`insert into public.oversight_settings(tenant_id, approval_rules) values ($1, $2::jsonb)`, [
      T1,
      JSON.stringify({ price_drop: { enabled: true, threshold: 10 } }),
    ]);
  });

  it("kural kapalı/yoksa danışman fiyat düşürebilir (davranış değişmez)", async () => {
    await as(OUT, T2, "advisor");
    expect(await setPrice(PX, 400_000)).toHaveLength(1);
    // Kural kayıtlı ama kapalı
    await admin();
    await q(`update public.oversight_settings set approval_rules = $2::jsonb where tenant_id = $1`, [T1, JSON.stringify({ price_drop: { enabled: false, threshold: 10 } })]);
    await as(ADV, T1, "advisor");
    expect(await setPrice(P, 500_000)).toHaveLength(1);
    await admin();
    await q(`update public.oversight_settings set approval_rules = $2::jsonb where tenant_id = $1`, [T1, JSON.stringify({ price_drop: { enabled: true, threshold: 10 } })]);
    await resetPrice(P);
  });

  it("danışman doğrudan eşik üstü düşüremez (42501); eşik altı, artış ve aynı fiyat geçer", async () => {
    await as(ADV, T1, "advisor");
    await expect(setPrice(P, 800_000)).rejects.toThrow(/yonetici onayi/);
    expect(await price(P)).toBe(1_000_000);
    await as(ADV, T1, "advisor");
    expect(await setPrice(P, 950_000)).toHaveLength(1); // %5 < eşik %10
    expect(await setPrice(P, 1_200_000)).toHaveLength(1); // artış
    expect(await setPrice(P, 1_200_000)).toHaveLength(1); // aynı fiyat (updateProperty her kayıtta list_price yazar)
    await resetPrice(P);
  });

  it("eşik sınırı: tam eşikteki düşüş onay ister (uygulamadaki dropPct < eşik ile aynı)", async () => {
    await as(ADV, T1, "advisor");
    await expect(setPrice(P, 900_000)).rejects.toThrow(/yonetici onayi/);
    expect(await setPrice(P, 900_001)).toHaveLength(1);
    await resetPrice(P);
  });

  it("owner ve gm muaf; branch_manager muaf DEĞİL", async () => {
    await as(OWNER, T1, "owner");
    expect(await setPrice(P, 300_000)).toHaveLength(1);
    await resetPrice(P);
    await as(GM, T1, "gm");
    expect(await setPrice(P, 300_000)).toHaveLength(1);
    await resetPrice(P);
    await as(MGR, T1, "branch_manager");
    await expect(setPrice(P, 300_000)).rejects.toThrow(/yonetici onayi/);
  });

  it("onaylı + tüketilmemiş talep: düşüş geçer, onay atomik tüketilir, ikinci/daha derin düşüş geçmez", async () => {
    const id = await approval({ by: ADV, prop: P, value: 700_000 });
    await as(ADV, T1, "advisor");
    expect(await setPrice(P, 700_000)).toHaveLength(1);
    await admin();
    expect((await q(`select consumed_at is not null as c from public.approval_requests where id = $1`, [id]))[0]!.c).toBe(true);
    await as(ADV, T1, "advisor");
    await expect(setPrice(P, 500_000)).rejects.toThrow(/yonetici onayi/); // onaylanandan daha derin
    await resetPrice(P);
  });

  it("onay daha yüksek bir fiyatı kapsar; onaylanandan düşük fiyat reddedilir", async () => {
    await approval({ by: ADV, prop: P, value: 700_000 });
    await as(ADV, T1, "advisor");
    await expect(setPrice(P, 600_000)).rejects.toThrow(/yonetici onayi/);
    expect(await setPrice(P, 750_000)).toHaveLength(1); // 700k onayı 750k düşüşünü kapsar
    await resetPrice(P);
  });

  it("uygulama yolu: onay requestApprovalIfNeeded içinde ÖNCE tüketilir, sonra UPDATE gelir", async () => {
    const id = await approval({ by: ADV, prop: P2, value: 600_000 });
    await as(ADV, T1, "advisor", "properties:edit");
    // approval-store.consume: kullanıcı istemcisiyle tek satırlık koşullu güncelleme
    const consumed = await q(`update public.approval_requests set consumed_at = now() where id = $1 and status = 'onaylandi' and consumed_at is null returning id`, [id]);
    expect(consumed).toHaveLength(1);
    expect(await setPrice(P2, 600_000)).toHaveLength(1);
    await resetPrice(P2);
  });

  it("uygun olmayan onaylar sayılmaz: başka ilan, başka kullanıcı, bekleyen, süresi geçmiş, reddedilmiş", async () => {
    await approval({ by: ADV, prop: P2, value: 500_000 }); // başka ilan için
    await approval({ by: ADV2, prop: P, value: 500_000 }); // başka kullanıcının
    await approval({ by: ADV, prop: P, value: 500_000, status: "bekliyor" });
    await approval({ by: ADV, prop: P, value: 500_000, ageHours: 49 });
    await approval({ by: ADV, prop: P, value: 500_000, status: "reddedildi" });
    await as(ADV, T1, "advisor");
    await expect(setPrice(P, 500_000)).rejects.toThrow(/yonetici onayi/);
    expect(await price(P)).toBe(1_000_000);
  });

  it("onay satırı doğrudan sahtelenemez: danışman status='onaylandi' INSERT/UPDATE yapamaz", async () => {
    await as(ADV, T1, "advisor", "properties:edit");
    await expect(
      q(`insert into public.approval_requests(tenant_id, description, requested_value, requested_by, status)
         values ($1, '[oversight:price_drop:' || $2::text || '] sahte', 100, $3, 'onaylandi')`, [T1, P, ADV]),
    ).rejects.toThrow();
    const pending = await approval({ by: ADV, prop: P, value: 100_000, status: "bekliyor" });
    await as(ADV, T1, "advisor");
    await expect(q(`update public.approval_requests set status = 'onaylandi' where id = $1`, [pending])).rejects.toThrow();
    await expect(setPrice(P, 100_000)).rejects.toThrow(/yonetici onayi/);
  });

  it("service_role / yönetim bağlamı kapıdan etkilenmez", async () => {
    await admin();
    expect(await setPrice(PF, 200_000)).toHaveLength(1);
    expect(await price(PF)).toBe(200_000);
    await resetPrice(PF);
  });

  it("başka ofis kaydı görünmez ve güncellenemez", async () => {
    await as(OUT, T2, "advisor");
    expect(await q(`select id from public.properties where id = $1`, [P])).toHaveLength(0);
    expect(await setPrice(P, 1)).toHaveLength(0);
    await as(ADV, T1, "advisor");
    expect(await q(`select id from public.properties where id = $1`, [PX])).toHaveLength(0);
    expect(await setPrice(PX, 1)).toHaveLength(0);
  });

  it("property_price_history: kayıt tetikleyicisi yazmaya devam eder; authenticated yalnız kendi ofisini OKUR", async () => {
    await as(OWNER, T1, "owner");
    await setPrice(P, 777_000);
    await as(ADV, T1, "advisor");
    const mine = await q(`select new_price, changed_by from public.property_price_history where property_id = $1 order by created_at desc`, [P]);
    expect(mine.length).toBeGreaterThan(0);
    expect(Number(mine[0]!.new_price)).toBe(777_000);
    expect(mine[0]!.changed_by).toBe(OWNER);
    await as(OUT, T2, "advisor");
    expect(await q(`select id from public.property_price_history where tenant_id = $1`, [T1])).toHaveLength(0);
    await resetPrice(P);
  });

  it("property_price_history: authenticated silemez, güncelleyemez, ekleyemez", async () => {
    await as(OWNER, T1, "owner"); // owner bile
    await expect(q(`delete from public.property_price_history where property_id = $1`, [P])).rejects.toThrow(/permission denied/);
    await expect(q(`update public.property_price_history set new_price = 1 where property_id = $1`, [P])).rejects.toThrow(/permission denied/);
    await expect(
      q(`insert into public.property_price_history(property_id, tenant_id, new_price) values ($1,$2,1)`, [P, T1]),
    ).rejects.toThrow(/permission denied/);
    await admin();
    expect((await q(`select count(*)::int as n from public.property_price_history where property_id = $1`, [P]))[0]!.n).toBeGreaterThan(0);
    expect((await q(`select polname from pg_policy where polrelid = 'public.property_price_history'::regclass`)).map((r) => r.polname)).toEqual(["pph_select"]);
  });

  it("rollback: kapı kalkar, eski politikalar geri gelir", async () => {
    await admin();
    await db.exec(read("supabase/rollbacks/20261007000800_properties_price_drop_db_guard.rollback.sql"));
    await as(ADV, T1, "advisor");
    expect(await setPrice(P, 100_000)).toHaveLength(1);
    await admin();
    expect(((await q(`select polname from pg_policy where polrelid = 'public.property_price_history'::regclass order by polname`)).map((r) => r.polname))).toEqual([
      "pph_tenant",
      "pph_tenant_insert",
    ]);
    // ileri tekrar uygulanabilir (idempotent)
    await db.exec(read("supabase/migrations/20261007000800_properties_price_drop_db_guard.sql"));
    await as(ADV, T1, "advisor");
    await resetPrice(P, 1_000_000).catch(() => undefined);
  });
});
