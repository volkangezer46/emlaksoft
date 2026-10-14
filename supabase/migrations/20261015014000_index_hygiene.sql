-- MIGRATION 20261015014000_index_hygiene.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular (gölgede denendi).
-- Geri alma: supabase/rollbacks/20261015014000_index_hygiene.rollback.sql (dusurulen 2 indeks pg_get_indexdef ile geri, yeni indeks kalkar).
--
-- AMAC (KQ2, indeks hijyeni):
--  A) commission_splits (commission_id, profile_id) WHERE profile_id IS NOT NULL: tekil kazanc kontrolu
--     can_view_commission_earnings'in "bu komisyonda payim var mi" EXISTS'i ve komisyon detayindaki pay okumalari
--     (commission_id = $1 [and profile_id = $2]) bu indeksle tek yaprakta cozulur. Mevcut idx_commission_splits_commission
--     (tenant_id, commission_id) profile_id tasimiyor; idx_commission_splits_profile (tenant_id, profile_id) commission_id tasimiyor.
--  B) KESIN yinelenen iki indeks dusurulur (ayni tablo, ayni onek, kisit indeksi DEGIL):
--     idx_customers_tenant (tenant_id)              -> onek ikizi: uq_customers_tenant_id_id (tenant_id, id) [UNIQUE],
--                                                      idx_customers_phone (tenant_id, phone)
--     idx_demands_tenant_status (tenant_id, status) -> onek ikizi: idx_demands_tenant_status_created (tenant_id, status, created_at DESC)
--     Kapsayan indeks yoksa (beklenmeyen sema) dusurme ATLANIR (asagidaki DO blogu kontrol eder).
-- KILIT: runner tek transaction -> CONCURRENTLY YOK (20261013000300 ile ayni gerekce). commission_splits ve
--   customer_demands canlida yuzlerce satir; kilit ms mertebesinde. Buyuk veride ayni DDL elle CONCURRENTLY uygulanmali.
-- Idempotent (IF NOT EXISTS / IF EXISTS).
set local lock_timeout = '5s';

-- A) yeni indeks
create index if not exists idx_commission_splits_commission_profile
  on public.commission_splits (commission_id, profile_id)
  where profile_id is not null;

-- B) kesin yinelenenler (kapsayan indeks dogrulanarak)
do $$
begin
  if pg_catalog.to_regclass('public.idx_customers_tenant') is not null then
    if pg_catalog.to_regclass('public.uq_customers_tenant_id_id') is not null
       or pg_catalog.to_regclass('public.idx_customers_phone') is not null then
      execute 'drop index if exists public.idx_customers_tenant';
    else
      raise notice 'KQ2: idx_customers_tenant kapsayan indeks yok, dusurulmedi';
    end if;
  end if;

  if pg_catalog.to_regclass('public.idx_demands_tenant_status') is not null then
    if pg_catalog.to_regclass('public.idx_demands_tenant_status_created') is not null then
      execute 'drop index if exists public.idx_demands_tenant_status';
    else
      raise notice 'KQ2: idx_demands_tenant_status kapsayan indeks yok, dusurulmedi';
    end if;
  end if;
end $$;
