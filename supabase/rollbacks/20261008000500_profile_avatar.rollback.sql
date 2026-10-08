-- 20261008000500 geri alma: politikalar, fonksiyonlar ve sütunlar kalkar. `avatars` kovası ve içindeki dosyalar SİLİNMEZ
-- (kova boşaltılıp dashboard'dan elle kaldırılır).
do $$
begin
  if pg_catalog.to_regclass('storage.objects') is not null then
    execute 'drop policy if exists avatars_owner_select on storage.objects';
    execute 'drop policy if exists avatars_owner_insert on storage.objects';
    execute 'drop policy if exists avatars_owner_update on storage.objects';
    execute 'drop policy if exists avatars_owner_delete on storage.objects';
  end if;
end $$;
drop function if exists public.set_my_avatar(text, text);
drop function if exists public.avatar_object_allowed(text);
alter table public.platform_staff drop constraint if exists platform_staff_avatar_preset_format;
alter table public.profiles drop constraint if exists profiles_avatar_preset_format;
alter table public.platform_staff drop column if exists avatar_preset, drop column if exists avatar_url;
alter table public.profiles drop column if exists avatar_preset, drop column if exists avatar_url;
