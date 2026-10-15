-- 20261018090100 geri alma: 2FA kapisi 20261007001100 govdesine doner (yalniz SMS/kurtarma kaniti), yontem tetigi ve
--   kurtarma kodu tablosu duser. TOTP yontemli kullanicilar SMS yontemine cekilir (two_factor_sms acik kalir; telefonu
--   olmayanlar icin 2FA kapatilir ki kilitlenmesinler). two_factor_method kolonu DUSER.
set local lock_timeout = '5s';

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

drop trigger if exists trg_profiles_two_factor_method_version on public.profiles;
drop function if exists public.bump_profile_two_factor_method_version();

update public.profiles
set two_factor_sms = case when phone is null then false else two_factor_sms end
where two_factor_method = 'totp';

drop table if exists public.two_factor_recovery_codes;
alter table public.profiles drop constraint if exists profiles_two_factor_method_check;
alter table public.profiles drop column if exists two_factor_method;
