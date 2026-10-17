import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPglite, type Db } from "@/lib/test-support/pglite";

/**
 * İŞLEVSEL SQL TESTİ (pglite): WP2 — 20261023040000_advisor_deals_offers_scope + 20261023040001_expense_claims.
 *  - permission_defaults: danışman/takım lideri/şube müdürü commissions + offers view/create/edit;
 *  - danışman YALNIZ kendisine atanmış anlaşmaya yazar (başkasınınki 0 satır / ret), anlaşmayı devredemez;
 *  - anlaşma alt kaydı (masraf) başka danışmanın anlaşmasına yazılamaz;
 *  - komisyon defteri yalnız owner/gm/muhasebe ya da commissions:delete;
 *  - onay kararı: şube müdürü/takım lideri varsayılan edit ile karar vermez;
 *  - Masraf bildir: tek RPC talep + onay satırı açar, başkası göremez, onayda danışmana ödenecek açık kalem yazılır.
 * Kimlik/izin yardımcıları yalın taslaktır (gerçek gövdeler başka migration'larda; burada yalnız sözleşmeleri).
 */
const mod = await loadPglite();
const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

const T = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER = "10000000-0000-4000-8000-000000000001";
const ADV1 = "10000000-0000-4000-8000-000000000002";
const ADV2 = "10000000-0000-4000-8000-000000000003";
const ACC = "10000000-0000-4000-8000-000000000004";
const TL = "10000000-0000-4000-8000-000000000005";
const BM = "10000000-0000-4000-8000-000000000006";

const STUB = `
create role service_role; create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('t.uid', true), '')::uuid $$;
create table public.tenants(id uuid primary key);
create table public.profiles(id uuid primary key, tenant_id uuid references public.tenants(id), role text not null, full_name text, is_active boolean default true);
create function public.current_active_tenant_id() returns uuid language sql stable security definer as $$ select nullif(current_setting('t.tenant', true), '')::uuid $$;
create function public.current_profile_role() returns text language sql stable security definer as $$ select p.role from public.profiles p where p.id = auth.uid() $$;
create table public.permission_defaults(role text not null, module text not null, action text not null, primary key (role, module, action));
create table public.perm_grants(role text not null, module text not null, action text not null);
create function public.has_effective_permission(p_module text, p_action text) returns boolean language sql stable security definer as $$
  select exists (select 1 from public.permission_defaults d where d.role = public.current_profile_role() and d.module = p_module and d.action = p_action)
      or exists (select 1 from public.perm_grants g where g.role = public.current_profile_role() and g.module = p_module and g.action = p_action) $$;
create function public.scope_allows(p_owner uuid) returns boolean language sql stable as $$ select true $$;
create function public.approval_actor_is_delegate() returns boolean language sql stable as $$ select false $$;
create table public.properties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null);
create table public.deals(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, assigned_to uuid, deal_value numeric);
alter table public.deals enable row level security;
create policy deals_sel on public.deals for select to authenticated using (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('commissions', 'view'));
create policy deals_ins on public.deals for insert to authenticated with check (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('commissions', 'create'));
create policy deals_upd on public.deals for update to authenticated using (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('commissions', 'edit'))
  with check (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('commissions', 'edit'));
create table public.deal_costs(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, deal_id uuid not null references public.deals(id), amount numeric);
alter table public.deal_costs enable row level security;
create policy dc_all on public.deal_costs for all to authenticated using (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('commissions', 'edit'))
  with check (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('commissions', 'edit'));
create table public.commissions(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, deal_id uuid, splits jsonb not null default '[]');
alter table public.commissions enable row level security;
create policy c_sel on public.commissions for select to authenticated using (tenant_id = public.current_active_tenant_id());
create policy c_upd on public.commissions for update to authenticated using (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('commissions', 'edit'))
  with check (tenant_id = public.current_active_tenant_id());
create table public.approval_requests(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, kind text not null, title text not null,
  description text, amount numeric, current_value numeric, requested_value numeric, entity_type text, entity_id uuid,
  status text not null default 'bekliyor', requested_by uuid, decided_by uuid, decided_at timestamptz, decision_note text,
  consumed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.finance_parties(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, kind text not null, name text not null,
  user_id uuid, archived_at timestamptz, created_at timestamptz not null default now());
create function public.finance_accrual_party(p_tenant uuid, p_kind text, p_name text, p_customer uuid, p_user uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  select id into v from public.finance_parties where tenant_id = p_tenant and kind = p_kind and user_id = p_user;
  if v is null then insert into public.finance_parties(tenant_id, kind, name, user_id) values (p_tenant, p_kind, coalesce(p_name, 'Danışman'), p_user) returning id into v; end if;
  return v;
end $$;
create table public.finance_open_items(id uuid primary key default gen_random_uuid(), tenant_id uuid not null, direction text not null, party_id uuid,
  title text not null, category text, amount numeric not null, currency text not null default 'TRY', issue_date date not null, due_date date not null,
  source_type text, source_id uuid, property_id uuid, note text, created_by uuid);
create table public.audit_logs(id uuid primary key default gen_random_uuid(), tenant_id uuid, actor_id uuid, action text, entity_type text, entity_id uuid, new_value jsonb);
grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on public.deals, public.deal_costs, public.commissions to authenticated;
`;

