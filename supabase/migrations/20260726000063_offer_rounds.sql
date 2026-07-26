-- Pazarlık geçmişi (offer_rounds)
--
-- Neden: offers tablosunda tek counter_amount alanı var — tur tur pazarlık
-- kaydı tutulamıyor (denetimde tespit edilen eksik). Alıcı/satıcı tarafların
-- teklif turları kalıcı ve sıralı tutulmalı ki müzakere seyri izlenebilsin.
--
-- Tasarım kararları:
--  * round_no uygulama tarafında son+1 olarak atanır; (offer_id, round_no)
--    unique index hem sıralı okuma hem çift kayıt koruması sağlar.
--  * counter_amount GERİYE UYUMLU kalır: karşı teklif akışı hem kolonu
--    güncellemeye devam eder hem seller turu olarak buraya yazar.
--  * Eski kayıtlar backfill edilmez — UI, offer_rounds boşsa amount /
--    counter_amount ikilisinden sentetik görünüm üretir.

-- ============================================================
-- Tablo
-- ============================================================
create table if not exists public.offer_rounds (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  offer_id    uuid        not null references public.offers(id)  on delete cascade,
  round_no    int         not null,
  side        text        not null check (side in ('buyer', 'seller')),
  amount      numeric(14,2) not null,
  note        text,
  created_by  uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table  public.offer_rounds          is 'Teklif pazarlık turları — alıcı/satıcı karşılıklı teklif geçmişi';
comment on column public.offer_rounds.round_no is 'Teklif içinde sıra numarası (1''den başlar, son+1)';
comment on column public.offer_rounds.side     is 'Turu veren taraf: buyer (alıcı) | seller (satıcı)';

create unique index if not exists idx_offer_rounds_offer_round
  on public.offer_rounds(offer_id, round_no);

create index if not exists idx_offer_rounds_tenant
  on public.offer_rounds(tenant_id, created_at desc);

-- ============================================================
-- RLS — diğer tenant tabloları ile aynı desen
-- ============================================================
alter table public.offer_rounds enable row level security;

drop policy if exists offer_rounds_tenant        on public.offer_rounds;
drop policy if exists offer_rounds_tenant_insert on public.offer_rounds;

create policy offer_rounds_tenant on public.offer_rounds
  using (tenant_id = public.current_tenant_id());

create policy offer_rounds_tenant_insert on public.offer_rounds for insert
  with check (tenant_id = public.current_tenant_id());

grant all on public.offer_rounds to authenticated, service_role;
