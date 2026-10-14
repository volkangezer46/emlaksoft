-- MIGRATION 20261015041000_demo_tenant_nightly_reset.sql
-- YD1 (2026-10-15): demo kiracinin ('demo-ofis') verisini gece sifirlayan SERVICE_ROLE fonksiyonu + taban durum tablosu.
-- Geri alma: supabase/rollbacks/20261015041000_demo_tenant_nightly_reset.rollback.sql
-- BAGIMLILIK: public.tenants (id, slug). Temizlenen tablolar calisma aninda to_regclass ile aranir; olmayan atlanir.
--
-- AMAC: giris sayfasindaki demo kartlari herkese acik; ziyaretciler demo ofise kayit ekliyor, API anahtari/webhook/
--   entegrasyon tanimlayabiliyor. Gece cron'u (operational-retention, ayri adim `demoReset`) bu fonksiyonu cagirir:
--   (1) dis baglanti yuzeyleri (api_keys, webhook_endpoints, webhook_deliveries, tenant_integrations) demo kiracida
--       TAMAMEN silinir (demo ofiste bunlarin hic olmamasi gerekir);
--   (2) created_at kolonu OLMAYAN ve ON DELETE NO ACTION ile musteri/anlasmaya bagli tablolar (calls, referrals,
--       surveys) once, tabandan sonra eklenen musteri/anlasmaya BAGLI satirlari uzerinden silinir; aksi halde bu
--       satirlar customers/deals silmesini kalici olarak (her gece) engellerdi;
--   (3) TABANDAN SONRA eklenen is kayitlari (created_at > baseline_at ve <= now()) silinir: musteri, portfoy, anlasma,
--       randevu, gorev ... (asagidaki sabit liste; once cocuk tablolar). Taban ilk cagrida now() olarak yazilir ve
--       `npm run seed:demo` her calistiginda yeniden yazilir (tohumlanan veri silinmez). Gelecek tarihli tohum satirlari
--       (created_at > now()) dokunulmaz.
--   Ziyaretcinin TOHUM kayitlarinda yaptigi DUZENLEMELER geri alinmaz; tam geri donus `npm run seed:demo` ile yapilir.
--
-- GUVENLIK: fonksiyon kimligi verilen kiracinin slug'ini KENDISI dogrular; 'demo-ofis' degilse HATA verir ve hicbir
--   satira dokunmaz (gercek kiraciya yanlislikla cagrilamaz). SECURITY DEFINER; yalniz service_role calistirir.
--   Her tablo ayri alt blokta: FK engeli olan tablo atlanir ve sonuca yazilir, digerleri surer.
-- ETKI: yeni tablo + yeni fonksiyon (ek). Mevcut tablo/politika degismez. Idempotent (if not exists / create or replace).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.tenants') is null then
    raise exception 'public.tenants yok.';
  end if;
end $$;

create table if not exists public.demo_reset_state (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  baseline_at timestamptz not null,
  last_reset_at timestamptz,
  last_result jsonb
);

alter table public.demo_reset_state enable row level security;
revoke all on table public.demo_reset_state from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on table public.demo_reset_state from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on table public.demo_reset_state from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant select, insert, update, delete on table public.demo_reset_state to service_role';
  end if;
end $$;

comment on table public.demo_reset_state is
  'YD1: demo kiracinin gece sifirlama tabani. baseline_at sonrasi eklenen is kayitlari demo_tenant_nightly_reset ile silinir.';

