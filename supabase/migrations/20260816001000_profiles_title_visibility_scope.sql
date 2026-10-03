-- Faz 2 / 10: profiles.title ve profiles.visibility_scope.
--
-- NEDEN: unvan (ör. "Kıdemli Danışman") ve veri kapsamı (kendi/ekip/şube/ofis) profilde tutulmuyor (belge 1B).
-- visibility_scope YETKİ MATRİSİYLE ÇAKIŞMAZ: gerçek kapı permissions.ts + RLS'tir; bu sütun yalnız
-- "hangi satırlar listelensin" veri kapsamı tercihidir. NULL = rol varsayılanı
-- (owner/gm/branch_manager ofis geneli, diğerleri kendi satırı: permission-data-scope.ts). Bu migration
-- hiçbir mevcut davranışı DEĞİŞTİRMEZ; sütunlar kod bağlanana dek okunmaz.
-- GÜVENLİK: profiles'ta "self_update" politikası kullanıcıya KENDİ satırını güncelleme izni veriyor; kapsamı
--   genişletme kendi kendine yapılamasın diye guard trigger: authenticated kullanıcı visibility_scope'u yalnız
--   team:edit izniyle değiştirebilir (service_role/sunucu işlemleri etkilenmez). title serbest (kozmetik).
-- GERİ ALMA: rollbacks/20260816001000_profiles_title_visibility_scope.rollback.sql.
-- RİSK: düşük (nullable sütunlar; `profiles` hot tablo ama ADD COLUMN nullable sabit-kayıt yazımı yapmaz).

alter table public.profiles
  add column if not exists title text
    check (title is null or char_length(btrim(title)) between 1 and 80),
  add column if not exists visibility_scope text
    check (visibility_scope is null or visibility_scope in ('own', 'team', 'branch', 'office'));

comment on column public.profiles.title is 'Unvan (görüntüleme amaçlı, yetki değildir).';
comment on column public.profiles.visibility_scope is
  'Veri kapsamı tercihi (own/team/branch/office); NULL = rol varsayılanı. Yetki kapısı DEĞİLDİR (permissions.ts + RLS).';

create or replace function public.guard_profile_visibility_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.role() is distinct from 'authenticated' then
    return new;
  end if;
  if new.visibility_scope is distinct from old.visibility_scope
     and not public.has_effective_permission('team', 'edit') then
    raise exception 'Veri kapsami degisikligi ekip yonetimi yetkisi gerektirir.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_profile_visibility_scope()
  from public, anon, authenticated;

drop trigger if exists trg_guard_profile_visibility_scope on public.profiles;
create trigger trg_guard_profile_visibility_scope
before update of visibility_scope on public.profiles
for each row execute function public.guard_profile_visibility_scope();
