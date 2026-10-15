-- MIGRATION 20261018080000_deal_stage_history.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular.
-- Geri alma: supabase/rollbacks/20261018080000_deal_stage_history.rollback.sql
-- BAGIMLILIK: 20260813000000 (transition_deal_stage_atomic ilk govdesi, guard_deal_atomic_stage), 20261016100000 (deals kapsam RLS'i),
--   audit_logs ('deal.stage' satirlari: geri doldurma kaynagi).
--
-- SP1 / arastirma 3: anlasma asama gecmisi.
--   * deals.stage_changed_at (asamaya giris ani), deals.expected_close_date (beklenen kapanis), deals.closed_at (kazanma/kayip ani).
--     Eskiden "hareketsiz" bilgisi updated_at'ten geliyordu: not eklemek bile bayatligi sifirliyordu; kapanis tarihi yoktu.
--   * deal_stage_events: EKLEMELI (append-only) asama gecis gunlugu. Tek yazar AFTER INSERT/UPDATE OF stage tetikleyicisidir:
--     hem transition_deal_stage_atomic (tekil + toplu asama yolu; deals-bulk-stage her kaydi bu RPC'den gecirir) hem kiralik
--     kapanis/proje satisi gibi diger RPC'ler ayni tetikleyiciyle yazar (kisayol yok). authenticated yalniz OKUR (RLS: kiraci +
--     anlasmanin kendisi gorunur olmali; boylece kapsam RLS'i olaylara da uygulanir); UPDATE/DELETE yetkisi yoktur.
--     is_sample anlasmadan turer; anlasma silinince olaylar cascade ile silinir (demo sifirlama dahil).
--   * transition_deal_stage_atomic YENI SURUM: govde birebir 20260813000000 ile ayni, tek fark islemi yapani
--     'app.deal_stage_actor' GUC'una yazmasi (tetikleyici changed_by'i buradan okur; service_role cagrisinda auth.uid() bostur)
--     ve search_path ''. Imza/ACL ayni.
--   * Geri doldurma: audit_logs 'deal.stage' satirlarindan gecisler + her anlasma icin olusturma olayi (from_stage null).
--     stage_changed_at = son olay ani (yoksa created_at); closed_at = kazanilan/kaybedilende son olay ani (yoksa updated_at).
--   * deal_stage_velocity(...): satis hizi raporu (SECURITY INVOKER; RLS + kapsam gecerli, parametreler yalniz daraltir).
-- ETKI: davranis (yeni tetikleyiciler + RPC govdesi). Mevcut kolonlar degismez. Idempotent.
-- KOD SIRASI: KOD YAYININDAN ONCE uygulanir (yeni kod deals.stage_changed_at / expected_close_date / closed_at okur).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.deals') is null or pg_catalog.to_regclass('public.audit_logs') is null then
    raise exception '20261018080000: public.deals / public.audit_logs yok.';
  end if;
  if pg_catalog.to_regprocedure('public.transition_deal_stage_atomic(uuid,uuid,uuid,text,text,text)') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null
     or pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null then
    raise exception '20261018080000: transition_deal_stage_atomic / has_effective_permission / current_active_tenant_id yok.';
  end if;
end $$;

-- 1) Kolonlar
alter table public.deals add column if not exists stage_changed_at timestamptz;
alter table public.deals add column if not exists expected_close_date date;
alter table public.deals add column if not exists closed_at timestamptz;

comment on column public.deals.stage_changed_at is 'SP1: anlasmanin mevcut asamaya girdigi an (tetikleyici yazar). Bayatlik/asamada gecen gun bundan hesaplanir.';
comment on column public.deals.expected_close_date is 'SP1: beklenen kapanis tarihi (danisman girer; tahmin ay dagilimi ve gecikme uyarisi).';
comment on column public.deals.closed_at is 'SP1: kazanma/kayip ani (tetikleyici yazar; yeniden acilinca bosalir).';

