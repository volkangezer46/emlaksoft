-- YD4 saha kullanimi: (1) fotograf boyutlari, (2) cevrimdisi gonderim kuyrugu icin istemci istek kimligi (cift kayit freni).
--
-- (1) property_media.width / height: istemci yuklemeden once olcer (EXIF yonu uygulanmis, son yuklenen dosyanin pikselleri),
--     finalize sonrasi ayni satira yazilir. Eski satirlar NULL kalir (olculmemis = uyari yok). Galeri dusuk cozunurluk uyarisi
--     ve kapak onerisi bu iki sutunu okur; kod sutun yokken olcumu yalniz o oturumda gosterir, kaydetmez.
-- (2) client_submissions: hizli kayit formlari baglanti yokken kuyruga alinir ve baglanti gelince gonderilir. Yanit kaybolursa
--     (istek sunucuya ulasti, cevap gelmedi) kuyruk ayni istegi yeniden gonderir; ayni (tenant, kullanici, istek kimligi)
--     ikinci kez kayit acmaz, ilk kaydin kimligini dondurur. Once satir "talep" edilir (insert, birincil anahtar), kayit
--     acilinca completed_at + result_id yazilir; basarisiz kayitta satir silinir (duzeltilen form ayni kimlikle gider).
--     Satir yalniz istegi yapan kullaniciya gorunur.
--     30 gunden eski satirlar uygulama tarafinda kullanicinin kendi satirlariyla budanir (cron yok).
-- (3) geo_neighborhoods / geo_districts (lat, lng) kismi indeksleri: GPS'ten en yakin mahalle onerisi (koordinatsiz satirlar
--     indekse girmez; bugun koordinat yalniz il duzeyinde dolu, indeks bos baslar).
-- Bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir (kod tablo/sutun yokken cift kayit frenini atlar, boyutu yazmaz).
-- Idempotent (if not exists / drop policy if exists). Geri alma: supabase/rollbacks/20261015044000_field_capture.rollback.sql.

alter table public.property_media add column if not exists width integer;
alter table public.property_media add column if not exists height integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.property_media'::regclass and conname = 'property_media_dimensions_check'
  ) then
    alter table public.property_media
      add constraint property_media_dimensions_check
      check (
        (width is null or width between 1 and 100000)
        and (height is null or height between 1 and 100000)
      );
  end if;
end;
$$;

create table if not exists public.client_submissions (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  kind text not null check (kind in ('customer', 'call', 'appointment', 'property')),
  result_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id, request_id)
);

create index if not exists client_submissions_user_created_idx
  on public.client_submissions (user_id, created_at);

alter table public.client_submissions enable row level security;

drop policy if exists client_submissions_select on public.client_submissions;
create policy client_submissions_select on public.client_submissions
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and user_id = (select auth.uid()));

drop policy if exists client_submissions_insert on public.client_submissions;
create policy client_submissions_insert on public.client_submissions
  for insert to authenticated
  with check (tenant_id = (select public.current_active_tenant_id()) and user_id = (select auth.uid()));

drop policy if exists client_submissions_update on public.client_submissions;
create policy client_submissions_update on public.client_submissions
  for update to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and user_id = (select auth.uid()))
  with check (tenant_id = (select public.current_active_tenant_id()) and user_id = (select auth.uid()));

drop policy if exists client_submissions_delete on public.client_submissions;
create policy client_submissions_delete on public.client_submissions
  for delete to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and user_id = (select auth.uid()));

revoke all on public.client_submissions from anon;
grant select, insert, update, delete on public.client_submissions to authenticated;
grant all on public.client_submissions to service_role;

-- (3) GPS'ten mahalle onerisi: koordinatli mahalle/ilce aramasi icin kismi indeks (koordinat yuklenince devreye girer).
create index if not exists geo_neighborhoods_latlng_idx on public.geo_neighborhoods (lat, lng) where lat is not null and lng is not null;
create index if not exists geo_districts_latlng_idx on public.geo_districts (lat, lng) where lat is not null and lng is not null;

notify pgrst, 'reload schema';
