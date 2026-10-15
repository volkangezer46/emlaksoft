-- MIGRATION 20261019050000_project_unit_pricing.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod RPC/tablo yokken "Fiyatlari guncelle" ve "Excel'den aktar"
--   "bu ortamda henuz etkin degil" der, fiyat gecmisi bos gorunur; tekil daire duzenleme eskisi gibi calisir.
-- Geri alma: supabase/rollbacks/20261019050000_project_unit_pricing.rollback.sql
-- BAGIMLILIK: 20260726000075 (projects/project_units), 20260726000083 (unit_payments),
--   20260813000000 (project_units satis koruyucu tetigi), current_active_tenant_id / has_effective_permission.
--
-- NE (PF-05, proje fiyat listesi):
--   1) project_unit_price_history: her liste fiyati degisimi (tekil duzenleme, toplu zam, Excel aktarimi) tetikle
--      yazilir; okuma ayni ofis + projects:view, yazma YALNIZ tetik (authenticated'a yazma hakki yok).
--   2) bulk_reprice_project_units: secili dairelere yuzde / sabit tutar zam-indirim, yuvarlama; TEK deyim, ayni
--      parti kimligiyle gecmise yazar. Satilmis, kaporali ve odeme plani olan daireler HIC degismez.
--   3) undo_project_unit_reprice: ayni partiyi 10 dakika icinde geri alir (fiyat o arada elle degistiyse dokunmaz).
--   4) import_project_units: muteahhit fiyat listesi (blok, kat, no, oda, m2, fiyat) — eslesen daire guncellenir,
--      yenisi eklenir; satilmis daire atlanir, odeme planli dairenin fiyati korunur.
set local lock_timeout = '5s';

create table if not exists public.project_unit_price_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  unit_id uuid not null references public.project_units(id) on delete cascade,
  old_price numeric(14,2),
  new_price numeric(14,2),
  reason text check (reason is null or char_length(reason) <= 200),
  batch_id uuid,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_unit_price_history_unit
  on public.project_unit_price_history (unit_id, created_at desc);
create index if not exists idx_project_unit_price_history_project
  on public.project_unit_price_history (tenant_id, project_id, created_at desc);
create index if not exists idx_project_unit_price_history_batch
  on public.project_unit_price_history (tenant_id, batch_id)
  where batch_id is not null;

alter table public.project_unit_price_history enable row level security;

drop policy if exists project_unit_price_history_select on public.project_unit_price_history;
create policy project_unit_price_history_select on public.project_unit_price_history
  for select to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('projects'::text, 'view'::text))
  );

revoke all privileges on table public.project_unit_price_history from public, anon, authenticated;
grant select on table public.project_unit_price_history to authenticated;
grant all on table public.project_unit_price_history to service_role;

comment on table public.project_unit_price_history is
  'PF-05: proje dairesi liste fiyati gecmisi; yalniz tetik yazar (tekil, toplu zam, Excel aktarimi), okuma projects:view.';

-- ---------------------------------------------------------------- gecmis tetigi
create or replace function public.project_unit_price_history_capture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := nullif(current_setting('emlaksoft.unit_price_reason', true), '');
  v_batch text := nullif(current_setting('emlaksoft.unit_price_batch', true), '');
begin
  if new.list_price is distinct from old.list_price then
    insert into public.project_unit_price_history
      (tenant_id, project_id, unit_id, old_price, new_price, reason, batch_id, changed_by)
    values (
      new.tenant_id, new.project_id, new.id, old.list_price, new.list_price,
      left(v_reason, 200),
      case when v_batch ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_batch::uuid end,
      auth.uid()
    );
  end if;
  return new;
end;
$$;

revoke all on function public.project_unit_price_history_capture() from public, anon, authenticated;

drop trigger if exists project_units_price_history on public.project_units;
create trigger project_units_price_history
after update of list_price on public.project_units
for each row execute function public.project_unit_price_history_capture();

