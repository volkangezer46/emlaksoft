-- YD2 Sunum geri bildirimi: çok portföylü sunumda (/sunum/[token]) müşteri her ilan için "İlgileniyorum /
-- İlgilenmiyorum" + isteğe bağlı not bırakır. Danışmana bildirim düşer, kayıt müşteri kartının geçmişinde görünür
-- (customer_id doluysa) ve Sunumlar listesinde ilan bazında özetlenir.
--
-- Tasarım (portal_match_feedback 20260726000061 deseni):
--  * Yazma YALNIZ token doğrulamalı public server action'dan service_role ile (src/app/actions/presentation-feedback.ts):
--    token sunuma çözülür, ilan sunumun property_ids listesinde olmalı, ofis aktif, modül açık, IP hız sınırı.
--    Bu yüzden authenticated için insert/update/delete politikası ve yetkisi bilinçli olarak YOK.
--  * unique(presentation_id, property_id): müşteri fikrini değiştirebilir; upsert ile ilan başına tek satır.
--  * customer_id sunumun o anki müşteri bağının anlık kopyasıdır (müşteri kartı sorgusu indeksle gider);
--    müşteri silinirse satır kalır, bağ boşalır. Ofis sınırı bileşik FK ile (crm_tenant_relationship_boundaries deseni).
--  * Okuma: ofis içi, portföy görme izni (Sunumlar portföy modülünün alt sayfasıdır) — capability_* + InitPlan deseni.
-- KOD DAVRANIŞI: tablo yokken public action bildirimi yine gönderir (geri bildirim danışmana ulaşır), kayıt atlanır;
--   müşteri kartı ve Sunumlar listesi kaynağı boş sayar.
-- GERİ ALMA: supabase/rollbacks/20261015042000_presentation_feedback.rollback.sql (yalnız bu tablo).
-- RİSK: düşük (yeni tablo; mevcut nesnelere dokunmaz). İdempotent.

create table if not exists public.presentation_feedback (
  id              uuid        primary key default gen_random_uuid(),
  tenant_id       uuid        not null references public.tenants(id) on delete cascade,
  presentation_id uuid        not null references public.presentations(id) on delete cascade,
  property_id     uuid        not null,
  customer_id     uuid,
  verdict         text        not null check (verdict in ('interested', 'not_interested')),
  note            text        check (note is null or char_length(note) <= 500),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (presentation_id, property_id)
);

comment on table public.presentation_feedback is
  'Sunum (/sunum/[token]) ilan bazında müşteri geri bildirimi: interested / not_interested + not. Yazma yalnız service_role (token doğrulamalı public action).';
comment on column public.presentation_feedback.customer_id is
  'Sunumun geri bildirim anındaki müşteri bağı (presentations.customer_id kopyası); müşteri kartı geçmişi bunu okur.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'presentation_feedback_property_tenant_fkey') then
    alter table public.presentation_feedback
      add constraint presentation_feedback_property_tenant_fkey
      foreign key (property_id, tenant_id)
      references public.properties(id, tenant_id)
      on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'presentation_feedback_customer_tenant_fkey') then
    alter table public.presentation_feedback
      add constraint presentation_feedback_customer_tenant_fkey
      foreign key (customer_id, tenant_id)
      references public.customers(id, tenant_id)
      on delete set null (customer_id);
  end if;
end $$;

create index if not exists idx_presentation_feedback_customer
  on public.presentation_feedback (customer_id, updated_at desc)
  where customer_id is not null;
create index if not exists idx_presentation_feedback_tenant
  on public.presentation_feedback (tenant_id, updated_at desc);
create index if not exists idx_presentation_feedback_property
  on public.presentation_feedback (property_id);

alter table public.presentation_feedback enable row level security;

drop policy if exists capability_presentation_feedback_select on public.presentation_feedback;
create policy capability_presentation_feedback_select on public.presentation_feedback
  for select
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('properties'::text, 'view'::text))
  );

-- Yazma politikası bilinçli olarak YOK: kayıt token doğrulamalı public action'dan service_role ile yazılır.
revoke all on public.presentation_feedback from anon, authenticated;
grant select on public.presentation_feedback to authenticated;
grant all on public.presentation_feedback to service_role;

notify pgrst, 'reload schema';
