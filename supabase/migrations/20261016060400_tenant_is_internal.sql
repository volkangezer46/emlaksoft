-- MIGRATION 20261016060400_tenant_is_internal.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular.
-- Geri alma: supabase/rollbacks/20261016060400_tenant_is_internal.rollback.sql (koruma tetikleyicisi + sutun kalkar).
-- BAGIMLILIK: yok (tenants cekirdek tablosu).
--
-- BULGU SK6/B178 + B110 (platform MRR'inin ~%66'si test/demo ofisinden): e2e-test (aboneligi yok, katalog fiyatiyla 5.490),
--   demo-ofis (5.990) ve admin ofisi gercek musteri gibi MRR'a, anlik goruntuye, churn'e ve platform metriklerine giriyordu.
-- COZUM: tenants.is_internal (boolean, varsayilan false). e2e-test, admin ve demo-ofis isaretlenir; platform_reporting_aggregates
--   (20261016060500), platform_mrr_daily yazimi/okumasi (mrr-snapshot.ts) ve /admin/raporlar churn'u bu ofisleri disarida birakir.
--   e2e-test kiracisi AKTIF KALIR (SK1 olcum kiracisi); durum/plan/abonelik satirlarina DOKUNULMAZ.
-- GUVENLIK: bayrak yalniz guvenilir sunucu yolundan (service_role / postgres) degisir. authenticated'in tenants uzerinde tablo
--   duzeyi UPDATE yetkisi oldugu icin sutun REVOKE'u yetmez; ayri BEFORE INSERT/UPDATE OF is_internal tetikleyicisi 42501 verir
--   (mevcut guard_tenant_lifecycle_fields govdesine DOKUNULMAZ).
-- VERI: yalniz 3 ic ofisin bayragi; gercek ofislerde veri degisikligi yok. Sabit varsayilanli sutun ekleme tabloyu yeniden yazmaz.
-- KOD SIRASI: bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir (kod sutun yokken hicbir ofisi ic saymaz).
-- Idempotent: add column if not exists, kosullu update, create or replace, drop trigger if exists.
set local lock_timeout = '5s';

alter table public.tenants add column if not exists is_internal boolean not null default false;

comment on column public.tenants.is_internal is
  'Ic/test/demo ofis (e2e-test, admin, demo-ofis): platform MRR, anlik goruntu, churn ve platform metriklerinden haric. Yalniz service_role degistirir.';

update public.tenants
set is_internal = true
where slug in ('e2e-test', 'admin', 'demo-ofis')
  and is_internal is distinct from true;

-- Platform toplulastirmalari "ic ofis haric" suzer; ic ofis sayisi cok kucuk oldugundan kismi indeks yeterli.
create index if not exists tenants_is_internal_idx on public.tenants (id) where is_internal;

create or replace function public.guard_tenant_is_internal()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    if (tg_op = 'INSERT' and new.is_internal)
       or (tg_op = 'UPDATE' and new.is_internal is distinct from old.is_internal) then
      raise exception 'Ic ofis isareti yalniz guvenilir sunucu yolundan degisir.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_tenant_is_internal() from public, anon, authenticated;

drop trigger if exists trg_guard_tenant_is_internal on public.tenants;
create trigger trg_guard_tenant_is_internal
  before insert or update of is_internal on public.tenants
  for each row execute function public.guard_tenant_is_internal();
