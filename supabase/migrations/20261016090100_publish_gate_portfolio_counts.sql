-- MIGRATION 20261016090100_publish_gate_portfolio_counts.sql
-- SK9 (2026-10-16): yayin kapisi DB kopyasi (B163), aktif satilik stok sayimi (B084), portalda varlik tek tanimi (B083).
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI `npm run db:migrate` ile uygular.
-- Geri alma: supabase/rollbacks/20261016090100_publish_gate_portfolio_counts.rollback.sql
-- BAGIMLILIK: 20261016090000_property_currency.sql (properties.currency), 20261012002200 (portfolio_counts),
--   20260813000000 (transition_property_status_atomic), public.property_owner_info, public.customers.
--
-- (1) portfolio_counts: imza AYNI, ciktiya uc alan eklenir (eski alanlar ayni):
--     sale_stock_value   = Satilik ∧ status ∈ (live, reserved) ∧ ornek degil ∧ ₺ fiyatli kayitlarin list_price toplami
--                          (kabul SQL'i: select sum(list_price) ... transaction_type='Satılık' and status in ('live','reserved')
--                          and deleted_at is null and is_sample=false; doviz fiyatlar ₺ toplamina KARISTIRILMAZ),
--     sale_stock_fx      = ayni kumenin doviz kismi kendi biriminde {USD, EUR},
--     rent_monthly_total = Kiralik ∧ status ∈ (live, reserved) ∧ ornek degil ∧ ₺ aylik kira toplami.
--     Eskiden "Portfoy degeri" kesik taramanin TUM list_price toplamiydi (satilmis + taslak + aylik kiralar).
-- (2) transition_property_status_atomic: govde AYNI + 'live' gecisinde yayin kapisi (uygulama kapisi
--     src/lib/property-owner/server.ts publishBlockReasons ile ayni kural): il ve ilce secili, ilan sahibi kaydi var ve
--     zorunlu alanlari tam (musteri + telefonu, iliski, tapu durumu, yetki turu, tek/sinirli yetkide gecerli tarih
--     araligi, ilan kaynagi, KVKK onayi). Admin client (service_role) yazmasi da sinanir. Zaten live olan kayit
--     (replay) engellenmez. Engelde hicbir satir degismez: {outcome:'publish_blocked', blocked_ids:[...]}.
-- (3) property_portal_presence(kayit_durumu, tarayici_durumu): 'yayinda_dogrulandi' | 'yayinda_teyitsiz' | 'kaldirildi'
--     (TS kopyasi src/lib/listing-control/kpi.ts portalPresence; sozlesme testi esitligi kilitler).
-- ETKI: davranis (yayin kapisi siki; sayim ciktisi genisler). Tablo/politika/veri degismez. Idempotent (create or replace).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.properties') is null
     or pg_catalog.to_regclass('public.property_owner_info') is null
     or pg_catalog.to_regclass('public.customers') is null then
    raise exception 'public.properties / property_owner_info / customers yok.';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'properties' and column_name = 'currency'
  ) then
    raise exception 'properties.currency yok: once 20261016090000_property_currency.sql uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.current_tenant_id()') is null then
    raise exception 'current_tenant_id() yok.';
  end if;
end $$;

