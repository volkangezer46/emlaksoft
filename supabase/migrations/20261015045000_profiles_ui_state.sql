-- MIGRATION 20261015045000_profiles_ui_state.sql
-- YD5 (2026-10-15): urun turu ve davet karti kapatma durumu SUNUCUDA (cihazlar arasi).
-- Geri alma: supabase/rollbacks/20261015045000_profiles_ui_state.rollback.sql (kayitli "goruldu/kapatildi" isaretleri KAYBOLUR;
--   kod sutun/fonksiyon yokken yalniz tarayici onbellegiyle (localStorage) calisir, tur yeni cihazda bir kez daha acilir).
-- BAGIMLILIK: profiles (mevcut).
--
-- NE: profiles.ui_state jsonb (varsayilan '{}', nesne, <= 8 KB) + public.profile_ui_state_mark(p_key text).
--   Anahtarlar kod tarafinda sabit: "tour:<tur-kimligi>" ve "nudge:<an>"; deger isaretlendigi an (ISO metin).
-- NEDEN: tur durumu yalniz localStorage'daydi; her yeni tarayici/cihazda tur yeniden aciliyor, mobilde Bugun ekraninin
--   ~%45'ini kapliyordu. Davet karti kapatma tercihi de yalniz o tarayicida kaliyordu.
-- GUVENLIK: fonksiyon SECURITY INVOKER: yazma kullanicinin kendi satirina, mevcut identity_profiles_self_update politikasi
--   ve tetikleyicileriyle (salt-okunur / destek oturumu yazamaz). Anahtar deseni ve boyut siniri kisitla korunur.
--   anon/PUBLIC EXECUTE yok; yalniz authenticated.
-- ETKI: yalniz yeni sutun + fonksiyon (ek). Mevcut satir/politika/davranis degismez. Idempotent.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.profiles') is null then
    raise exception 'profiles yok; once temel migrationlar uygulanmali.';
  end if;
end $$;

alter table public.profiles
  add column if not exists ui_state jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'profiles_ui_state_shape_check') then
    alter table public.profiles
      add constraint profiles_ui_state_shape_check
      check (jsonb_typeof(ui_state) = 'object' and pg_catalog.pg_column_size(ui_state) <= 8192);
  end if;
end $$;

comment on column public.profiles.ui_state is
  'Kullaniciya ozel arayuz durumu (YD5): "tour:<id>" ve "nudge:<an>" anahtarlari -> isaretlenme ani. Yalniz profile_ui_state_mark ile yazilir.';

create or replace function public.profile_ui_state_mark(p_key text)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_rows integer;
begin
  if v_uid is null then
    return false;
  end if;
  if p_key is null or p_key !~ '^(tour|nudge):[a-z0-9_-]{1,48}$' then
    raise exception 'Gecersiz arayuz durumu anahtari.' using errcode = '22023';
  end if;
  update public.profiles
     set ui_state = coalesce(ui_state, '{}'::jsonb)
                    || jsonb_build_object(p_key, to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
   where id = v_uid
     and not (coalesce(ui_state, '{}'::jsonb) ? p_key);
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.profile_ui_state_mark(text) from public;
revoke all on function public.profile_ui_state_mark(text) from anon;
grant execute on function public.profile_ui_state_mark(text) to authenticated;

notify pgrst, 'reload schema';
