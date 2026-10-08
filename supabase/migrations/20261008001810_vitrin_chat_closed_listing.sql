-- Vitrin AI sohbet baglami: KAPALI portfoy sizintisi duzeltmesi.
--
-- SORUN: vitrin_chat_context (20261007000330) ilani yalniz status/deleted_at/is_sample ile suzuyordu; `features.closed_listing`
--   (kapali/gizli portfoy, bkz. src/lib/closed-listing.ts) bilinmedigi icin kapali bir ilanin public bilgileri sohbet baglamina
--   donebiliyordu. Diger tum public yuzeyler kapali portfoyu zaten eler.
-- DUZELTME: ayni govde BAYT BAYT korunur; yalniz ilan sorgusuna `features->>'closed_listing'` "true" degil kosulu eklenir
--   (anahtar yok/NULL = acik). Imza, ACL ve donus bicimi degismez.
-- BAGIMLILIK: 20261007000330_vitrin_chat_context.sql (fonksiyon yoksa durur).
-- GERI ALMA: rollbacks/20261008001810_vitrin_chat_closed_listing.rollback.sql (000330 govdesine doner). RISK: dusuk.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regprocedure('public.vitrin_chat_context(text,uuid)') is null then
    raise exception 'vitrin_chat_context (20261007000330) yok.';
  end if;
end $$;

create or replace function public.vitrin_chat_context(p_slug text, p_property_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant record;
  v_enabled boolean;
  v_facts jsonb;
begin
  if p_slug is null or char_length(p_slug) > 120 or p_property_id is null then
    return jsonb_build_object('ok', false);
  end if;
  select t.id, t.name into v_tenant
    from public.tenants t
   where t.slug = p_slug and t.status in ('active', 'trial', 'past_due');
  if v_tenant.id is null then
    return jsonb_build_object('ok', false);
  end if;
  select coalesce(s.value in ('"on"'::jsonb, 'true'::jsonb, '"true"'::jsonb), false) into v_enabled
    from public.tenant_settings s
   where s.tenant_id = v_tenant.id and s.key = 'office.vitrin.ai_chat_enabled';
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('ok', false);
  end if;
  select jsonb_build_object(
           'title', p.title,
           'code', p.property_code,
           'transaction_type', p.transaction_type,
           'property_type', p.property_type,
           'list_price', p.list_price,
           'rooms', p.features->>'rooms',
           'sqm', p.features->>'sqm',
           'floor', p.features->>'floor',
           'building_age', p.features->>'building_age',
           'heating', p.features->>'heating',
           'description', left(coalesce(p.features->>'description', ''), 2000),
           'district', gd.name,
           'province', gp.name
         ) into v_facts
    from public.properties p
    left join public.geo_districts gd on gd.id = p.district_id
    left join public.geo_provinces gp on gp.id = p.province_id
   where p.id = p_property_id and p.tenant_id = v_tenant.id
     and p.status = 'live' and p.deleted_at is null and p.is_sample = false
     and (p.features->>'closed_listing') is distinct from 'true';
  if v_facts is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'tenant_id', v_tenant.id, 'office', v_tenant.name, 'facts', v_facts);
end;
$$;

revoke all on function public.vitrin_chat_context(text, uuid) from public;
grant execute on function public.vitrin_chat_context(text, uuid) to anon, authenticated, service_role;

comment on function public.vitrin_chat_context(text, uuid) is
  'Vitrin AI sohbeti: ofis ayari acik + ilan yayinda ve KAPALI DEGIL ise yalniz public ilan alanlari; aksi halde {ok:false}.';

notify pgrst, 'reload schema';
