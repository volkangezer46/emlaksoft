-- MIGRATION 20261020030033_building_budget_announcements.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: tablolar yokken Aidat > Binalar > "Isletme projesi" ve "Duyurular" bolumleri
--   "kurulum bekliyor" der; mevcut donem tahakkuku / gider paylastirma / tahsilat aynen calisir.
-- Geri alma: supabase/rollbacks/20261020030033_building_budget_announcements.rollback.sql (butce ve duyurular silinir;
--   butceden uretilmis aidat tahakkuklari KALIR, yalniz budget_id baglari duser).
-- BAGIMLILIK: 20261008001700_building_management (buildings, building_units, building_charge_batches, create_building_batch).
--
-- NE (SP11, yillik isletme projesi + sakin duyurulari):
--   1) building_budgets: bina basina donem (varsayilan 12 ay) isletme projesi; kalemler jsonb [{category,label,amount}],
--      dagitim (esit / arsa payi / m2), genel kurul karar tarihi/no/notu, taslak -> onayli. Yazma YALNIZ RPC ile.
--   2) building_charge_batches.budget_id: butceden uretilen aylik avans tahakkuklarinin bagi (bilgi; dogrulama yok).
--   3) accrue_building_budget: onayli butcenin aylik avansini secilen aylar icin MEVCUT create_building_batch ile tahakkuk
--      eder (defter/finans tetikleyicileri aynen calisir). Donem basina tek aidat kurali sayesinde IDEMPOTENT: var olan ay
--      atlanir. Bir ay beklenmedik nedenle reddedilirse hicbir ay yazilmaz (alt transaction geri alinir).
--   4) building_announcements: binaya duyuru (portalda sakinlere gorunur); SMS/WhatsApp gonderim ozeti `delivery` jsonb.
--      Yazma RLS ile (expenses:create ekler, expenses:edit yalniz pinned/archived_at/delivery/visible_in_portal gunceller).
-- RLS okuma: expenses:view (Aidat sayfasinin modulu). Ofis izolasyonu: tenant_id = current_active_tenant_id().
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.buildings') is null
     or pg_catalog.to_regclass('public.building_charge_batches') is null
     or pg_catalog.to_regprocedure('public.create_building_batch(uuid,text,date,text,text,numeric,text,date,jsonb)') is null then
    raise exception '20261020030033: 20261008001700 (bina yonetimi) uygulanmamis.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) Isletme projesi (yillik butce)
-- ---------------------------------------------------------------------------
create table if not exists public.building_budgets (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  building_id    uuid not null,
  title          text not null check (char_length(title) between 1 and 120),
  period_start   date not null check (extract(day from period_start) = 1),
  months         smallint not null default 12 check (months between 1 and 24),
  distribution   text not null default 'land_share' check (distribution in ('equal', 'land_share', 'area')),
  lines          jsonb not null default '[]'::jsonb check (pg_catalog.jsonb_typeof(lines) = 'array' and pg_catalog.jsonb_array_length(lines) <= 60),
  total_amount   numeric(14,2) not null default 0 check (total_amount >= 0 and total_amount <= 1000000000),
  status         text not null default 'draft' check (status in ('draft', 'approved')),
  decision_date  date,
  decision_no    text check (decision_no is null or char_length(decision_no) <= 40),
  decision_note  text check (decision_note is null or char_length(decision_note) <= 1000),
  approved_at    timestamptz,
  approved_by    uuid references public.profiles(id) on delete set null,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint building_budgets_building_tenant_fkey foreign key (building_id, tenant_id)
    references public.buildings(id, tenant_id) on delete cascade,
  constraint building_budgets_approved_consistent check ((status = 'approved') = (approved_at is not null))
);

create unique index if not exists idx_building_budgets_id_tenant_unique on public.building_budgets (id, tenant_id);
-- Bir binada ayni baslangic ayina tek isletme projesi.
create unique index if not exists idx_building_budgets_building_period on public.building_budgets (building_id, period_start);
create index if not exists idx_building_budgets_tenant_building on public.building_budgets (tenant_id, building_id, period_start desc);

