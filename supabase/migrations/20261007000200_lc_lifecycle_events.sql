-- MIGRATION 20261007000200_lc_lifecycle_events.sql
-- UYGULANMADI (DOGRULANMADI): yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261007000200_lc_lifecycle_events.sql` ile uygular (PB46, 000210 ve 000220'den ONCE).
-- Geri alma: supabase/rollbacks/20261007000200_lc_lifecycle_events.rollback.sql
-- BAGIMLILIK: 20260826002040 (property_control_state), 20260826002010 (lc_row_visible), property_status_history,
--   portal_listings, listing_closures (init). pool_assignments (20261006000510) VARSA atama yapanini okur (yoksa atlanir).
--
-- AMAC (yasam dongusu kaydi): portfoyun TURETILMIS yasam dongusu asama gecislerini (property_control_state.lifecycle_stage)
-- zaman + kullanici + neden ile APPEND-ONLY kaydeder. Eskiden yalniz son asamanin baslangici (stage_since) vardi.
-- KARAR: property_status_history GENISLETILMEDI. O tablo CRM'deki serbest metin `properties.status` gecislerini tutar ve X9
--   portfoy zaman tuneli (src/app/actions/property-timeline.ts) satirlarini "durum" olayi olarak okur; turetilmis asama
--   degerlerini oraya yazmak iki farkli anlami tek kolonda karistirirdi. Yeni tablo yalniz bu ise ayrilir.
-- KULLANICI: asamayi motor (service_role cron) yazdigi icin auth.uid() cogu zaman bostur. Bu durumda kullanici ILGILI
--   KAYNAKTAN cikarilir ve `actor_source = 'inferred'` ile ETIKETLENIR (sahte kesinlik yok):
--     satildi/kiralandi/cikis -> son 7 gundeki property_status_history.changed_by (+ neden), yoksa listing_closures.created_by
--     yayinda/pazarlama      -> canli portal ilaninin published_by'i
--     atandi                 -> pool_assignments.assigned_by (tablo varsa)
--   Bulunamazsa actor_id null, actor_source 'system' ("sistem tespit etti").
-- Tetikleyici olay yazimi ASIL yazimi ASLA bozmaz (hata yutulur). Ornek veri (is_sample) icin olay yazilmaz.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.property_control_state') is null
     or pg_catalog.to_regclass('public.property_status_history') is null
     or pg_catalog.to_regclass('public.listing_closures') is null
     or not exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = 'lc_row_visible') then
    raise exception 'property_control_state/property_status_history/listing_closures/lc_row_visible yok; once 20260826002010..002040 uygulanmali.';
  end if;
end $$;

create table if not exists public.lc_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  property_id uuid not null,
  branch_id uuid,
  team_id uuid,
  advisor_id uuid,
  from_stage text check (from_stage is null or from_stage in
    ('new', 'pool', 'assigned', 'preparing', 'ready', 'published', 'marketing', 'offer', 'negotiation', 'deposit',
     'sold', 'rented', 'exited')),
  to_stage text not null check (to_stage in
    ('new', 'pool', 'assigned', 'preparing', 'ready', 'published', 'marketing', 'offer', 'negotiation', 'deposit',
     'sold', 'rented', 'exited')),
  exit_kind text check (exit_kind is null or exit_kind in
    ('sold', 'rented', 'cancelled', 'authority_expired', 'owner_withdrew', 'other_agency', 'portal_removed', 'passive', 'duplicate')),
  actor_id uuid,
  actor_source text not null default 'system' check (actor_source in ('user', 'inferred', 'system')),
  reason text check (reason is null or char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  constraint lc_lifecycle_events_property_tenant_fkey
    foreign key (property_id, tenant_id) references public.properties (id, tenant_id) on delete cascade
);
create index if not exists idx_lc_lifecycle_events_property on public.lc_lifecycle_events (tenant_id, property_id, created_at desc);
create index if not exists idx_lc_lifecycle_events_tenant on public.lc_lifecycle_events (tenant_id, created_at desc);

alter table public.lc_lifecycle_events enable row level security;
drop policy if exists lc_lifecycle_events_select on public.lc_lifecycle_events;
create policy lc_lifecycle_events_select on public.lc_lifecycle_events for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('portals', 'view'))
  and (select public.lc_row_visible(branch_id, team_id, advisor_id))
);

-- APPEND-ONLY: kimseye update/delete verilmez; yazim yalniz tetikleyici (definer) ile.
revoke all on table public.lc_lifecycle_events from public, anon, authenticated, service_role;
grant select on table public.lc_lifecycle_events to authenticated;
grant select on table public.lc_lifecycle_events to service_role;

create or replace function public.lc_record_lifecycle_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_source text := 'system';
  v_reason text;
begin
  if new.is_sample then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.lifecycle_stage is not distinct from new.lifecycle_stage then
    return null;
  end if;
  begin
    v_actor := auth.uid();
    if v_actor is not null then
      v_source := 'user';
    elsif new.lifecycle_stage in ('sold', 'rented', 'exited') then
      select h.changed_by,
             left(coalesce(nullif(btrim(h.reason), ''), nullif(to_jsonb(h) ->> 'reason_code', ''),
                           coalesce(h.old_status, '-') || ' -> ' || h.new_status), 300)
        into v_actor, v_reason
        from public.property_status_history h
       where h.tenant_id = new.tenant_id and h.property_id = new.property_id
         and h.created_at > now() - interval '7 days'
       order by h.created_at desc
       limit 1;
      if v_actor is null then
        select c.created_by, left(c.reason, 300) into v_actor, v_reason
          from public.listing_closures c
          join public.portal_listings pl on pl.id = c.portal_listing_id and pl.tenant_id = c.tenant_id
         where c.tenant_id = new.tenant_id and pl.property_id = new.property_id
           and c.created_at > now() - interval '7 days'
         order by c.created_at desc
         limit 1;
      end if;
    elsif new.lifecycle_stage in ('published', 'marketing') then
      select pl.published_by, left('Portal: ' || pl.portal_name, 300) into v_actor, v_reason
        from public.portal_listings pl
       where pl.tenant_id = new.tenant_id and pl.property_id = new.property_id and pl.status = 'live'
       order by pl.published_at desc nulls last
       limit 1;
    elsif new.lifecycle_stage = 'assigned' and pg_catalog.to_regclass('public.pool_assignments') is not null then
      begin
        execute 'select assigned_by, left(reason, 300) from public.pool_assignments
                  where tenant_id = $1 and property_id = $2 and status = ''active''
                  order by created_at desc limit 1'
          into v_actor, v_reason
          using new.tenant_id, new.property_id;
      exception when others then
        v_actor := null;
      end;
    end if;
    if v_source = 'system' and v_actor is not null then
      v_source := 'inferred';
    end if;
    insert into public.lc_lifecycle_events
      (tenant_id, property_id, branch_id, team_id, advisor_id, from_stage, to_stage, exit_kind, actor_id, actor_source, reason)
    values
      (new.tenant_id, new.property_id, new.branch_id, new.team_id, new.advisor_id,
       case when tg_op = 'UPDATE' then old.lifecycle_stage end, new.lifecycle_stage, new.exit_kind,
       v_actor, v_source, v_reason);
  exception when others then
    null;
  end;
  return null;
end;
$$;
revoke all on function public.lc_record_lifecycle_event() from public, anon, authenticated, service_role;

drop trigger if exists trg_lc_lifecycle_event on public.property_control_state;
create trigger trg_lc_lifecycle_event after insert or update of lifecycle_stage on public.property_control_state
  for each row execute function public.lc_record_lifecycle_event();

notify pgrst, 'reload schema';