-- 2) Olay tablosu
create table if not exists public.deal_stage_events (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  deal_id     uuid not null references public.deals(id) on delete cascade,
  from_stage  text,
  to_stage    text not null,
  changed_by  uuid,
  changed_at  timestamptz not null default now(),
  is_sample   boolean not null default false,
  source      text not null default 'live' check (source in ('live', 'backfill'))
);
create index if not exists idx_deal_stage_events_deal on public.deal_stage_events (deal_id, changed_at);
create index if not exists idx_deal_stage_events_tenant_time on public.deal_stage_events (tenant_id, changed_at desc);
create index if not exists idx_deals_tenant_closed_at on public.deals (tenant_id, closed_at) where closed_at is not null;

alter table public.deal_stage_events enable row level security;

drop policy if exists deal_stage_events_select on public.deal_stage_events;
create policy deal_stage_events_select on public.deal_stage_events
  for select using (
    tenant_id = (select public.current_active_tenant_id())
    and exists (select 1 from public.deals d where d.id = deal_stage_events.deal_id)
  );

revoke all on public.deal_stage_events from public, anon, authenticated;
grant select on public.deal_stage_events to authenticated;
grant all on public.deal_stage_events to service_role;

comment on table public.deal_stage_events is
  'SP1: eklemeli anlasma asama gecmisi. Tek yazar deals tetikleyicisi (deals_stage_history_after); authenticated yalniz okur.';

-- 3) Geri doldurma (tetikleyiciler kurulmadan ONCE; idempotent: backfill olaylari yalniz hic olayi olmayan anlasmalara yazilir)
with targets as (
  select d.id, d.tenant_id, d.stage, d.created_at, d.updated_at, coalesce(d.is_sample, false) as is_sample
  from public.deals d
  where not exists (select 1 from public.deal_stage_events e where e.deal_id = d.id)
),
moves as (
  select t.id as deal_id, t.tenant_id, t.is_sample,
         nullif(lower(btrim(a.old_value ->> 'stage')), '') as from_stage,
         nullif(lower(btrim(a.new_value ->> 'stage')), '') as to_stage,
         a.actor_id, a.created_at
  from targets t
  join public.audit_logs a
    on a.entity_id = t.id and a.tenant_id = t.tenant_id
   and a.entity_type = 'deal' and a.action = 'deal.stage'
),
valid_moves as (
  select * from moves m
  where m.to_stage in ('new', 'qualified', 'negotiation', 'won', 'lost')
    and m.from_stage is distinct from m.to_stage
),
first_stage as (
  select distinct on (m.deal_id) m.deal_id, m.from_stage
  from valid_moves m
  order by m.deal_id, m.created_at
)
insert into public.deal_stage_events (tenant_id, deal_id, from_stage, to_stage, changed_by, changed_at, is_sample, source)
select t.tenant_id, t.id, null,
       coalesce(case when fs.from_stage in ('new', 'qualified', 'negotiation', 'won', 'lost') then fs.from_stage end, t.stage),
       null, t.created_at, t.is_sample, 'backfill'
from targets t
left join first_stage fs on fs.deal_id = t.id
union all
select m.tenant_id, m.deal_id, m.from_stage, m.to_stage, m.actor_id, m.created_at, m.is_sample, 'backfill'
from valid_moves m;

update public.deals d
set stage_changed_at = coalesce(
      (select max(e.changed_at) from public.deal_stage_events e where e.deal_id = d.id and e.to_stage = d.stage),
      d.created_at),
    closed_at = case when d.stage in ('won', 'lost') then coalesce(
      (select max(e.changed_at) from public.deal_stage_events e where e.deal_id = d.id and e.to_stage = d.stage and e.from_stage is not null),
      d.updated_at) end
where d.stage_changed_at is null;

-- 4) Tetikleyiciler
create or replace function public.deals_stage_history_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.stage_changed_at := coalesce(new.stage_changed_at, pg_catalog.clock_timestamp());
    if new.stage in ('won', 'lost') then
      new.closed_at := coalesce(new.closed_at, pg_catalog.clock_timestamp());
    end if;
    return new;
  end if;
  if new.stage is distinct from old.stage then
    new.stage_changed_at := pg_catalog.clock_timestamp();
    new.closed_at := case when new.stage in ('won', 'lost') then pg_catalog.clock_timestamp() else null end;
  end if;
  return new;