describe.skipIf(!mod)("WP2 danışman anlaşma kapsamı + masraf bildirimi (pglite)", () => {
  let db: Db;
  let D1: string, D2: string, C2: string, C1: string;
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows;
  const as = async (uid: string) => {
    await db.exec("reset role");
    await db.exec(`select set_config('t.uid', '${uid}', false), set_config('t.tenant', '${T}', false)`);
    await db.exec("set role authenticated");
  };
  const admin = () => db.exec("reset role");

  beforeAll(async () => {
    db = new mod!.PGlite();
    await db.exec(STUB);
    await q(`insert into public.tenants values ($1)`, [T]);
    await q(
      `insert into public.profiles(id, tenant_id, role, full_name) values ($1,$7,'owner','Sahip'), ($2,$7,'advisor','Ali Danışman'),
       ($3,$7,'advisor','Ayşe Danışman'), ($4,$7,'accounting','Muhasebe'), ($5,$7,'team_lead','Takım Lideri'), ($6,$7,'branch_manager','Şube Müdürü')`,
      [OWNER, ADV1, ADV2, ACC, TL, BM, T],
    );
    // Eski varsayılanlar: owner/gm/accounting komisyonda tam, diğerleri yalnız görme.
    await db.exec(`insert into public.permission_defaults
      select r, 'commissions', a from unnest(array['owner','gm','accounting']) r, unnest(array['view','create','edit','delete']) a;
      insert into public.permission_defaults select r, 'commissions', 'view' from unnest(array['advisor','team_lead','branch_manager']) r;
      insert into public.permission_defaults values ('owner','expenses','view');`);
    await db.exec(read("supabase/migrations/20261023040000_advisor_deals_offers_scope.sql"));
    await db.exec(read("supabase/migrations/20261023040001_expense_claims.sql"));
    D1 = (await q(`insert into public.deals(tenant_id, assigned_to, deal_value) values ($1, $2, 1000) returning id`, [T, ADV1]))[0]!.id as string;
    D2 = (await q(`insert into public.deals(tenant_id, assigned_to, deal_value) values ($1, $2, 2000) returning id`, [T, ADV2]))[0]!.id as string;
    C1 = (await q(`insert into public.commissions(tenant_id, deal_id) values ($1, $2) returning id`, [T, D1]))[0]!.id as string;
    C2 = (await q(`insert into public.commissions(tenant_id, deal_id) values ($1, $2) returning id`, [T, D2]))[0]!.id as string;
  });

  it("permission_defaults: üç rol commissions + offers view/create/edit taşır, silme yok", async () => {
    const rows = await q(`select role, module, action from public.permission_defaults where role in ('advisor','team_lead','branch_manager') order by 1,2,3`);
    for (const role of ["advisor", "team_lead", "branch_manager"]) {
      for (const m of ["commissions", "offers"]) {
        const acts = rows.filter((r) => r.role === role && r.module === m).map((r) => r.action).sort();
        expect(acts, `${role}/${m}`).toEqual(["create", "edit", "view"]);
      }
    }
  });

  it("danışman kendi anlaşmasını günceller; başka danışmanınkini güncelleyemez (0 satır)", async () => {
    await as(ADV1);
    expect((await q(`update public.deals set deal_value = 1100 where id = $1 returning id`, [D1])).length).toBe(1);
    expect((await q(`update public.deals set deal_value = 9 where id = $1 returning id`, [D2])).length).toBe(0);
    await admin();
    expect(Number((await q(`select deal_value from public.deals where id = $1`, [D2]))[0]!.deal_value)).toBe(2000);
  });

  it("danışman anlaşmayı başkasına devredemez ve başkası adına anlaşma açamaz; kendi adına açar", async () => {
    await as(ADV1);
    await expect(q(`update public.deals set assigned_to = $2 where id = $1`, [D1, ADV2])).rejects.toThrow(/row-level security/i);
    await expect(q(`insert into public.deals(tenant_id, assigned_to) values ($1, $2)`, [T, ADV2])).rejects.toThrow(/row-level security/i);
    expect((await q(`insert into public.deals(tenant_id, assigned_to) values ($1, $2) returning id`, [T, ADV1])).length).toBe(1);
    await admin();
  });

  it("takım lideri de kendi kapsamlıdır; ofis sahibi ve şube müdürü başkasının anlaşmasına yazar", async () => {
    await as(TL);
    expect((await q(`update public.deals set deal_value = 5 where id = $1 returning id`, [D2])).length).toBe(0);
    await as(OWNER);
    expect((await q(`update public.deals set deal_value = 2100 where id = $1 returning id`, [D2])).length).toBe(1);
    await as(BM);
    expect((await q(`update public.deals set deal_value = 2200 where id = $1 returning id`, [D2])).length).toBe(1);
    await admin();
  });

  it("anlaşma masrafı başka danışmanın anlaşmasına eklenemez; kendi anlaşmasına eklenir", async () => {
    await as(ADV1);
    await expect(q(`insert into public.deal_costs(tenant_id, deal_id, amount) values ($1, $2, 10)`, [T, D2])).rejects.toThrow(/row-level security/i);
    expect((await q(`insert into public.deal_costs(tenant_id, deal_id, amount) values ($1, $2, 10) returning id`, [T, D1])).length).toBe(1);
    await admin();
  });

  it("komisyon defteri: danışman (kendi anlaşmasında bile) yazamaz; muhasebe ve ofis sahibi yazar; commissions:delete istisnası açar", async () => {
    await as(ADV1);
    expect((await q(`update public.commissions set splits = '[{"rate":50}]' where id = $1 returning id`, [C1])).length).toBe(0);
    await as(ACC);
    expect((await q(`update public.commissions set splits = '[{"rate":40}]' where id = $1 returning id`, [C2])).length).toBe(1);
    await as(OWNER);
    expect((await q(`update public.commissions set splits = '[{"rate":30}]' where id = $1 returning id`, [C2])).length).toBe(1);
    await admin();
    await q(`insert into public.perm_grants values ('advisor', 'commissions', 'delete')`);
    await as(ADV2);
    expect((await q(`update public.commissions set splits = '[{"rate":20}]' where id = $1 returning id`, [C2])).length).toBe(1);
    await admin();
    await q(`delete from public.perm_grants`);
  });

  it("onay kararı: owner evet; takım lideri / şube müdürü varsayılan edit ile hayır, commissions:delete ile evet; danışman hayır", async () => {
    const can = async (uid: string) => {
      await as(uid);
      const r = (await q(`select public.approval_actor_can_decide() as ok`))[0]!.ok as boolean;
      await admin();
      return r;
    };
    expect(await can(OWNER)).toBe(true);
    expect(await can(TL)).toBe(false);
    expect(await can(BM)).toBe(false);
    expect(await can(ADV1)).toBe(false);
    await q(`insert into public.perm_grants values ('team_lead', 'commissions', 'delete')`);
    expect(await can(TL)).toBe(true);
    await q(`delete from public.perm_grants`);
  });

  describe("Masraf bildir", () => {
    const path = (uid: string, n: number) => `${T}/${uid}/0000000${n}-0000-4000-8000-000000000000.jpg`;
    // Harcama günü iki gün önce: TR/UTC gün sınırında oynamaz.
    const today = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const submit = async (uid: string, p: Record<string, unknown>) => {
      await as(uid);
      const r = (await q(`select public.expense_claim_submit($1::jsonb) as r`, [JSON.stringify(p)]))[0]!.r as Record<string, string>;
      await admin();
      return r;
    };
    const base = (uid: string, n: number) => ({
      amount: "350.50", spent_on: today, category: "ulasim", description: "[SAHA] Müşteri gösterimi taksi", receipt_path: path(uid, n), receipt_mime: "image/jpeg",
    });

    it("geçersiz girdi ve başkasının klasörü reddedilir; authenticated tabloya doğrudan yazamaz", async () => {
      expect((await submit(ADV1, { ...base(ADV1, 1), amount: "0" })).outcome).toBe("invalid_input");
      expect((await submit(ADV1, { ...base(ADV1, 1), spent_on: "2099-01-01" })).outcome).toBe("invalid_input");
      expect((await submit(ADV1, { ...base(ADV1, 1), receipt_path: path(ADV2, 1) })).outcome).toBe("invalid_receipt");
      expect((await submit(ADV1, { ...base(ADV1, 1), deal_id: D2 })).outcome).toBe("invalid_input");
      await as(ADV1);
      await expect(q(`insert into public.expense_claims(tenant_id, claimant_id, amount, spent_on, category, description, receipt_path, receipt_mime)
        values ($1, $2, 1, current_date, 'ulasim', 'xxxx', 'aaaaaaaaaaaa', 'image/jpeg')`, [T, ADV1])).rejects.toThrow(/permission denied/i);
      await admin();
    });

    it("talep + onay satırı tek işlemde açılır; başka danışman göremez; onayda danışmana ödenecek açık kalem yazılır", async () => {
      const r = await submit(ADV1, { ...base(ADV1, 2), deal_id: D1 });
      expect(r.outcome).toBe("created");
      const appr = (await q(`select * from public.approval_requests where id = $1`, [r.approval_id]))[0]!;
      expect(appr).toMatchObject({ kind: "gider", status: "bekliyor", requested_by: ADV1, entity_type: "expense", entity_id: r.claim_id });
      expect(String(appr.description)).toMatch(/^\[oversight:expense_claim:/);
      expect((await submit(ADV1, { ...base(ADV1, 2) })).outcome).toBe("duplicate");

      await as(ADV2);
      expect((await q(`select id from public.expense_claims where id = $1`, [r.claim_id])).length).toBe(0);
      await as(ADV1);
      expect((await q(`select id from public.expense_claims where id = $1`, [r.claim_id])).length).toBe(1);
      await admin();

      await q(`update public.approval_requests set status = 'onaylandi', decided_by = $2, decided_at = now() where id = $1`, [r.approval_id, OWNER]);
      const claim = (await q(`select * from public.expense_claims where id = $1`, [r.claim_id]))[0]!;
      expect(claim.status).toBe("onaylandi");
      const item = (await q(`select o.*, p.user_id, p.kind as party_kind from public.finance_open_items o left join public.finance_parties p on p.id = o.party_id where o.id = $1`, [claim.open_item_id]))[0]!;
      expect(item).toMatchObject({ direction: "payable", source_type: "expense_claim", source_id: r.claim_id, category: "ulasim", user_id: ADV1, party_kind: "danisman", created_by: OWNER });
      expect(Number(item.amount)).toBe(350.5);
      // Karar tekrar tetiklenmez (yalnız bekliyor -> karar geçişi).
      await q(`update public.approval_requests set decision_note = 'x' where id = $1`, [r.approval_id]);
      expect((await q(`select count(*)::int as n from public.finance_open_items where source_id = $1`, [r.claim_id]))[0]!.n).toBe(1);
    });

    it("ret talebi reddedildi yapar, deftere hiçbir şey yazmaz", async () => {
      const r = await submit(ADV2, base(ADV2, 3));
      expect(r.outcome).toBe("created");
      await q(`update public.approval_requests set status = 'reddedildi', decided_by = $2, decided_at = now(), decision_note = 'fiş okunmuyor' where id = $1`, [r.approval_id, OWNER]);
      expect((await q(`select status from public.expense_claims where id = $1`, [r.claim_id]))[0]!.status).toBe("reddedildi");
      expect((await q(`select count(*)::int as n from public.finance_open_items where source_id = $1`, [r.claim_id]))[0]!.n).toBe(0);
    });

    it("geri alma dosyası temiz uygulanır", async () => {
      await db.exec(read("supabase/rollbacks/20261023040001_expense_claims.rollback.sql"));
      await db.exec(read("supabase/rollbacks/20261023040000_advisor_deals_offers_scope.rollback.sql"));
      expect((await q(`select to_regclass('public.expense_claims') as t`))[0]!.t).toBeNull();
      expect((await q(`select count(*)::int as n from public.permission_defaults where role = 'advisor' and module = 'offers'`))[0]!.n).toBe(0);
      expect((await q(`select count(*)::int as n from public.permission_defaults where role = 'advisor' and module = 'commissions'`))[0]!.n).toBe(1);
      expect((await q(`select count(*)::int as n from pg_policies where policyname like 'wp2_%'`))[0]!.n).toBe(0);
    });
  });
});