create or replace function public.demo_tenant_nightly_reset(p_tenant_id uuid, p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_slug text;
  v_baseline timestamptz;
  v_table text;
  v_n bigint;
  v_deleted jsonb := '{}'::jsonb;
  v_skipped jsonb := '{}'::jsonb;
  v_result jsonb;
  v_dep text[];
  -- Dis baglanti yuzeyleri: demo ofiste HIC olmamali (tarih kosulu yok).
  v_outbound text[] := array['webhook_deliveries', 'webhook_endpoints', 'api_keys', 'tenant_integrations'];
  -- Tabandan sonra eklenen is kayitlari; SIRA ONEMLI (once cocuk, sonra ebeveyn).
  v_business text[] := array[
    'notifications', 'communications', 'payment_links', 'deal_notes', 'deal_costs', 'deal_checklist_items', 'deal_process_steps',
    'commission_payouts', 'commission_splits', 'commissions', 'offer_rounds', 'offers', 'contracts',
    'rent_payments', 'rent_charges', 'rent_reminders', 'rentals', 'appointments', 'tasks', 'approval_comments',
    'approval_requests', 'presentations', 'share_links', 'open_houses', 'valuations', 'property_key_events',
    'property_keys', 'customer_demands', 'deals', 'cash_entries', 'expenses', 'campaigns', 'automations',
    'message_templates', 'saved_views', 'targets', 'playbooks', 'projects', 'properties', 'customers'
  ];
  -- Musteri/anlasmaya NO ACTION FK ile bagli bagimli tablolar: {tablo, kolon, ebeveyn}. Tabandan sonra eklenen
  -- ebeveyne bagli satirlar silinir (created_at'e bakilmaz; calls/surveys'te bu kolon yok).
  v_dependents text[] := array[
    'calls:customer_id:customers', 'referrals:created_customer_id:customers', 'referrals:referrer_customer_id:customers',
    'surveys:deal_id:deals', 'surveys:customer_id:customers'
  ];
begin
  if p_tenant_id is null then
    raise exception 'demo_reset_tenant_required';
  end if;
  select t.slug into v_slug from public.tenants t where t.id = p_tenant_id;
  if v_slug is distinct from 'demo-ofis' then
    raise exception 'demo_reset_not_demo_tenant' using errcode = '42501';
  end if;

  select s.baseline_at into v_baseline from public.demo_reset_state s where s.tenant_id = p_tenant_id for update;
  if v_baseline is null then
    insert into public.demo_reset_state(tenant_id, baseline_at, last_reset_at, last_result)
    values (p_tenant_id, p_now, p_now, jsonb_build_object('baseline_set', true))
    on conflict (tenant_id) do update set baseline_at = excluded.baseline_at;
    v_baseline := p_now;
  end if;

  foreach v_table in array v_outbound loop
    if pg_catalog.to_regclass('public.' || v_table) is null then continue; end if;
    begin
      execute format('delete from public.%I where tenant_id = $1', v_table) using p_tenant_id;
      get diagnostics v_n = row_count;
      if v_n > 0 then v_deleted := v_deleted || jsonb_build_object(v_table, v_n); end if;
    exception when others then
      v_skipped := v_skipped || jsonb_build_object(v_table, sqlstate);
    end;
  end loop;

  foreach v_table in array v_dependents loop
    v_dep := string_to_array(v_table, ':');
    if pg_catalog.to_regclass('public.' || v_dep[1]) is null then continue; end if;
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = v_dep[1] and c.column_name = v_dep[2]
    ) then continue; end if;
    begin
      execute format(
        'delete from public.%I d where d.tenant_id = $1 and d.%I in '
        || '(select x.id from public.%I x where x.tenant_id = $1 and x.created_at > $2 and x.created_at <= $3)',
        v_dep[1], v_dep[2], v_dep[3]
      ) using p_tenant_id, v_baseline, p_now;
      get diagnostics v_n = row_count;
      if v_n > 0 then
        v_deleted := v_deleted || jsonb_build_object(v_dep[1], coalesce((v_deleted ->> v_dep[1])::bigint, 0) + v_n);
      end if;
    exception when others then
      v_skipped := v_skipped || jsonb_build_object(v_dep[1] || '.' || v_dep[2], sqlstate);
    end;
  end loop;

  foreach v_table in array v_business loop
    if pg_catalog.to_regclass('public.' || v_table) is null then continue; end if;
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = v_table and c.column_name = 'created_at'
    ) then continue; end if;
    begin
      execute format('delete from public.%I where tenant_id = $1 and created_at > $2 and created_at <= $3', v_table)
        using p_tenant_id, v_baseline, p_now;
      get diagnostics v_n = row_count;
      if v_n > 0 then v_deleted := v_deleted || jsonb_build_object(v_table, v_n); end if;
    exception when others then
      v_skipped := v_skipped || jsonb_build_object(v_table, sqlstate);
    end;
  end loop;

  v_result := jsonb_build_object('baseline_at', v_baseline, 'deleted', v_deleted, 'skipped', v_skipped);
  update public.demo_reset_state set last_reset_at = p_now, last_result = v_result where tenant_id = p_tenant_id;
  return v_result;
end;
$$;

revoke all on function public.demo_tenant_nightly_reset(uuid, timestamptz) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.demo_tenant_nightly_reset(uuid, timestamptz) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.demo_tenant_nightly_reset(uuid, timestamptz) from authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.demo_tenant_nightly_reset(uuid, timestamptz) to service_role';
  end if;
end $$;

comment on function public.demo_tenant_nightly_reset(uuid, timestamptz) is
  'YD1: yalniz slug=demo-ofis kiracisi; dis baglanti yuzeylerini ve tabandan sonra eklenen is kayitlarini siler. Gercek kiracida hata verir.';