end;
$$;

create or replace function public.deals_stage_history_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw text := pg_catalog.current_setting('app.deal_stage_actor', true);
  v_actor uuid;
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then
    return null;
  end if;
  if v_raw ~ '^[0-9a-fA-F-]{36}$' then
    v_actor := v_raw::uuid;
  else
    v_actor := auth.uid();
  end if;
  insert into public.deal_stage_events (tenant_id, deal_id, from_stage, to_stage, changed_by, changed_at, is_sample, source)
  values (
    new.tenant_id, new.id,
    case when tg_op = 'UPDATE' then old.stage end,
    new.stage, v_actor, coalesce(new.stage_changed_at, pg_catalog.clock_timestamp()),
    coalesce(new.is_sample, false), 'live'
  );
  return null;
end;
$$;

revoke all on function public.deals_stage_history_before() from public, anon, authenticated;
revoke all on function public.deals_stage_history_after() from public, anon, authenticated;

drop trigger if exists deals_stage_history_before on public.deals;
create trigger deals_stage_history_before
  before insert or update of stage on public.deals
  for each row execute function public.deals_stage_history_before();

drop trigger if exists deals_stage_history_after on public.deals;
create trigger deals_stage_history_after
  after insert or update of stage on public.deals
  for each row execute function public.deals_stage_history_after();

