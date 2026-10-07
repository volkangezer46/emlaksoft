-- MIGRATION 20261007001100_perf_indexes_rpc.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI
-- `npm run db:migrate -- --only 20261007001100_perf_indexes_rpc.sql` ile uygular.
-- Geri alma: supabase/rollbacks/20261007001100_perf_indexes_rpc.rollback.sql
-- BAGIMLILIK: public.profiles, public.two_factor_verified_sessions, public.platform_staff, public.customer_demands.
--
-- AMAC (perf turu 3, canli SALT-OKUNUR olcum 2026-10-07): her RLS'li sorgu politikasinda `(select current_active_tenant_id())`
--   ve `(select has_effective_permission(..))` initplan'larini bir kez calistirir. Olcum (demo-ofis owner, ayni oturumda 2000 cagri):
--     current_active_tenant_id()      ~420 us/cagri   <- SURE'NIN ~%85'i current_session_two_factor_satisfied() icinde
--     has_effective_permission(..)    ~900-1350 us/cagri (icinde 4-5 kez tenant cozumu)
--   Neden: current_session_two_factor_satisfied() `language sql` + SECURITY DEFINER + SET search_path (satir ici acilamaz).
--   PostgreSQL SQL-dilli fonksiyonu, bir sorgunun icinden cagrildiginda HER SORGU YURUTMESINDE yeniden ayristirip planlar (~360 us);
--   plpgsql ise derlenmis plani oturum boyunca onbellekler (~20 us). Govde birebir ayni, dil plpgsql olur. Etki: tenant cozumu
--   ~420 -> ~60 us, izin kontrolu ~4x hizlanir; /app'teki hemen her sorgu (kabuk RPC'si 8, metrik anliti ~27 sorgu) bunu bir kez oder.
--   Ayni kalip admin tablolarinin politikalarindaki is_platform_staff() (25 politika) ve support_is_ticket_staff() (4) icin de gecerli.
--
-- DAVRANIS: birebir ayni (ayni sorgu, ayni STABLE/SECURITY DEFINER/search_path, ayni donus degeri). CREATE OR REPLACE ACL'leri korur
--   (anon/authenticated/service_role izinleri degismez). Politika, tablo, veri degismez. Yeni yetki yok.
-- INDEKS: pg_indexes ile dogrulandi (684 FK, buyuk kisim zaten indeksli; eksik olanlar 8 KB'lik denetim kolonlari). Tek kanitli
--   bosluk: customer_demands icin tenant + created_at araligi (ana ekran donem sayaclari ve nabiz sorgulari durum filtresiz
--   created_at >= .. ile sayar; mevcut idx_demands_tenant_status_created (tenant_id, status, created_at) bu araligi kullanamaz).
--   Tablo kucuk (CONCURRENTLY runner transaction'inda calismaz; normal CREATE INDEX IF NOT EXISTS kisa kilit alir).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.two_factor_verified_sessions') is null
     or pg_catalog.to_regclass('public.platform_staff') is null
     or pg_catalog.to_regclass('public.customer_demands') is null then
    raise exception 'profiles/two_factor_verified_sessions/platform_staff/customer_demands yok; temel migrationlar once uygulanmali.';
  end if;
  if pg_catalog.to_regprocedure('public.current_session_two_factor_satisfied()') is null
     or pg_catalog.to_regprocedure('public.is_platform_staff()') is null
     or pg_catalog.to_regprocedure('public.support_is_ticket_staff()') is null then
    raise exception 'donusturulecek fonksiyonlardan biri yok (current_session_two_factor_satisfied/is_platform_staff/support_is_ticket_staff).';
  end if;
end $$;

-- 1) 2FA oturum kapisi: SQL -> plpgsql (govde birebir; plan onbellegi).
create or replace function public.current_session_two_factor_satisfied()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return coalesce(
    (
      select
        not coalesce(p.two_factor_sms, false)
        or exists (
          select 1
          from public.two_factor_verified_sessions v
          where v.session_id = nullif(btrim(auth.jwt() ->> 'session_id'), '')
            and v.user_id = auth.uid()
            and v.profile_version = p.two_factor_version
            and v.expires_at > now()
        )
      from public.profiles p
      where p.id = auth.uid() and p.is_active = true
      limit 1
    ),
    true
  );
end;
$$;

-- 2) Platform personeli kapilari (admin tablolari politikalari): SQL -> plpgsql (govde birebir).
create or replace function public.is_platform_staff()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.platform_staff ps
    where ps.id = auth.uid()
      and ps.is_active = true
      and coalesce(
        auth.jwt() -> 'app_metadata' ->> 'impersonating',
        'false'
      ) <> 'true'
  );
end;
$$;

create or replace function public.support_is_ticket_staff()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (
    select 1
    from public.platform_staff s
    where s.id = auth.uid()
      and s.is_active = true
      and s.role in ('super_admin', 'ops', 'support')
  );
end;
$$;

-- 3) Talep donem sayaclari: tenant + created_at araligi.
create index if not exists idx_customer_demands_tenant_created
  on public.customer_demands (tenant_id, created_at desc);

notify pgrst, 'reload schema';
