-- SK5 bir kerelik bakım (YALNIZ demo-ofis): yinelenen kazanılmış satışlar (B080), gelecek tarihli tohum satırları ve
-- komisyon-anlaşma sırası (B081), ofis telefonu (B148). Şema değişikliği YOK; migration değildir. service_role/postgres
-- oturumunda çalışır (anlaşma/komisyon koruma tetikleyicileri yalnız `authenticated`'i durdurur).
--
-- Çalıştırma (yalnız yayın yetkisiyle, sahip onayıyla; migration 20261016050100'den sonra önerilir — yeni komisyonların
-- is_sample'ı tetikleyiciden gelir, bu betik mevcut uyuşmazları da eşler):
--   docker exec -i <supabase-db-container> psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/sql/demo-duplicate-won-cleanup.sql
-- Sonda "KALAN" sorgusu her satırda 0 vermelidir; aksi halde DO bloğu hata verir ve hiçbir şey yazılmaz.
--
-- 2026-10-15 salt-okunur ölçüm (canlı demo-ofis): DEMO-018 ve DEMO-019'da 2'şer won satış (her portföyde yalnız biri
-- closure_active); kopyalara bağlı 2'şer komisyon bölüşümü, 0 hakediş, 0 görev/teklif/not, 0 ödeme bağlantısı.
-- Kopya komisyonlar: 290.000 + 630.000 = 920.000 TL fazla ciro (kaçan gelir tarafında 460.000 TL).
-- Gelecek tarihli: 4 portföy (DEMO-016..019, 2026-12-17), 28 görev, 1 anlaşma (updated_at 2026-12-13);
-- 9 komisyon anlaşmasından önce tarihli. tenants.phone boş. Gerçek ofislerde kopya won satış: 0.
-- DB'ye benzersiz indeks EKLENMEZ: aynı portföy yıllar sonra yeniden satılabilir (kural yalnız demo tohumunda,
-- src/lib/demo-seed-invariants.ts findDuplicateWonSales + seed-demo.ts son koşulu).
-- ÇALIŞTIRILMADI: bu paket canlıya yazmaz; yayın yetkili oturum çalıştırıp çıktıyı kayda geçirir.

\set ON_ERROR_STOP on

begin;
set local lock_timeout = '5s';

-- ÖN KONTROL --------------------------------------------------------------------------------------------------------
with t as (select id from public.tenants where slug = 'demo-ofis'),
won as (
  select d.id, d.property_id,
         row_number() over (partition by d.property_id
                            order by d.closure_active desc, coalesce(d.updated_at, d.created_at) desc, d.id) as rn
  from public.deals d
  where d.tenant_id = (select id from t) and d.stage = 'won' and d.deal_type = 'sale' and d.property_id is not null
)
select 'kopya_won_satis' as kontrol, count(*) as n from won where rn > 1
union all select 'kopya_komisyon_tutari', coalesce(sum(c.gross_amount), 0)::bigint
  from public.commissions c where c.deal_id in (select id from won where rn > 1)
union all select 'gelecek_portfoy', count(*) from public.properties where tenant_id = (select id from t) and created_at > now()
union all select 'gelecek_gorev', count(*) from public.tasks where tenant_id = (select id from t) and created_at > now()
union all select 'gelecek_anlasma', count(*) from public.deals
  where tenant_id = (select id from t) and (created_at > now() or updated_at > now())
union all select 'komisyon_anlasmadan_once', count(*) from public.commissions c
  join public.deals d on d.id = c.deal_id and d.tenant_id = c.tenant_id
  where c.tenant_id = (select id from t) and c.created_at < d.created_at
union all select 'ofis_telefonu_bos', count(*) from public.tenants where id = (select id from t) and coalesce(phone, '') = '';

-- DÜZELTME ----------------------------------------------------------------------------------------------------------
do $$
declare
  v_tenant uuid;
  v_deals uuid[];
  v_comms uuid[];
  v_cap timestamptz;
  v_n integer;
  v_table text;
begin
  select id into v_tenant from public.tenants where slug = 'demo-ofis';
  if v_tenant is null then
    raise notice 'demo-ofis yok; hiçbir şey yapılmadı';
    return;
  end if;

  -- (1) B080: portföy başına tek won satış (kapanış-aktif olan, yoksa en son güncellenen kalır).
  select coalesce(array_agg(x.id), '{}') into v_deals
  from (
    select d.id,
           row_number() over (partition by d.property_id
                              order by d.closure_active desc, coalesce(d.updated_at, d.created_at) desc, d.id) as rn
    from public.deals d
    where d.tenant_id = v_tenant and d.stage = 'won' and d.deal_type = 'sale' and d.property_id is not null
  ) x
  where x.rn > 1;

  select coalesce(array_agg(c.id), '{}') into v_comms
  from public.commissions c where c.tenant_id = v_tenant and c.deal_id = any (v_deals);

  if exists (select 1 from public.rentals r where r.tenant_id = v_tenant and r.deal_id = any (v_deals)) then
    raise exception 'kopya won satışa bağlı kira sözleşmesi var; elle incelenmeli';
  end if;
  -- Hakediş komisyona RESTRICT ile bağlı; ödeme bağlantısı ve görev/teklif/anket bağları boşa çekilir
  -- (bileşik FK'larda ON DELETE SET NULL tenant_id'yi de boşaltmaya çalışırdı).
  delete from public.commission_payouts where tenant_id = v_tenant and commission_id = any (v_comms);
  update public.payment_links set commission_id = null where tenant_id = v_tenant and commission_id = any (v_comms);
  update public.tasks set deal_id = null where tenant_id = v_tenant and deal_id = any (v_deals);
  update public.offers set deal_id = null where tenant_id = v_tenant and deal_id = any (v_deals);
  update public.surveys set deal_id = null where tenant_id = v_tenant and deal_id = any (v_deals);
  update public.survey_tasks set deal_id = null where tenant_id = v_tenant and deal_id = any (v_deals);
  -- Komisyon, bölüşüm, kontrol listesi, maliyet, not ve süreç adımları anlaşmayla kademeli silinir.
  delete from public.deals where tenant_id = v_tenant and id = any (v_deals);
  get diagnostics v_n = row_count;
  raise notice 'B080: % kopya won satış (% komisyon) silindi', v_n, cardinality(v_comms);

  -- (2) B081: gelecek tarihli tohum damgaları. Tavan: gece sıfırlama tabanı (yoksa şimdi); tabana çekilen satır tohum
  -- sayılır, gece silinmez. Ziyaretçi kayıtları (taban ile şimdi arası) dokunulmaz.
  v_cap := now();
  if to_regclass('public.demo_reset_state') is not null then
    select least(now(), coalesce(s.baseline_at, now())) into v_cap from public.demo_reset_state s where s.tenant_id = v_tenant;
    v_cap := coalesce(v_cap, now());
  end if;
  foreach v_table in array array[
    'customers', 'customer_demands', 'properties', 'appointments', 'tasks', 'offers', 'deals', 'notifications',
    'communications', 'open_houses', 'commissions', 'listing_closures', 'cash_entries', 'commission_payouts'
  ] loop
    if to_regclass('public.' || v_table) is null then
      continue;
    end if;
    execute format('update public.%I set created_at = $2 where tenant_id = $1 and created_at > now()', v_table)
      using v_tenant, v_cap;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      raise notice 'B081: % gelecek tarihli satır → % (%)', v_n, v_cap, v_table;
    end if;
  end loop;
  update public.deals set updated_at = now() where tenant_id = v_tenant and updated_at > now();
  update public.properties set updated_at = now() where tenant_id = v_tenant and updated_at > now();

  -- (3) B081: komisyon anlaşmasından önce tarihli olamaz → anlaşmanın kapanış anına (yoksa oluşturmasına).
  update public.commissions c
     set created_at = greatest(d.created_at, least(coalesce(d.updated_at, d.created_at), now()))
    from public.deals d
   where d.id = c.deal_id and d.tenant_id = c.tenant_id and c.tenant_id = v_tenant and c.created_at < d.created_at;
  get diagnostics v_n = row_count;
  raise notice 'B081: % komisyon anlaşmasından sonraya taşındı', v_n;

  -- (3b) B085: komisyonun örnek bayrağı anlaşmasından (migration 20261016050100'ün tek seferlik düzeltmesiyle aynı;
  -- migration önce uygulandıysa 0 satır).
  update public.commissions c
     set is_sample = d.is_sample
    from public.deals d
   where d.id = c.deal_id and d.tenant_id = c.tenant_id and c.tenant_id = v_tenant and c.is_sample is distinct from d.is_sample;
  get diagnostics v_n = row_count;
  raise notice 'B085: % komisyonun örnek bayrağı anlaşmaya eşlendi', v_n;

  -- (4) B148: ofis telefonu (seed-demo.ts DEMO_OFFICE_PHONE ile aynı), yalnız boşsa.
  update public.tenants set phone = '02165550100' where id = v_tenant and coalesce(phone, '') = '';

  -- KALAN (son koşul): hepsi 0 olmalı.
  if exists (
       select 1 from public.deals d
       where d.tenant_id = v_tenant and d.stage = 'won' and d.deal_type = 'sale' and d.property_id is not null
       group by d.property_id having count(*) > 1)
     or exists (select 1 from public.properties where tenant_id = v_tenant and created_at > now())
     or exists (select 1 from public.tasks where tenant_id = v_tenant and created_at > now())
     or exists (select 1 from public.deals where tenant_id = v_tenant and (created_at > now() or updated_at > now()))
     or exists (
       select 1 from public.commissions c join public.deals d on d.id = c.deal_id and d.tenant_id = c.tenant_id
       where c.tenant_id = v_tenant and c.created_at < d.created_at)
     or exists (
       select 1 from public.commissions c join public.deals d on d.id = c.deal_id and d.tenant_id = c.tenant_id
       where c.tenant_id = v_tenant and c.is_sample is distinct from d.is_sample) then
    raise exception 'son koşul sağlanmadı; geri alınıyor';
  end if;
end $$;

commit;