-- 5) transition_deal_stage_atomic: yeni surum (islem yapani GUC'a yazar; govdenin geri kalani 20260813000000 ile ayni)
create or replace function public.transition_deal_stage_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_deal_id uuid,
  p_stage text,
  p_loss_reason text default null,
  p_expected_stage text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deal public.deals%rowtype;
  v_property public.properties%rowtype;
  v_commission public.commissions%rowtype;
  v_stage text := lower(btrim(coalesce(p_stage, '')));
  v_value numeric;
  v_rate numeric;
  v_net numeric;
  v_vat numeric;
  v_advisor numeric;
  v_target_property_status text;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_deal_id is null
     or v_stage not in ('new', 'qualified', 'negotiation', 'won', 'lost')
     or (p_expected_stage is not null
         and lower(btrim(p_expected_stage)) not in ('new', 'qualified', 'negotiation', 'won', 'lost'))
     or char_length(coalesce(p_loss_reason, '')) > 1000 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  -- SP1: asama gecmisi tetikleyicisi (deals_stage_history_after) islemi yapan kisiyi bu GUC'tan okur (islem sonuna kadar gecerli).
  perform pg_catalog.set_config('app.deal_stage_actor', p_actor_id::text, true);

  select d.* into v_deal
  from public.deals d
  where d.id = p_deal_id and d.tenant_id = p_tenant_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p_expected_stage is not null
     and v_deal.stage::text <> lower(btrim(p_expected_stage)) then
    return jsonb_build_object('outcome', 'conflict', 'current_stage', v_deal.stage);
  end if;
  if v_deal.stage = v_stage then
    return jsonb_build_object('outcome', 'replay', 'current_stage', v_stage);
  end if;
  if not (
    (v_deal.stage = 'new' and v_stage in ('qualified', 'lost'))
    or (v_deal.stage = 'qualified' and v_stage in ('negotiation', 'lost'))
    or (v_deal.stage = 'negotiation' and v_stage in ('won', 'lost'))
    or (v_deal.stage = 'won' and v_stage = 'negotiation')
    or (v_deal.stage = 'lost' and v_stage = 'negotiation')
  ) then
    return jsonb_build_object(
      'outcome', 'invalid_transition', 'current_stage', v_deal.stage,
      'requested_stage', v_stage
    );
  end if;
  if v_stage = 'lost' and nullif(btrim(coalesce(p_loss_reason, '')), '') is null then
    return jsonb_build_object('outcome', 'loss_reason_required');
  end if;

  if v_deal.stage = 'won' then
    if v_deal.deal_type = 'rent' and exists (
      select 1 from public.rentals r
      where r.tenant_id = p_tenant_id and r.deal_id = p_deal_id
    ) then
      return jsonb_build_object('outcome', 'rental_lifecycle_required');
    end if;
    select c.* into v_commission
    from public.commissions c
    where c.deal_id = p_deal_id and c.tenant_id = p_tenant_id
    for update;
    if found and v_commission.status in ('paid', 'collected') then
      return jsonb_build_object('outcome', 'commission_settled');
    end if;
    if found and exists (
      select 1 from public.payment_links pl
      where pl.tenant_id = p_tenant_id and pl.commission_id = v_commission.id
        and (
          pl.status in ('open', 'paid')
          or exists (
            select 1 from public.billing_payment_captures bpc
            where bpc.payment_link_id = pl.id
              and bpc.status <> 'refunded'
          )
        )
    ) then
      return jsonb_build_object('outcome', 'payment_in_progress');
    end if;
    if found then
      delete from public.commissions
      where id = v_commission.id and tenant_id = p_tenant_id;
    end if;

    update public.deals
    set stage = v_stage,
        closure_active = false,
        loss_reason = null,
        probability = 60,
        updated_at = v_now
    where id = p_deal_id and tenant_id = p_tenant_id and stage = 'won';
    if not found then
      raise exception 'Deal state changed while reopening.' using errcode = '40001';
    end if;

    if v_deal.property_id is not null
       and not exists (
         select 1 from public.deals d
         where d.tenant_id = p_tenant_id
           and d.property_id = v_deal.property_id
           and d.id <> p_deal_id and d.closure_active = true
       ) then
      update public.properties
      set status = case
            when v_deal.prev_property_status is null
              or v_deal.prev_property_status in ('sold', 'rented') then 'live'
            else v_deal.prev_property_status
          end,
          updated_at = v_now
      where id = v_deal.property_id and tenant_id = p_tenant_id
        and status = case when v_deal.deal_type = 'rent' then 'rented' else 'sold' end;
    end if;
  elsif v_stage = 'won' then
    if v_deal.property_id is null then
      return jsonb_build_object('outcome', 'property_required');
    end if;
    if v_deal.customer_id is null then
      return jsonb_build_object('outcome', 'customer_required');
    end if;
    if not exists (
      select 1 from public.customers c
      where c.id = v_deal.customer_id and c.tenant_id = p_tenant_id and c.deleted_at is null
    ) then
      return jsonb_build_object('outcome', 'customer_not_found');
    end if;

    select p.* into v_property
    from public.properties p
    where p.id = v_deal.property_id and p.tenant_id = p_tenant_id and p.deleted_at is null
    for update;
    if not found then
      return jsonb_build_object('outcome', 'property_not_found');
    end if;
    if exists (
      select 1 from public.deals d
      where d.tenant_id = p_tenant_id and d.property_id = v_deal.property_id
        and d.id <> p_deal_id and d.closure_active = true
    ) then
      return jsonb_build_object('outcome', 'property_already_closed');
    end if;
    if (v_deal.deal_type = 'sale' and v_property.status = 'rented')
       or (v_deal.deal_type = 'rent' and v_property.status = 'sold') then
      return jsonb_build_object('outcome', 'property_unavailable');
    end if;
    if v_deal.deal_type = 'rent' and exists (
      select 1 from public.rentals r
      where r.tenant_id = p_tenant_id
        and r.property_id = v_deal.property_id
        and r.status = 'active'
    ) then
      return jsonb_build_object('outcome', 'property_active_rental');
    end if;

    v_value := coalesce(nullif(v_deal.deal_value, 0), nullif(v_property.list_price, 0));
    if v_value is null or v_value <= 0 then
      return jsonb_build_object('outcome', 'deal_value_required');
    end if;
    if v_property.commission_rate is null
       or v_property.commission_rate <= 0
       or v_property.commission_rate > 100
       or round(v_property.commission_rate, 2) <> v_property.commission_rate then
      return jsonb_build_object('outcome', 'commission_rate_required');
    end if;
    v_rate := v_property.commission_rate;
    v_net := round(v_value * (v_rate / 100), 2);
    v_vat := round(v_net * 0.20, 2);
    v_advisor := round(v_net * 0.50, 2);
    v_target_property_status := case when v_deal.deal_type = 'rent' then 'rented' else 'sold' end;

    update public.deals
    set stage = 'won', deal_value = v_value, loss_reason = null,
        closure_active = true,
        prev_property_status = case
          when v_property.status in ('sold', 'rented') then coalesce(v_deal.prev_property_status, 'live')
          else v_property.status
        end,
        probability = 100, updated_at = v_now
    where id = p_deal_id and tenant_id = p_tenant_id and stage = v_deal.stage;
    if not found then
      raise exception 'Deal state changed while closing.' using errcode = '40001';
    end if;

    insert into public.commissions (
      tenant_id, deal_id, gross_amount, vat_amount, status, splits
    ) values (
      p_tenant_id, p_deal_id, v_net, v_vat, 'calculated',
      jsonb_build_array(
        jsonb_build_object('label', 'Danışman', 'rate', 50, 'amount', v_advisor),
        jsonb_build_object('label', 'Ofis', 'rate', 50, 'amount', v_net - v_advisor)
      )
    )
    on conflict (deal_id) where deal_id is not null do nothing;
    if not found then
      raise exception 'Commission already exists for open deal.' using errcode = '23505';
    end if;

    update public.properties
    set status = v_target_property_status, updated_at = v_now
    where id = v_deal.property_id and tenant_id = p_tenant_id;
    if not found then
      raise exception 'Property disappeared while closing deal.' using errcode = '40001';
    end if;
  else
    update public.deals
    set stage = v_stage,
        loss_reason = case when v_stage = 'lost' then btrim(p_loss_reason) else null end,
        probability = case v_stage
          when 'lost' then 0 when 'negotiation' then 60
          when 'qualified' then 40 else 20 end,
        updated_at = v_now
    where id = p_deal_id and tenant_id = p_tenant_id and stage = v_deal.stage;
    if not found then
      raise exception 'Deal state changed while transitioning.' using errcode = '40001';
    end if;
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value
  ) values (
    p_tenant_id, p_actor_id, 'deal.stage', 'deal', p_deal_id,
    jsonb_build_object('stage', v_deal.stage),
    jsonb_build_object('stage', v_stage, 'loss_reason', nullif(btrim(coalesce(p_loss_reason, '')), ''))
  );
  return jsonb_build_object(
    'outcome', 'applied', 'previous_stage', v_deal.stage, 'current_stage', v_stage,
    'property_id', v_deal.property_id, 'customer_id', v_deal.customer_id,
    'deal_type', v_deal.deal_type, 'deal_value', coalesce(v_value, v_deal.deal_value)
  );