comment on table public.building_budgets is 'Bina isletme projesi (KMK m.37 yillik butce): kalemler + dagitim + karar bilgisi; taslak -> onayli. Yazma yalniz RPC (save_building_budget / set_building_budget_status / accrue_building_budget).';

alter table public.building_charge_batches add column if not exists budget_id uuid;
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'building_batches_budget_fkey') then
    alter table public.building_charge_batches
      add constraint building_batches_budget_fkey foreign key (budget_id, tenant_id)
      references public.building_budgets(id, tenant_id) on delete set null (budget_id);
  end if;
end;
$$;
create index if not exists idx_building_batches_budget on public.building_charge_batches (budget_id) where budget_id is not null;

alter table public.building_budgets enable row level security;
drop policy if exists building_budgets_select on public.building_budgets;
create policy building_budgets_select on public.building_budgets
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'view')));

revoke all on public.building_budgets from public, anon, authenticated;
grant select on public.building_budgets to authenticated;
grant all on public.building_budgets to service_role;

-- ---------------------------------------------------------------------------
-- 2) Duyurular
-- ---------------------------------------------------------------------------
create table if not exists public.building_announcements (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  building_id       uuid not null,
  title             text not null check (char_length(title) between 1 and 120),
  body              text not null check (char_length(body) between 1 and 2000),
  category          text not null default 'genel' check (category in ('genel', 'bakim', 'toplanti', 'kesinti', 'finans')),
  pinned            boolean not null default false,
  visible_in_portal boolean not null default true,
  delivery          jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(delivery) = 'object'),
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  archived_at       timestamptz,
  constraint building_announcements_building_tenant_fkey foreign key (building_id, tenant_id)
    references public.buildings(id, tenant_id) on delete cascade
);
create index if not exists idx_building_announcements_building on public.building_announcements (tenant_id, building_id, created_at desc);

comment on table public.building_announcements is 'Bina duyurusu: ofis ekrani + malik/kiraci portali. SMS/WhatsApp gonderimi sunucuda IYS kapisindan gecer; ozet delivery jsonb.';

alter table public.building_announcements enable row level security;
drop policy if exists building_announcements_select on public.building_announcements;
create policy building_announcements_select on public.building_announcements
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'view')));
drop policy if exists building_announcements_insert on public.building_announcements;
create policy building_announcements_insert on public.building_announcements
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('expenses', 'create'))
    and created_by = (select auth.uid())
  );
drop policy if exists building_announcements_update on public.building_announcements;
create policy building_announcements_update on public.building_announcements
  for update to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'edit')))
  with check (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('expenses', 'edit')));

revoke all on public.building_announcements from public, anon, authenticated;
grant select, insert on public.building_announcements to authenticated;
-- Guncelleme yalniz bu sutunlar (baslik/metin/bina/olusturan degismez; duzeltme = yeni duyuru).
grant update (pinned, visible_in_portal, delivery, archived_at) on public.building_announcements to authenticated;
grant all on public.building_announcements to service_role;