-- ---------------------------------------------------------------- toplu fiyat guncelleme
create or replace function public.bulk_reprice_project_units(
  p_project_id uuid,
  p_unit_ids uuid[],
  p_mode text,
  p_value numeric,
  p_round_to numeric default 0,
  p_reason text default null
)
returns table (batch_id uuid, updated_count integer, old_total numeric, new_total numeric)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_active_tenant_id();
  v_batch uuid := gen_random_uuid();
  v_round numeric := coalesce(p_round_to, 0);
begin
  if v_tenant is null or not public.has_effective_permission('projects', 'edit') then
    raise exception 'Bu islem icin proje duzenleme yetkisi gerekir.' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('pct', 'fixed') then
    raise exception 'Gecersiz guncelleme turu.' using errcode = '22023';
  end if;
  if p_value is null or p_value = 0
     or (p_mode = 'pct' and (p_value < -50 or p_value > 200))
     or (p_mode = 'fixed' and abs(p_value) > 100000000000) then
    raise exception 'Gecersiz guncelleme degeri.' using errcode = '22023';
  end if;
  if v_round < 0 or v_round > 1000000 then
    raise exception 'Gecersiz yuvarlama.' using errcode = '22023';
  end if;
  if coalesce(cardinality(p_unit_ids), 0) = 0 or cardinality(p_unit_ids) > 1000 then
    raise exception 'En az 1, en fazla 1000 daire secin.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.tenant_id = v_tenant) then
    raise exception 'Proje bulunamadi.' using errcode = 'P0002';
  end if;

  perform set_config('emlaksoft.unit_price_reason', left(coalesce(nullif(btrim(p_reason), ''), 'Toplu fiyat guncelleme'), 200), true);
  perform set_config('emlaksoft.unit_price_batch', v_batch::text, true);

  return query
  with target as (
    select
      u.id,
      u.list_price as old_price,
      greatest(
        0::numeric,
        case
          when v_round > 0 then round(
            (case when p_mode = 'pct' then u.list_price * (1 + p_value / 100) else u.list_price + p_value end) / v_round
          ) * v_round
          else round(case when p_mode = 'pct' then u.list_price * (1 + p_value / 100) else u.list_price + p_value end, 0)
        end
      ) as new_price
    from public.project_units u
    where u.tenant_id = v_tenant
      and u.project_id = p_project_id
      and u.id = any (p_unit_ids)
      and u.status in ('available', 'reserved')
      and u.list_price is not null
      and u.list_price > 0
      and not exists (
        select 1 from public.unit_payments up where up.unit_id = u.id and up.tenant_id = v_tenant
      )
  ),
  upd as (
    update public.project_units u
    set list_price = t.new_price
    from target t
    where u.id = t.id
      and u.tenant_id = v_tenant
      and t.new_price is distinct from t.old_price
      and t.new_price <= 999999999999
    returning t.old_price, t.new_price
  )
  select v_batch, count(*)::integer, coalesce(sum(upd.old_price), 0), coalesce(sum(upd.new_price), 0)
  from upd;

  perform set_config('emlaksoft.unit_price_reason', '', true);
  perform set_config('emlaksoft.unit_price_batch', '', true);
end;
$$;

revoke all on function public.bulk_reprice_project_units(uuid, uuid[], text, numeric, numeric, text) from public, anon;
grant execute on function public.bulk_reprice_project_units(uuid, uuid[], text, numeric, numeric, text) to authenticated, service_role;