end;
$$;
revoke all on function public.transition_deal_stage_atomic(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.transition_deal_stage_atomic(uuid, uuid, uuid, text, text, text)
  to service_role;

-- 6) Rapor yardimcilari (SECURITY INVOKER: cagiranin RLS'i gecerli; yalniz daraltir)
-- Ornek veri kapsami: src/lib/sample-scope.ts includeSample ile ayni esik (gercek musteri VE portfoy < esik ise ornekler dahil).
create or replace function public.report_sample_included(p_sample_threshold integer default 5)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select count(*) from public.customers c
      where c.tenant_id = public.current_active_tenant_id() and c.is_sample = false and c.deleted_at is null)
      < greatest(coalesce(p_sample_threshold, 5), 0)
    and
    (select count(*) from public.properties p
      where p.tenant_id = public.current_active_tenant_id() and p.is_sample = false and p.deleted_at is null)
      < greatest(coalesce(p_sample_threshold, 5), 0);
$$;

-- Sube / takim / danisman kapsamindaki profil kimlikleri; uc parametre de bossa NULL (= kisit yok).
create or replace function public.report_scope_member_ids(p_branch uuid default null, p_team uuid default null, p_profile uuid default null)
returns uuid[]
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when p_branch is null and p_team is null and p_profile is null then null
    else coalesce((
      select array_agg(p.id)
      from public.profiles p
      where p.tenant_id = public.current_active_tenant_id()
        and (p_profile is null or p.id = p_profile)
        and (p_team is null or p.team_id = p_team)
        and (p_branch is null or p.branch_id = p_branch)
    ), '{}'::uuid[])
  end;