-- ---------------------------------------------------------------------------
-- 3) RPC: isletme projesi kaydet (taslak)
-- ---------------------------------------------------------------------------
create or replace function public.save_building_budget(
  p_budget_id uuid,
  p_building_id uuid,
  p_title text,
  p_period_start date,
  p_months integer,
  p_distribution text,
  p_lines jsonb,
  p_decision_date date,
  p_decision_no text,
  p_decision_note text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_title text := pg_catalog.btrim(coalesce(p_title, ''));
  v_no text := nullif(pg_catalog.btrim(coalesce(p_decision_no, '')), '');
  v_note text := nullif(pg_catalog.btrim(coalesce(p_decision_note, '')), '');
  v_lines jsonb;
  v_count integer;
  v_valid integer;
  v_total numeric;
  v_row public.building_budgets%rowtype;
  v_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  if not public.has_effective_permission('expenses', case when p_budget_id is null then 'create' else 'edit' end) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  if p_building_id is null
     or char_length(v_title) < 1 or char_length(v_title) > 120
     or p_period_start is null or extract(day from p_period_start) <> 1 or p_period_start < date '2000-01-01' or p_period_start > date '2100-01-01'
     or p_months is null or p_months < 1 or p_months > 24
     or p_distribution is null or p_distribution not in ('equal', 'land_share', 'area')
     or (p_decision_date is not null and (p_decision_date < date '2000-01-01' or p_decision_date > date '2100-01-01'))
     or char_length(coalesce(v_no, '')) > 40 or char_length(coalesce(v_note, '')) > 1000
     or p_lines is null or pg_catalog.jsonb_typeof(p_lines) <> 'array'
     or pg_catalog.jsonb_array_length(p_lines) < 1 or pg_catalog.jsonb_array_length(p_lines) > 60 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  -- Kalemler: {category, label, amount}; ad 1-120, kategori <= 60, tutar 0,01..1e9 ve en cok iki ondalik.
  begin
    select pg_catalog.count(*),
           pg_catalog.count(*) filter (
             where pg_catalog.jsonb_typeof(l) = 'object'
               and char_length(pg_catalog.btrim(coalesce(l ->> 'label', ''))) between 1 and 120
               and char_length(coalesce(l ->> 'category', '')) <= 60
               and (l ->> 'amount')::numeric >= 0.01 and (l ->> 'amount')::numeric <= 1000000000
               and pg_catalog.round((l ->> 'amount')::numeric, 2) = (l ->> 'amount')::numeric),
           coalesce(pg_catalog.sum(pg_catalog.round((l ->> 'amount')::numeric, 2)), 0),
           coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'category', nullif(pg_catalog.btrim(coalesce(l ->> 'category', '')), ''),
             'label', pg_catalog.btrim(l ->> 'label'),
             'amount', pg_catalog.round((l ->> 'amount')::numeric, 2))), '[]'::jsonb)
      into v_count, v_valid, v_total, v_lines
      from pg_catalog.jsonb_array_elements(p_lines) l;
  exception when others then
    return jsonb_build_object('outcome', 'invalid_input');
  end;
  if v_valid <> v_count or v_total < 0.01 or v_total > 1000000000 then
    return jsonb_build_object('outcome', 'invalid_lines');
  end if;

  if not exists (select 1 from public.buildings b where b.id = p_building_id and b.tenant_id = v_tenant and b.archived_at is null) then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if p_budget_id is null then
    if exists (select 1 from public.building_budgets x where x.building_id = p_building_id and x.period_start = p_period_start) then
      return jsonb_build_object('outcome', 'duplicate_period');
    end if;
    insert into public.building_budgets (tenant_id, building_id, title, period_start, months, distribution, lines, total_amount,
                                         decision_date, decision_no, decision_note, created_by)
    values (v_tenant, p_building_id, v_title, p_period_start, p_months, p_distribution, v_lines, v_total,
            p_decision_date, v_no, v_note, v_uid)
    returning id into v_id;
  else
    select * into v_row from public.building_budgets x where x.id = p_budget_id and x.tenant_id = v_tenant for update;
    if not found or v_row.building_id <> p_building_id then
      return jsonb_build_object('outcome', 'not_found');
    end if;
    if v_row.status = 'approved' then
      return jsonb_build_object('outcome', 'locked');
    end if;
    if exists (select 1 from public.building_budgets x where x.building_id = p_building_id and x.period_start = p_period_start and x.id <> p_budget_id) then
      return jsonb_build_object('outcome', 'duplicate_period');
    end if;
    update public.building_budgets
       set title = v_title, period_start = p_period_start, months = p_months, distribution = p_distribution, lines = v_lines,
           total_amount = v_total, decision_date = p_decision_date, decision_no = v_no, decision_note = v_note, updated_at = now()
     where id = p_budget_id;
    v_id := p_budget_id;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, v_uid, case when p_budget_id is null then 'building_budget.create' else 'building_budget.update' end, 'building_budget', v_id,
          jsonb_build_object('building_id', p_building_id, 'period_start', p_period_start, 'months', p_months, 'total', v_total, 'lines', v_count));

  return jsonb_build_object('outcome', 'saved', 'budget_id', v_id, 'total', v_total);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) RPC: onayla / taslaga al / taslagi sil
