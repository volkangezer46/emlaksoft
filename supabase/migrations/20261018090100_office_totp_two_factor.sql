-- MIGRATION 20261018090100_office_totp_two_factor.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE uygulanir: yeni kod profiles.two_factor_method okur/yazar (kolon yokken giris profili okunamaz).
-- Geri alma: supabase/rollbacks/20261018090100_office_totp_two_factor.rollback.sql
-- BAGIMLILIK: 20260802000300 (profiles.two_factor_sms / two_factor_version, two_factor_verified_sessions),
--   20261007001100 (current_session_two_factor_satisfied plpgsql govdesi).
--
-- NE (arastirma 4, ofis kullanicilari icin authenticator 2FA):
--  1) profiles.two_factor_method ('sms' | 'totp', varsayilan 'sms'). two_factor_sms = "iki adimli dogrulama acik" anlamini
--     korur (proxy, kimlik kapisi, ofis politikasi ayni bayragi okur); yontem yeni kolondadir.
--  2) Yontem degisince two_factor_version artar (eski oturum kanitlari gecersiz olur) — mevcut tetige dokunmadan ek tetik.
--     Yontem yalniz sunucu (service_role) yolundan degisir: oturum acmis kullanici kendi satirinda degistiremez.
--  3) two_factor_recovery_codes: 10 tek kullanimlik kurtarma kodunun HMAC-SHA256 ozeti (duz kod saklanmaz), yalniz service_role.
--  4) current_session_two_factor_satisfied(): TOTP yontemli kullanicida Supabase oturumu AAL2 ise (authenticator dogrulandi)
--     de saglanmis sayilir. Mevcut kanit tablosu (two_factor_verified_sessions) aynen gecerli: SMS kodu ve kurtarma kodu
--     yolu oraya yazar. Davranis SMS kullanicilari icin degismez.
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.profiles') is null
     or pg_catalog.to_regclass('public.two_factor_verified_sessions') is null then
    raise exception 'profiles / two_factor_verified_sessions yok; temel migrationlar once uygulanmali.';
  end if;
end $$;

alter table public.profiles
  add column if not exists two_factor_method text not null default 'sms';

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_two_factor_method_check'
  ) then
    alter table public.profiles
      add constraint profiles_two_factor_method_check check (two_factor_method in ('sms', 'totp'));
  end if;
end $$;

-- 2) Yontem degisimi: surum artar + yalniz sunucu yolu.
create or replace function public.bump_profile_two_factor_method_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.two_factor_method is distinct from old.two_factor_method then
    if auth.role() in ('anon', 'authenticated') then
      raise exception 'Identity fields require the trusted server workflow.' using errcode = '42501';
    end if;
    new.two_factor_version := old.two_factor_version + 1;
  end if;
  return new;
end;
$$;

revoke all privileges on function public.bump_profile_two_factor_method_version()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_profiles_two_factor_method_version on public.profiles;
create trigger trg_profiles_two_factor_method_version
before update of two_factor_method on public.profiles
for each row execute function public.bump_profile_two_factor_method_version();

-- 3) Kurtarma kodlari (ozet; tek kullanimlik).
create table if not exists public.two_factor_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  used_at timestamptz,
  constraint two_factor_recovery_codes_unique unique (user_id, code_hash)
);

create index if not exists idx_two_factor_recovery_codes_user
  on public.two_factor_recovery_codes (user_id) where used_at is null;

alter table public.two_factor_recovery_codes enable row level security;
revoke all privileges on table public.two_factor_recovery_codes from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.two_factor_recovery_codes to service_role;

comment on table public.two_factor_recovery_codes is
  'Arastirma 4: ofis kullanicisi authenticator 2FA kurtarma kodlari (HMAC-SHA256 ozeti, tek kullanimlik). Yalniz service_role.';

-- 4) Oturum 2FA kapisi: TOTP yontemi + AAL2 oturum da kabul edilir (govdenin geri kalani 20261007001100 ile birebir).
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
        or (
          p.two_factor_method = 'totp'
          and coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
        )
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
