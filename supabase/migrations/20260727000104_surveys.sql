-- ============================================================
-- Müşteri memnuniyet anketi (NPS) — /anket/[token]
-- ============================================================
-- Kapanan (stage='won') anlaşma sonrası müşteriye tek soruluk 0-10 puan
-- anketi. Link panelden üretilir ve danışman tarafından iletilir (SMS YOK —
-- İYS bu dalgada kapsam dışı). Public sayfa token'ı service role ile çözer
-- (presentations/open_houses public_token deseni). NPS raporu
-- /app/raporlar/memnuniyet sayfasında toplanır.

create table if not exists public.surveys (
  id           uuid        primary key default gen_random_uuid(),
  tenant_id    uuid        not null references public.tenants(id) on delete cascade,
  -- Anlaşma silinirse anket cevabı (NPS geçmişi) kalsın → set null.
  deal_id      uuid        references public.deals(id) on delete set null,
  customer_id  uuid        not null references public.customers(id) on delete cascade,
  -- Anketin danışmanı (anlaşmanın assigned_to'su) — düşük puanda bildirim hedefi.
  agent_id     uuid        references public.profiles(id) on delete set null,
  public_token uuid        not null unique default gen_random_uuid(),
  score        int         check (score between 0 and 10),
  comment      text,
  status       text        not null default 'pending' check (status in ('pending','answered')),
  sent_at      timestamptz not null default now(),
  answered_at  timestamptz
);

comment on table public.surveys is
  'Kapanış sonrası NPS anketi (/anket/[token]) — puan 0-10, link panelden kopyalanıp iletilir';
comment on column public.surveys.public_token is
  'Public anket sayfası için tahmin edilemez token (presentations deseni)';
comment on column public.surveys.score is
  'NPS puanı 0-10: 0-6 kötüleyen, 7-8 pasif, 9-10 destekleyen';

create index if not exists idx_surveys_tenant
  on public.surveys(tenant_id, sent_at desc);

-- Bir anlaşmaya EN FAZLA bir anket — mükerrer üretim 23505 ile action'da yakalanır.
create unique index if not exists idx_surveys_deal_unique
  on public.surveys(deal_id) where deal_id is not null;

-- ============================================================
-- RLS — kiracı izolasyonu (bkz. 20260725000054: helper kullan)
-- ============================================================
alter table public.surveys enable row level security;

drop policy if exists surveys_tenant on public.surveys;
create policy surveys_tenant on public.surveys
  for all
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

comment on policy surveys_tenant on public.surveys is
  'Kiracı izolasyonu — current_tenant_id(). Public anket sayfası service role ile okur/yazar.';

grant all on public.surveys to authenticated, service_role;