-- ---------------------------------------------------------------------------
create or replace function public.set_building_budget_status(p_budget_id uuid, p_action text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_row public.building_budgets%rowtype;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  if p_budget_id is null or p_action is null or p_action not in ('approve', 'reopen', 'delete') then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if not public.has_effective_permission('expenses', case when p_action = 'delete' then 'delete' else 'edit' end) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  select * into v_row from public.building_budgets x where x.id = p_budget_id and x.tenant_id = v_tenant for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  if p_action = 'approve' then
    if v_row.status = 'approved' then
      return jsonb_build_object('outcome', 'already_approved');
    end if;
    if v_row.total_amount < 0.01 then
      return jsonb_build_object('outcome', 'invalid_lines');
    end if;
    update public.building_budgets set status = 'approved', approved_at = now(), approved_by = v_uid, updated_at = now() where id = p_budget_id;
  elsif p_action = 'reopen' then
    if v_row.status <> 'approved' then
      return jsonb_build_object('outcome', 'not_approved');
    end if;
    if exists (select 1 from public.building_charge_batches c where c.budget_id = p_budget_id and c.voided_at is null) then
      return jsonb_build_object('outcome', 'has_accruals');
    end if;
    update public.building_budgets set status = 'draft', approved_at = null, approved_by = null, updated_at = now() where id = p_budget_id;
  else
    if v_row.status <> 'draft' then
      return jsonb_build_object('outcome', 'locked');
    end if;
    delete from public.building_budgets where id = p_budget_id;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, v_uid, 'building_budget.' || p_action, 'building_budget', p_budget_id,
          jsonb_build_object('building_id', v_row.building_id, 'period_start', v_row.period_start, 'total', v_row.total_amount));

  return jsonb_build_object('outcome', 'done');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) RPC: aylik avans tahakkuku (idempotent; mevcut create_building_batch ile)
