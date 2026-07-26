-- Müşteri portalı eşleşme geri bildirimi
--
-- Müşteri, token'lı portalındaki "Size Özel Portföyler" kartlarında
-- "Beğendim / İlgilenmiyorum" seçimi yapar. Danışman bu sinyali panelde görür.
--
-- Tasarım kararları:
--  * Yazma YALNIZCA token doğrulamalı server action üzerinden service_role ile
--    yapılır (musteri-portali sayfa deseni). Bu yüzden authenticated için
--    insert/update politikası bilinçli olarak yok — tenant kullanıcıları okur.
--  * unique(customer_id, property_id): müşteri fikrini değiştirebilir,
--    kayıt upsert ile güncellenir; portföy başına tek satır kalır.

create table if not exists public.portal_match_feedback (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id)    on delete cascade,
  customer_id uuid        not null references public.customers(id)  on delete cascade,
  property_id uuid        not null references public.properties(id) on delete cascade,
  verdict     text        not null check (verdict in ('liked', 'disliked')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (customer_id, property_id)
);

comment on table  public.portal_match_feedback         is 'Müşteri portalından gelen portföy beğen/geç geri bildirimi';
comment on column public.portal_match_feedback.verdict is 'liked = beğendi, disliked = ilgilenmiyor';

create index if not exists idx_pmf_tenant
  on public.portal_match_feedback(tenant_id, created_at desc);

create index if not exists idx_pmf_property
  on public.portal_match_feedback(property_id);

-- ============================================================
-- RLS — okuma tenant izolasyonlu; yazma yalnızca service_role
-- ============================================================
alter table public.portal_match_feedback enable row level security;

drop policy if exists pmf_tenant_select on public.portal_match_feedback;

create policy pmf_tenant_select on public.portal_match_feedback for select
  using (tenant_id = public.current_tenant_id());

-- Yazma politikası bilinçli olarak YOK: insert/update token doğrulamalı
-- portal aksiyonundan service_role ile yapılır.

grant select on public.portal_match_feedback to authenticated;
grant all    on public.portal_match_feedback to service_role;
