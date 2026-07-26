-- Ofis içi duyuru panosu (announcements + announcement_reads)
--
-- Neden:
--  * Ofis sahibi/müdürün ekibe duyurusu ("Cuma toplantı 10:00", "Yeni komisyon
--    oranı") WhatsApp gruplarında kayboluyordu; kim okudu kim okumadı belirsizdi.
--  * Duyurular dashboard'da band olarak görünür, danışman "Okudum" der;
--    okunma durumu announcement_reads'ten takip edilir ("5/8 okudu").
--
-- Tasarım kararları:
--  * level text + check (enum değil): 3 sabit seviye için enum migration yükü
--    gereksiz; UI rozet rengi bu değerden türer (info|warning|success).
--  * starts_at/ends_at yayın penceresi — ends_at null = süresiz. Bant sorgusu
--    starts_at <= now() AND (ends_at is null OR ends_at > now()).
--  * announcement_reads: pk(announcement_id, user_id) — upsert idempotent,
--    tekrar "Okudum" tıklaması hata üretmez.
--  * reads'te tenant_id yok: satır announcements'a cascade fk ile bağlı; RLS
--    okuma tarafı parent'ın tenant'ına, yazma tarafı kullanıcının kendisine
--    (user_id = auth.uid()) kilitli — başkası adına okundu işaretlenemez.
--  * Yazma yetkisi (create/update/delete) uygulama katmanında
--    requirePermission("settings","edit") ile kapılı; RLS tenant sınırını çizer.

create table if not exists public.announcements (
  id         uuid        primary key default gen_random_uuid(),
  tenant_id  uuid        not null references public.tenants(id) on delete cascade,
  title      text        not null check (char_length(title) between 1 and 200),
  body       text        not null check (char_length(body) between 1 and 4000),
  level      text        not null default 'info' check (level in ('info', 'warning', 'success')),
  pinned     boolean     not null default false,
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  created_by uuid        references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table  public.announcements            is 'Ofis içi duyuru panosu — sahip/müdür yayınlar, ekip dashboard bandında görür';
comment on column public.announcements.level      is 'Görsel seviye: info (marka), warning (amber), success (mint)';
comment on column public.announcements.pinned     is 'Sabitli duyuru bantta her zaman önce gelir';
comment on column public.announcements.ends_at    is 'Yayın bitişi — null = süresiz yayında';
comment on column public.announcements.created_by is 'Yayınlayan profil — kullanıcı silinirse null kalır';

create index if not exists idx_announcements_tenant_window
  on public.announcements(tenant_id, starts_at, ends_at);

create table if not exists public.announcement_reads (
  announcement_id uuid        not null references public.announcements(id) on delete cascade,
  user_id         uuid        not null references public.profiles(id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

comment on table public.announcement_reads is 'Duyuru okundu bilgisi — pk(announcement_id, user_id), upsert idempotent';

create index if not exists idx_announcement_reads_user
  on public.announcement_reads(user_id);

-- ============================================================
-- RLS
-- ============================================================
alter table public.announcements enable row level security;

drop policy if exists announcements_tenant_select on public.announcements;
drop policy if exists announcements_tenant_insert on public.announcements;
drop policy if exists announcements_tenant_update on public.announcements;
drop policy if exists announcements_tenant_delete on public.announcements;

create policy announcements_tenant_select on public.announcements for select
  using (tenant_id = public.current_tenant_id());

create policy announcements_tenant_insert on public.announcements for insert
  with check (tenant_id = public.current_tenant_id());

create policy announcements_tenant_update on public.announcements for update
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy announcements_tenant_delete on public.announcements for delete
  using (tenant_id = public.current_tenant_id());

alter table public.announcement_reads enable row level security;

drop policy if exists announcement_reads_select on public.announcement_reads;
drop policy if exists announcement_reads_insert on public.announcement_reads;
drop policy if exists announcement_reads_update on public.announcement_reads;
drop policy if exists announcement_reads_delete on public.announcement_reads;

-- Okuma: aynı tenant'ın duyurusuna bağlı satırlar (yönetim "5/8 okudu" sayar)
create policy announcement_reads_select on public.announcement_reads for select
  using (exists (
    select 1 from public.announcements a
    where a.id = announcement_id and a.tenant_id = public.current_tenant_id()
  ));

-- Yazma: yalnız kendi adına ve kendi tenant'ının duyurusuna
create policy announcement_reads_insert on public.announcement_reads for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.announcements a
      where a.id = announcement_id and a.tenant_id = public.current_tenant_id()
    )
  );

create policy announcement_reads_update on public.announcement_reads for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy announcement_reads_delete on public.announcement_reads for delete
  using (user_id = auth.uid());

grant all on public.announcements to authenticated, service_role;
grant all on public.announcement_reads to authenticated, service_role;