-- ---------------------------------------------------------------------------
create or replace function public.accrue_building_budget(p_budget_id uuid, p_periods jsonb, p_shares jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_budget public.building_budgets%rowtype;
  v_due_day integer;
  v_monthly numeric;
  v_last date;
  v_period date;
  v_bad integer;
  v_res jsonb;
  v_outcome text;
  v_created integer := 0;
  v_skipped integer := 0;
  v_title text;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  if not public.has_effective_permission('expenses', 'create') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_budget_id is null or p_periods is null or pg_catalog.jsonb_typeof(p_periods) <> 'array'
     or pg_catalog.jsonb_array_length(p_periods) < 1 or pg_catalog.jsonb_array_length(p_periods) > 24
     or p_shares is null or pg_catalog.jsonb_typeof(p_shares) <> 'array' then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select * into v_budget from public.building_budgets x where x.id = p_budget_id and x.tenant_id = v_tenant for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_budget.status <> 'approved' then
    return jsonb_build_object('outcome', 'not_approved');
  end if;
  select b.due_day into v_due_day from public.buildings b where b.id = v_budget.building_id and b.tenant_id = v_tenant and b.archived_at is null;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- Aylik avans = yillik toplam / ay (kurusa yuvarlanir; istemci ayni kurali uygular).
  v_monthly := pg_catalog.round(v_budget.total_amount / v_budget.months, 2);
  if v_monthly < 0.01 then
    return jsonb_build_object('outcome', 'invalid_lines');
  end if;
  v_last := (v_budget.period_start + pg_catalog.make_interval(months => v_budget.months - 1))::date;

  -- Donemler: ayin 1'i, butce penceresi icinde, tekrarsiz.
  begin
    select pg_catalog.count(*) filter (
             where extract(day from (p #>> '{}')::date) <> 1
                or (p #>> '{}')::date < v_budget.period_start
                or (p #>> '{}')::date > v_last)
           + (pg_catalog.count(*) - pg_catalog.count(distinct (p #>> '{}')::date))
      into v_bad
      from pg_catalog.jsonb_array_elements(p_periods) p;
  exception when others then
    return jsonb_build_object('outcome', 'invalid_input');
  end;
  if v_bad > 0 then
    return jsonb_build_object('outcome', 'invalid_periods');
  end if;

  v_title := pg_catalog.left('Aidat avansı · ' || v_budget.title, 160);
  begin
    for v_period in
      select (p #>> '{}')::date from pg_catalog.jsonb_array_elements(p_periods) p order by 1
    loop
      v_res := public.create_building_batch(
        v_budget.building_id, 'aidat', v_period, v_title, 'İşletme projesi', v_monthly, v_budget.distribution,
        pg_catalog.make_date(extract(year from v_period)::integer, extract(month from v_period)::integer, v_due_day),
        p_shares
      );
      v_outcome := coalesce(v_res ->> 'outcome', 'invalid_result');
      if v_outcome = 'created' then
        update public.building_charge_batches set budget_id = p_budget_id
         where id = (v_res ->> 'batch_id')::uuid and tenant_id = v_tenant;
        v_created := v_created + 1;
      elsif v_outcome = 'duplicate_period' then
        v_skipped := v_skipped + 1;
      else
        raise exception using errcode = 'P0001', message = v_outcome;
      end if;
    end loop;
  exception when sqlstate 'P0001' then
    -- Alt transaction geri alinir: hicbir ay yazilmaz.
    return jsonb_build_object('outcome', sqlerrm);
  end;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, v_uid, 'building_budget.accrue', 'building_budget', p_budget_id,
          jsonb_build_object('building_id', v_budget.building_id, 'monthly', v_monthly, 'created', v_created, 'skipped', v_skipped));

  return jsonb_build_object('outcome', 'accrued', 'created', v_created, 'skipped', v_skipped, 'monthly', v_monthly);
end;
$$;

revoke all on function public.save_building_budget(uuid, uuid, text, date, integer, text, jsonb, date, text, text) from public, anon;
revoke all on function public.set_building_budget_status(uuid, text) from public, anon;
revoke all on function public.accrue_building_budget(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.save_building_budget(uuid, uuid, text, date, integer, text, jsonb, date, text, text) to authenticated, service_role;
grant execute on function public.set_building_budget_status(uuid, text) to authenticated, service_role;
grant execute on function public.accrue_building_budget(uuid, jsonb, jsonb) to authenticated, service_role;

comment on function public.save_building_budget(uuid, uuid, text, date, integer, text, jsonb, date, text, text) is 'Isletme projesi taslagi kaydet: kalem bicimi + toplam + bina dogrulamasi; onayli butce kilitli. Yetki iceride (expenses:create / edit).';
comment on function public.set_building_budget_status(uuid, text) is 'Isletme projesi onayla / taslaga al (avans tahakkuku yoksa) / taslagi sil. Yetki iceride (expenses:edit; silme expenses:delete).';
comment on function public.accrue_building_budget(uuid, jsonb, jsonb) is 'Onayli isletme projesinin aylik avansini secilen aylara create_building_batch ile tahakkuk eder; var olan ay atlanir (idempotent), hata olursa hicbir ay yazilmaz. Yetki iceride (expenses:create).';