-- ---------------------------------------------------------------- toplu guncellemeyi geri al
create or replace function public.undo_project_unit_reprice(p_batch_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_active_tenant_id();
  v_count integer := 0;
begin
  if v_tenant is null or not public.has_effective_permission('projects', 'edit') then
    raise exception 'Bu islem icin proje duzenleme yetkisi gerekir.' using errcode = '42501';
  end if;
  if p_batch_id is null then
    raise exception 'Parti bulunamadi.' using errcode = '22023';
  end if;

  perform set_config('emlaksoft.unit_price_reason', 'Toplu guncelleme geri alindi', true);
  perform set_config('emlaksoft.unit_price_batch', '', true);

  with batch as (
    select h.unit_id, h.old_price, h.new_price
    from public.project_unit_price_history h
    where h.tenant_id = v_tenant
      and h.batch_id = p_batch_id
      and h.created_at > now() - interval '10 minutes'
  ),
  upd as (
    update public.project_units u
    set list_price = b.old_price
    from batch b
    where u.id = b.unit_id
      and u.tenant_id = v_tenant
      and u.list_price is not distinct from b.new_price
      and u.status in ('available', 'reserved')
      and not exists (select 1 from public.unit_payments up where up.unit_id = u.id and up.tenant_id = v_tenant)
    returning u.id
  )
  select count(*)::integer into v_count from upd;

  perform set_config('emlaksoft.unit_price_reason', '', true);
  return v_count;
end;
$$;

revoke all on function public.undo_project_unit_reprice(uuid) from public, anon;
grant execute on function public.undo_project_unit_reprice(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------- Excel / CSV fiyat listesi aktarimi
create or replace function public.import_project_units(p_project_id uuid, p_rows jsonb)
returns table (created_count integer, updated_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_active_tenant_id();
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_can_create boolean := public.has_effective_permission('projects', 'create');
  v_can_edit boolean := public.has_effective_permission('projects', 'edit');
  r record;
  v_unit record;
  v_has_plan boolean;
begin
  if v_tenant is null or not (v_can_create or v_can_edit) then
    raise exception 'Bu islem icin proje yetkisi gerekir.' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 1000 then
    raise exception 'En az 1, en fazla 1000 satir aktarilabilir.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id and p.tenant_id = v_tenant) then
    raise exception 'Proje bulunamadi.' using errcode = 'P0002';
  end if;

  perform set_config('emlaksoft.unit_price_reason', 'Fiyat listesi aktarimi', true);
  perform set_config('emlaksoft.unit_price_batch', '', true);

  for r in
    select
      nullif(left(btrim(x.block), 40), '') as block,
      x.floor,
      left(btrim(x.unit_no), 20) as unit_no,
      nullif(left(btrim(x.rooms), 20), '') as rooms,
      case when x.gross_m2 > 0 and x.gross_m2 < 10000000 then x.gross_m2 end as gross_m2,
      case when x.list_price >= 0 and x.list_price <= 999999999999 then x.list_price end as list_price
    from jsonb_to_recordset(p_rows) as x(block text, floor integer, unit_no text, rooms text, gross_m2 numeric, list_price numeric)
  loop
    if r.unit_no is null or r.unit_no = '' or (r.floor is not null and (r.floor < -20 or r.floor > 300)) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select u.id, u.status into v_unit
    from public.project_units u
    where u.tenant_id = v_tenant
      and u.project_id = p_project_id
      and u.block is not distinct from r.block
      and u.unit_no = r.unit_no
    limit 1;

    if not found then
      if not v_can_create then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      insert into public.project_units (tenant_id, project_id, block, floor, unit_no, rooms, gross_m2, list_price, status)
      values (v_tenant, p_project_id, r.block, r.floor, r.unit_no, r.rooms, r.gross_m2, r.list_price, 'available');
      v_created := v_created + 1;
    elsif v_unit.status = 'sold' or not v_can_edit then
      v_skipped := v_skipped + 1;
    else
      select exists (
        select 1 from public.unit_payments up where up.unit_id = v_unit.id and up.tenant_id = v_tenant
      ) into v_has_plan;
      update public.project_units u
      set floor = coalesce(r.floor, u.floor),
          rooms = coalesce(r.rooms, u.rooms),
          gross_m2 = coalesce(r.gross_m2, u.gross_m2),
          list_price = case
            when r.list_price is not null and not v_has_plan and u.status in ('available', 'reserved') then r.list_price
            else u.list_price
          end
      where u.id = v_unit.id and u.tenant_id = v_tenant;
      v_updated := v_updated + 1;
    end if;
  end loop;

  perform set_config('emlaksoft.unit_price_reason', '', true);
  return query select v_created, v_updated, v_skipped;
end;
$$;

revoke all on function public.import_project_units(uuid, jsonb) from public, anon;
grant execute on function public.import_project_units(uuid, jsonb) to authenticated, service_role;
