-- SN5 (2026-10-14): ofis bazinda KURULUM ILERLEMESI girdileri (admin toplu liste, Ofis 360, saglik skoru).
--
-- Kurulum sihirbazinin "tamamlandi" kurallari kodda kalir (src/lib/onboarding-steps.ts `isDone`); bu fonksiyon yalniz
-- ayni kurallarin OFIS DUZEYINDEKI olgularini tek turda toplar. Kullaniciya ozel "Sen ve uzmanligin" adimi ofis
-- duzeyinde ofis sahiplerinden (owner) en az birinin unvan + uzmanlik/bolge kaydi olarak okunur.
-- Yalniz service_role (platform personeli sunucu tarafi). Tablo/veri DEGISMEZ: yeni salt-okunur fonksiyon (etki: ek).
--
-- Sutunlar:
--   province_id / district_id / address_line / license_no : "Ofis" ve "Yetki belgesi" adimlari (profil tamamlama kurali)
--   owner_you_done       : bir sahibin unvani + uzmanlik ya da bolge kaydi var mi
--   members              : ofisteki kullanici (profil) sayisi
--   pool_enabled / pool_advisor_records : havuz acik mi + ornek olmayan uzmanlik/bolge kaydi
--   published_properties : yayin tarihi dolu, ornek olmayan portfoy
--   active_integrations  : aktif netgsm/whatsapp entegrasyonu
--   sub_status           : abonelik durumu (aktif = ucretli)
--   office_finance / office_recurring : ofis hesabi (arsivsiz) / ofis duzenli odeme kurali
--   rentals_answered     : mulk yonetimi sorusu cevaplandi mi (tenant_modules rentals satiri)
--   portal_declared      : sahibin beyan ettigi portal uyeligi sayisi
--   eids_received        : etkin EIDS alma adresine e-posta ulasti mi
create or replace function public.platform_tenant_onboarding_facts(p_tenant_id uuid default null)
returns table (
  tenant_id uuid,
  tenant_name text,
  status text,
  plan text,
  created_at timestamptz,
  province_id text,
  district_id text,
  address_line text,
  license_no text,
  owner_you_done boolean,
  members integer,
  pool_enabled boolean,
  pool_advisor_records integer,
  published_properties integer,
  active_integrations integer,
  sub_status text,
  office_finance integer,
  office_recurring integer,
  rentals_answered boolean,
  portal_declared integer,
  eids_received boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select x.id, x.name, x.status, x.plan, x.created_at, x.province_id::text as province_id, x.district_id::text as district_id,
      x.address_line, x.license_no, coalesce(x.listing_pool_enabled, false) as pool_enabled
    from public.tenants x
    where x.status <> 'cancelled' and (p_tenant_id is null or x.id = p_tenant_id)
  ),
  pr as (
    select p.tenant_id, count(*)::int as n from public.profiles p join t on t.id = p.tenant_id group by p.tenant_id
  ),
  yo as (
    select distinct p.tenant_id
    from public.profiles p
    join t on t.id = p.tenant_id
    where p.role = 'owner' and btrim(coalesce(p.title, '')) <> ''
      and (exists (select 1 from public.advisor_specialties s where s.profile_id = p.id)
        or exists (select 1 from public.advisor_regions r where r.profile_id = p.id))
  ),
  pa as (
    select z.tenant_id, sum(z.n)::int as n from (
      select s.tenant_id, count(*) as n from public.advisor_specialties s join t on t.id = s.tenant_id where s.is_sample = false group by s.tenant_id
      union all
      select r.tenant_id, count(*) as n from public.advisor_regions r join t on t.id = r.tenant_id where r.is_sample = false group by r.tenant_id
    ) z group by z.tenant_id
  ),
  pp as (
    select p.tenant_id, count(*)::int as n from public.properties p join t on t.id = p.tenant_id
    where p.is_sample = false and p.published_at is not null group by p.tenant_id
  ),
  ig as (
    select i.tenant_id, count(*)::int as n from public.tenant_integrations i join t on t.id = i.tenant_id
    where i.is_active = true and i.provider in ('netgsm', 'whatsapp') group by i.tenant_id
  ),
  sb as (
    select distinct on (s.tenant_id) s.tenant_id, s.status
    from public.subscriptions s join t on t.id = s.tenant_id
    order by s.tenant_id, (s.status = 'active') desc, s.updated_at desc nulls last
  ),
  fa as (
    select a.tenant_id, count(*)::int as n from public.finance_accounts a join t on t.id = a.tenant_id
    where a.owner_scope = 'office' and a.archived_at is null group by a.tenant_id
  ),
  rr as (
    select r.tenant_id, count(*)::int as n from public.recurring_rules r join t on t.id = r.tenant_id
    where r.scope = 'office' group by r.tenant_id
  ),
  rm as (
    select distinct m.tenant_id from public.tenant_modules m join t on t.id = m.tenant_id where m.module_key = 'rentals'
  ),
  pd as (
    select a.tenant_id, count(*)::int as n from public.tenant_portal_accounts a join t on t.id = a.tenant_id
    where a.source = 'owner_declared' group by a.tenant_id
  ),
  ei as (
    select distinct e.tenant_id from public.eids_inbound_addresses e join t on t.id = e.tenant_id
    where e.revoked_at is null and e.last_received_at is not null
  )
  select t.id, t.name, t.status, t.plan, t.created_at, t.province_id, t.district_id, t.address_line, t.license_no,
    (yo.tenant_id is not null), coalesce(pr.n, 0), t.pool_enabled, coalesce(pa.n, 0), coalesce(pp.n, 0), coalesce(ig.n, 0),
    sb.status, coalesce(fa.n, 0), coalesce(rr.n, 0), (rm.tenant_id is not null), coalesce(pd.n, 0), (ei.tenant_id is not null)
  from t
  left join pr on pr.tenant_id = t.id
  left join yo on yo.tenant_id = t.id
  left join pa on pa.tenant_id = t.id
  left join pp on pp.tenant_id = t.id
  left join ig on ig.tenant_id = t.id
  left join sb on sb.tenant_id = t.id
  left join fa on fa.tenant_id = t.id
  left join rr on rr.tenant_id = t.id
  left join rm on rm.tenant_id = t.id
  left join pd on pd.tenant_id = t.id
  left join ei on ei.tenant_id = t.id
  order by t.created_at desc, t.id;
$$;

revoke all on function public.platform_tenant_onboarding_facts(uuid) from public, anon, authenticated;
grant execute on function public.platform_tenant_onboarding_facts(uuid) to service_role;

comment on function public.platform_tenant_onboarding_facts(uuid) is
  'SN5: ofis bazinda kurulum sihirbazi olgulari (salt okunur, service_role). Tamamlanma kurallari kodda (onboarding-steps.ts).';
