-- ============================================================
-- Müşteriye özel portföy sunumları
-- ============================================================
-- Danışman 1-5 portföy seçip müşteri adına şık bir sunum linki üretir
-- (/sunum/[token]). Token uuid → tahmin edilemez (open_houses.public_token
-- ve valuations.share_token deseni). property_ids uuid[] olarak tutulur:
-- sunum bir "anlık seçki"dir, ayrı bir join tablosunun getireceği yönetim
-- yükünü (sıralama, RLS, cascade) hak etmiyor; public sayfa id listesini
-- service role ile çözer ve silinmiş/taslağa dönmüş portföyleri atlar.

create table if not exists public.presentations (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  public_token   uuid        not null unique default gen_random_uuid(),
  title          text        not null,
  customer_name  text,
  property_ids   uuid[]      not null,
  note           text,
  created_by     uuid        references public.profiles(id),
  created_at     timestamptz not null default now(),
  view_count     int         not null default 0,
  last_viewed_at timestamptz
);

comment on table public.presentations is
  'Müşteriye özel portföy sunum linkleri (/sunum/[token]) — 1-5 portföylük seçki';
comment on column public.presentations.property_ids is
  'Sunuma giren portföy id''leri (sıralı, maks 5) — doğrulama action katmanında';
comment on column public.presentations.view_count is
  'Public sayfanın açılma sayısı (yaklaşık; her render''da +1)';

create index if not exists idx_presentations_tenant
  on public.presentations(tenant_id, created_at desc);

-- ============================================================
-- RLS — kiracı izolasyonu (bkz. 20260725000054: helper kullan)
-- ============================================================
alter table public.presentations enable row level security;

drop policy if exists presentations_tenant on public.presentations;
create policy presentations_tenant on public.presentations
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on policy presentations_tenant on public.presentations is
  'Kiracı izolasyonu — current_tenant_id() (bkz. 20260725000054). Public sayfa service role ile okur.';

grant all on public.presentations to authenticated, service_role;

-- Görüntüleme sayacı: atomik +1 (increment_listing_view deseni).
-- Public sayfa fire-and-forget çağırır; select+update yarışını önler.
create or replace function public.increment_presentation_view(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.presentations
     set view_count = view_count + 1,
         last_viewed_at = now()
   where id = p_id;
$$;

comment on function public.increment_presentation_view is
  '/sunum/[token] görüntüleme sayacı — atomik artırım, service role çağırır';

revoke all on function public.increment_presentation_view(uuid) from public, anon, authenticated;
grant execute on function public.increment_presentation_view(uuid) to service_role;