-- (1) Portfoy sayimlari ------------------------------------------------------------------------------------------------
create or replace function public.portfolio_counts(
  p_owner_ids uuid[] default null,
  p_live text[] default '{}',
  p_pending text[] default '{}',
  p_draft text[] default '{}',
  p_green text[] default '{}',
  p_yellow text[] default '{}',
  p_red text[] default '{}',
  p_recent_since timestamptz default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select case when auth.uid() is null or public.current_tenant_id() is null then null else (
    select jsonb_build_object(
      'total', count(*),
      'live', count(*) filter (where p.status = any(p_live)),
      'pending', count(*) filter (where p.status = any(p_pending)),
      'draft', count(*) filter (where p.status = any(p_draft)),
      'sale', count(*) filter (where p.transaction_type = 'Satılık'),
      'rent', count(*) filter (where p.transaction_type = 'Kiralık'),
      'recent', count(*) filter (where p_recent_since is not null and p.created_at >= p_recent_since),
      'green', count(*) filter (where p.price_health = any(p_green)),
      'yellow', count(*) filter (where p.price_health = any(p_yellow)),
      'red', count(*) filter (where p.price_health = any(p_red)),
      'sale_stock_value', coalesce(sum(p.list_price) filter (
        where p.transaction_type = 'Satılık' and p.status in ('live', 'reserved')
          and p.is_sample is not true and p.currency = 'TRY'), 0),
      'sale_stock_fx', jsonb_build_object(
        'USD', coalesce(sum(p.list_price) filter (
          where p.transaction_type = 'Satılık' and p.status in ('live', 'reserved')
            and p.is_sample is not true and p.currency = 'USD'), 0),
        'EUR', coalesce(sum(p.list_price) filter (
          where p.transaction_type = 'Satılık' and p.status in ('live', 'reserved')
            and p.is_sample is not true and p.currency = 'EUR'), 0)
      ),
      'rent_monthly_total', coalesce(sum(p.list_price) filter (
        where p.transaction_type = 'Kiralık' and p.status in ('live', 'reserved')
          and p.is_sample is not true and p.currency = 'TRY'), 0)
    )
    from public.properties p
    where p.tenant_id = public.current_tenant_id()
      and p.deleted_at is null
      and (p_owner_ids is null or p.assigned_to = any(p_owner_ids))
  ) end;
$$;

-- (2) Yayin kapisi (DB kopyasi) ----------------------------------------------------------------------------------------
create or replace function public.transition_property_status_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_property_ids uuid[],
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_expected integer;
  v_found integer;
  v_updated integer;
  v_blocked uuid[];
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  v_expected := coalesce(cardinality(p_property_ids), 0);
  if p_tenant_id is null or p_actor_id is null or v_expected not between 1 and 50
     or v_status not in (
       'draft', 'pending_docs', 'pending_auth', 'photo_needed', 'ready', 'active',
       'live', 'passive', 'reserved', 'deposit', 'in_progress', 'withdrawn',
       'auth_expired', 'archived'
     )
     or char_length(coalesce(p_reason, '')) > 500
     or exists (select 1 from unnest(p_property_ids) x where x is null)
     or (select count(distinct x) from unnest(p_property_ids) x) <> v_expected then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select count(*) into v_found from (
    select p.id from public.properties p
    where p.tenant_id = p_tenant_id and p.id = any(p_property_ids)
      and p.deleted_at is null
    for update
  ) locked;
  if v_found <> v_expected then return jsonb_build_object('outcome', 'not_found'); end if;
  if exists (
    select 1 from public.properties p
    where p.tenant_id = p_tenant_id and p.id = any(p_property_ids)
      and p.status in ('sold', 'rented')
  ) then
    return jsonb_build_object('outcome', 'terminal_requires_workflow');
  end if;

  -- SK9 yayin kapisi: 'live'a GECEN her kayit il + ilce + tamamlanmis ilan sahibi kaydi ister (zaten live olan atlanir).
  if v_status = 'live' then
    select coalesce(array_agg(p.id order by p.id), '{}'::uuid[]) into v_blocked
    from public.properties p
    left join public.property_owner_info oi
      on oi.property_id = p.id and oi.tenant_id = p.tenant_id
    left join public.customers c
      on c.id = oi.customer_id and c.tenant_id = p.tenant_id
    where p.tenant_id = p_tenant_id and p.id = any(p_property_ids)
      and p.status is distinct from 'live'
      and (
        p.province_id is null
        or p.district_id is null
        or oi.id is null
        or oi.customer_id is null
        or nullif(btrim(coalesce(c.phone, '')), '') is null
        or oi.relation is null
        or oi.deed_status is null
        or coalesce(p.authorization_type, '') not in ('exclusive', 'open', 'limited')
        or (p.authorization_type in ('exclusive', 'limited')
            and (p.authorization_start is null or p.authorization_end is null
                 or p.authorization_end < p.authorization_start))
        or nullif(btrim(coalesce(oi.listing_source, '')), '') is null
        or oi.kvkk_consent is not true
      );
    if cardinality(v_blocked) > 0 then
      return jsonb_build_object('outcome', 'publish_blocked', 'blocked_ids', to_jsonb(v_blocked));
    end if;
  end if;

  perform set_config('app.property_status_actor', p_actor_id::text, true);
  perform set_config('app.property_status_reason', coalesce(nullif(btrim(p_reason), ''), ''), true);
  update public.properties
  set status = v_status,
      updated_at = v_now,
      published_at = case
        when v_status = 'live' and published_at is null then v_now
        else published_at end
  where tenant_id = p_tenant_id and id = any(p_property_ids)
    and status is distinct from v_status;
  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    return jsonb_build_object('outcome', 'replay', 'updated_count', 0);
  end if;
  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, new_value
  ) values (
    p_tenant_id, p_actor_id, 'property.status.bulk', 'property',
    jsonb_build_object('ids', to_jsonb(p_property_ids), 'status', v_status,
      'count', v_updated, 'reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );
  return jsonb_build_object('outcome', 'applied', 'updated_count', v_updated);
end;
$function$;

revoke all on function public.transition_property_status_atomic(uuid, uuid, uuid[], text, text) from public, anon, authenticated;
grant execute on function public.transition_property_status_atomic(uuid, uuid, uuid[], text, text) to service_role;

-- (3) Portalda varlik tek tanimi ---------------------------------------------------------------------------------------
create or replace function public.property_portal_presence(p_registry_status text, p_check_state text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select case
    when lower(coalesce(p_registry_status, '')) <> 'live' then 'kaldirildi'
    when p_check_state = 'verified' then 'yayinda_dogrulandi'
    else 'yayinda_teyitsiz'
  end;
$$;

comment on function public.property_portal_presence(text, text) is
  'SK9/B083 tek tanim: kayit live ∧ tarayici verified → yayinda_dogrulandi; kayit live → yayinda_teyitsiz; aksi kaldirildi. TS kopyasi listing-control/kpi.ts portalPresence.';

revoke all on function public.property_portal_presence(text, text) from public, anon;
grant execute on function public.property_portal_presence(text, text) to authenticated, service_role;
