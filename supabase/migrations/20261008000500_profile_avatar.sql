-- Profil fotoğrafı / hazır avatar (ofis sahibi, danışman, platform personeli).
--
-- NE: (1) profiles + platform_staff'a avatar_url / avatar_preset (ikisi doluysa fotoğraf öncelikli, UI kuralı);
--     (2) herkese açık okunur `avatars` kovası (2 MB, jpeg/png/webp), yol {tenant_id|platform}/{user_id}.{ext};
--     (3) kova yazma/silme yalnız sahibine (storage RLS, avatar_object_allowed) — service_role gerekmez;
--     (4) set_my_avatar(p_url, p_preset): SECURITY DEFINER, auth.uid() ile YALNIZ kendi satırı (profiles, yoksa platform_staff).
-- NEDEN RPC: platform_staff yazması yalnız service_role idi; kullanıcı istemcisiyle kendi avatarını yazabilsin diye
--     tek dar kapı (URL biçimi sıkı doğrulanır, başkasının yoluna işaret edemez, bürünme oturumu yazamaz).
-- GERI ALMA: rollbacks/20261008000500_profile_avatar.rollback.sql (kova ve yüklenmiş dosyalar silinmez).
-- RISK: düşük; yalnız nullable sütun + yeni fonksiyon/politika.

set local lock_timeout = '5s';

alter table public.profiles
  add column if not exists avatar_url text,
  add column if not exists avatar_preset text;
alter table public.platform_staff
  add column if not exists avatar_url text,
  add column if not exists avatar_preset text;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'profiles_avatar_preset_format') then
    alter table public.profiles add constraint profiles_avatar_preset_format
      check (avatar_preset is null or avatar_preset ~ '^[a-z0-9-]{1,32}$');
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'platform_staff_avatar_preset_format') then
    alter table public.platform_staff add constraint platform_staff_avatar_preset_format
      check (avatar_preset is null or avatar_preset ~ '^[a-z0-9-]{1,32}$');
  end if;
end $$;

comment on column public.profiles.avatar_url is 'Kullanıcının yüklediği profil fotoğrafı (avatars kovası public URL); doluysa avatar_preset''e göre öncelikli.';
comment on column public.profiles.avatar_preset is 'Hazır avatar anahtarı (src/lib/avatar-presets.ts); fotoğraf yoksa gösterilir, ikisi de yoksa baş harf.';
comment on column public.platform_staff.avatar_url is 'Personelin profil fotoğrafı (avatars kovası, platform/ öneki).';
comment on column public.platform_staff.avatar_preset is 'Personelin hazır avatar anahtarı.';

-- ---------------------------------------------------------------------------
-- Kova
-- ---------------------------------------------------------------------------
do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp']::text[])
    on conflict (id) do update
      set public = true,
          file_size_limit = 2097152,
          allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[];
  end if;
end $$;

-- Yol sahibi kontrolü: {tenant_id|platform}/{auth.uid()}.{jpg|png|webp}; bürünme oturumu yazamaz.
create or replace function public.avatar_object_allowed(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') <> 'true'
    and p_name ~ ('^(platform|[0-9a-f-]{36})/' || auth.uid()::text || '\.(jpg|png|webp)$')
    and (
      (
        split_part(p_name, '/', 1) = 'platform'
        and exists (select 1 from public.platform_staff ps where ps.id = auth.uid() and ps.is_active = true)
      )
      or (
        split_part(p_name, '/', 1) <> 'platform'
        and split_part(p_name, '/', 1) = (
          select p.tenant_id::text from public.profiles p where p.id = auth.uid() and p.is_active = true
        )
      )
    );
$$;

revoke all privileges on function public.avatar_object_allowed(text) from public, anon;
grant execute on function public.avatar_object_allowed(text) to authenticated, service_role;

do $$
begin
  if pg_catalog.to_regclass('storage.objects') is not null then
    execute 'drop policy if exists avatars_owner_select on storage.objects';
    execute 'drop policy if exists avatars_owner_insert on storage.objects';
    execute 'drop policy if exists avatars_owner_update on storage.objects';
    execute 'drop policy if exists avatars_owner_delete on storage.objects';
    execute $p$create policy avatars_owner_select on storage.objects for select to authenticated
      using (bucket_id = 'avatars' and public.avatar_object_allowed(name))$p$;
    execute $p$create policy avatars_owner_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and public.avatar_object_allowed(name))$p$;
    execute $p$create policy avatars_owner_update on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and public.avatar_object_allowed(name))
      with check (bucket_id = 'avatars' and public.avatar_object_allowed(name))$p$;
    execute $p$create policy avatars_owner_delete on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and public.avatar_object_allowed(name))$p$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Yalnız kendi avatarını yaz
-- ---------------------------------------------------------------------------
create or replace function public.set_my_avatar(p_url text, p_preset text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_url text := nullif(btrim(p_url), '');
  v_preset text := nullif(btrim(p_preset), '');
  v_n integer;
begin
  if v_uid is null then
    raise exception 'Oturum gerekli.' using errcode = '42501';
  end if;
  if coalesce(auth.jwt() -> 'app_metadata' ->> 'impersonating', 'false') = 'true' then
    raise exception 'Destek oturumunda avatar değiştirilemez.' using errcode = '42501';
  end if;
  if v_preset is not null and v_preset !~ '^[a-z0-9-]{1,32}$' then
    raise exception 'Geçersiz hazır avatar.' using errcode = '22023';
  end if;
  if v_url is not null and v_url !~ (
    '^https://[^?#[:space:]]+/storage/v1/object/public/avatars/(platform|[0-9a-f-]{36})/'
    || v_uid::text || '\.(jpg|png|webp)(\?v=[0-9]+)?$'
  ) then
    raise exception 'Geçersiz fotoğraf adresi.' using errcode = '22023';
  end if;

  update public.profiles set avatar_url = v_url, avatar_preset = v_preset
   where id = v_uid and is_active = true;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    update public.platform_staff set avatar_url = v_url, avatar_preset = v_preset
     where id = v_uid and is_active = true;
    get diagnostics v_n = row_count;
  end if;
  if v_n = 0 then
    raise exception 'Profil bulunamadı.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all privileges on function public.set_my_avatar(text, text) from public, anon;
grant execute on function public.set_my_avatar(text, text) to authenticated;