$$;

revoke all on function public.report_sample_included(integer) from public, anon;
grant execute on function public.report_sample_included(integer) to authenticated, service_role;
revoke all on function public.report_scope_member_ids(uuid, uuid, uuid) from public, anon;
grant execute on function public.report_scope_member_ids(uuid, uuid, uuid) to authenticated, service_role;

-- 7) Satis hizi raporu: asamada gecen sure, asama donusumu, kapanis suresi, danisman kirilimi.
--    Donem [p_from, p_to] Istanbul takvim gunleri (dahil); karsilastirma ayni uzunlukta hemen onceki donem.
create or replace function public.deal_stage_velocity(
  p_from date,
  p_to date,
  p_branch uuid default null,
  p_team uuid default null,
  p_profile uuid default null,
  p_sample_threshold integer default 5
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_active_tenant_id();
  v_from timestamptz;
  v_to timestamptz;
  v_prev_from timestamptz;
  v_ids uuid[];
  v_include boolean;
  v_result jsonb;
begin
  if v_tenant is null or not public.has_effective_permission('reports', 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 1100 then
    raise exception 'invalid period' using errcode = '22023';
  end if;
  v_from := p_from::timestamp at time zone 'Europe/Istanbul';
  v_to := (p_to + 1)::timestamp at time zone 'Europe/Istanbul';
  v_prev_from := (p_from - ((p_to - p_from) + 1))::timestamp at time zone 'Europe/Istanbul';
  v_ids := public.report_scope_member_ids(p_branch, p_team, p_profile);
  v_include := public.report_sample_included(p_sample_threshold);

  with sd as (
    select d.id, d.stage, coalesce(d.deal_value, 0) as deal_value, d.assigned_to, d.created_at,
           d.closed_at, coalesce(d.stage_changed_at, d.created_at) as stage_changed_at
    from public.deals d
    where d.tenant_id = v_tenant
      and (v_include or d.is_sample = false)
      and (v_ids is null or d.assigned_to = any (v_ids))
  ),
  ev as (
    select e.deal_id, e.to_stage, e.changed_at,
           lead(e.changed_at) over w as next_at,
           lead(e.to_stage) over w as next_stage
    from public.deal_stage_events e
    join sd on sd.id = e.deal_id
    where e.tenant_id = v_tenant
    window w as (partition by e.deal_id order by e.changed_at, e.id)
  ),
  rnk(stage, ord) as (
    values ('new', 1), ('qualified', 2), ('negotiation', 3), ('won', 4)
  ),
  stays as (
    select ev.to_stage as stage,
           extract(epoch from (ev.next_at - ev.changed_at)) / 86400.0 as days,
           ev.next_stage,
           (select r.ord from rnk r where r.stage = ev.to_stage) as from_ord,
           (select r.ord from rnk r where r.stage = ev.next_stage) as to_ord
    from ev
    where ev.next_at is not null and ev.next_at >= v_from and ev.next_at < v_to
      and ev.to_stage in ('new', 'qualified', 'negotiation')
  ),
  stage_rows as (
    select r.stage, r.ord,
      (select count(*) from ev where ev.to_stage = r.stage and ev.changed_at >= v_from and ev.changed_at < v_to) as entered,
      count(st.stage) as exited,
      round(avg(st.days)::numeric, 1) as avg_days,
      round((percentile_cont(0.5) within group (order by st.days))::numeric, 1) as median_days,
      count(st.stage) filter (where st.to_ord is not null and st.to_ord > st.from_ord) as advanced,
      count(st.stage) filter (where st.next_stage = 'lost') as lost,
      (select count(*) from sd where sd.stage = r.stage) as open_now,
      (select coalesce(sum(sd.deal_value), 0) from sd where sd.stage = r.stage) as open_value,
      (select round(avg(extract(epoch from (now() - sd.stage_changed_at)) / 86400.0)::numeric, 1) from sd where sd.stage = r.stage) as open_avg_age_days,
      -- Tum zamanlar: bu asamaya girmis ve SONUCLANMIS anlasmalarda kazanma orani (asamaya ozel olasilik icin).
      (select count(distinct x.deal_id) from ev x join sd y on y.id = x.deal_id where x.to_stage = r.stage and y.stage = 'won') as hist_won,
      (select count(distinct x.deal_id) from ev x join sd y on y.id = x.deal_id where x.to_stage = r.stage and y.stage in ('won', 'lost')) as hist_closed
    from rnk r
    left join stays st on st.stage = r.stage
    where r.stage <> 'won'
    group by r.stage, r.ord
  ),
  closed as (
    select sd.*, extract(epoch from (sd.closed_at - sd.created_at)) / 86400.0 as cycle_days,
           (sd.closed_at >= v_from) as is_current
    from sd
    where sd.stage in ('won', 'lost') and sd.closed_at >= v_prev_from and sd.closed_at < v_to
  ),
  totals as (
    select
      count(*) filter (where is_current and stage = 'won') as won,
      count(*) filter (where is_current and stage = 'lost') as lost,
      coalesce(sum(deal_value) filter (where is_current and stage = 'won'), 0) as won_value,
      round(avg(cycle_days) filter (where is_current and stage = 'won')::numeric, 1) as avg_cycle_days,
      count(*) filter (where not is_current and stage = 'won') as prev_won,
      count(*) filter (where not is_current and stage = 'lost') as prev_lost,
      coalesce(sum(deal_value) filter (where not is_current and stage = 'won'), 0) as prev_won_value,
      round(avg(cycle_days) filter (where not is_current and stage = 'won')::numeric, 1) as prev_avg_cycle_days
    from closed
  ),
  open_now as (
    select count(*) as open_count, coalesce(sum(deal_value), 0) as open_value
    from sd where sd.stage in ('new', 'qualified', 'negotiation')
  ),
  advisors as (
    select sd.assigned_to as profile_id,
           max(p.full_name) as full_name,
           count(*) filter (where sd.stage in ('new', 'qualified', 'negotiation')) as open_count,
           coalesce(sum(sd.deal_value) filter (where sd.stage in ('new', 'qualified', 'negotiation')), 0) as open_value,
           count(*) filter (where sd.stage = 'won' and sd.closed_at >= v_from and sd.closed_at < v_to) as won,
           count(*) filter (where sd.stage = 'lost' and sd.closed_at >= v_from and sd.closed_at < v_to) as lost,
           coalesce(sum(sd.deal_value) filter (where sd.stage = 'won' and sd.closed_at >= v_from and sd.closed_at < v_to), 0) as won_value,
           round(avg(extract(epoch from (sd.closed_at - sd.created_at)) / 86400.0)
             filter (where sd.stage = 'won' and sd.closed_at >= v_from and sd.closed_at < v_to)::numeric, 1) as avg_cycle_days
    from sd
    left join public.profiles p on p.id = sd.assigned_to and p.tenant_id = v_tenant
    where sd.assigned_to is not null
    group by sd.assigned_to
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'sample_included', v_include,
    'stages', coalesce((select jsonb_agg(to_jsonb(s) - 'ord' order by s.ord) from stage_rows s), '[]'::jsonb),
    'totals', (select to_jsonb(t) from totals t),
    'open', (select to_jsonb(o) from open_now o),
    'advisors', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.won_value desc, a.won desc, a.open_value desc)
      from advisors a
      where a.open_count > 0 or a.won > 0 or a.lost > 0
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.deal_stage_velocity(date, date, uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.deal_stage_velocity(date, date, uuid, uuid, uuid, integer) to authenticated;

comment on function public.deal_stage_velocity(date, date, uuid, uuid, uuid, integer) is
  'SP1: satis hizi raporu (asamada gecen gun, asama donusumu, kapanis suresi, danisman kirilimi). SECURITY INVOKER; RLS + kapsam gecerli.';
