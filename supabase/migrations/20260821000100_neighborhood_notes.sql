-- F5: Mahalle notu — ofis içi saha notu (ulaşım, okul, gürültü, yatırım potansiyeli, dikkat edilecekler).
-- YALNIZ OFİS İÇİ: public/anon erişimi YOK (grant yalnız authenticated). Forward-only, yeniden çalıştırılabilir.
-- TASLAK: canlı uygulama yalnız backup/PITR doğrulandıktan sonra kontrollü `npm run db:migrate` ile yapılır.
-- Uygulama tarafı tablo yokken "etkin değil" der (src/lib/neighborhood-notes).

create table if not exists public.neighborhood_notes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  neighborhood_id uuid not null references public.geo_neighborhoods(id),
  tags            text[] not null default '{}'
    check (tags <@ array['ulasim','okul','gurultu','yatirim','dikkat','genel']::text[]),
  body            text not null check (char_length(btrim(body)) between 3 and 2000),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index if not exists idx_neighborhood_notes_tenant_neighborhood
  on public.neighborhood_notes (tenant_id, neighborhood_id)
  where deleted_at is null;

create index if not exists idx_neighborhood_notes_tenant_created
  on public.neighborhood_notes (tenant_id, created_at desc)
  where deleted_at is null;

alter table public.neighborhood_notes enable row level security;

drop policy if exists neighborhood_notes_tenant_select on public.neighborhood_notes;
create policy neighborhood_notes_tenant_select on public.neighborhood_notes
  for select using (tenant_id = public.current_tenant_id());

drop policy if exists neighborhood_notes_tenant_insert on public.neighborhood_notes;
create policy neighborhood_notes_tenant_insert on public.neighborhood_notes
  for insert with check (tenant_id = public.current_tenant_id());

drop policy if exists neighborhood_notes_tenant_update on public.neighborhood_notes;
create policy neighborhood_notes_tenant_update on public.neighborhood_notes
  for update using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

-- Silme uygulamada yumuşaktır (deleted_at); gerçek DELETE yalnız ofis kapsamında izinlidir.
drop policy if exists neighborhood_notes_tenant_delete on public.neighborhood_notes;
create policy neighborhood_notes_tenant_delete on public.neighborhood_notes
  for delete using (tenant_id = public.current_tenant_id());

revoke all on public.neighborhood_notes from anon;
grant select, insert, update, delete on public.neighborhood_notes to authenticated;
grant all on public.neighborhood_notes to service_role;

comment on table public.neighborhood_notes is
  'Ofis içi mahalle saha notları. Public vitrin/portal yüzeyine ASLA çıkmaz; yalnız kendi kiracısı okur/yazar.';

notify pgrst, 'reload schema';
