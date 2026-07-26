-- İşlem dosyası: offers.deal_id bağı + deal_costs (kapora / masraf kalemleri)
--
-- Neden:
--  * Teklif ↔ anlaşma bağı bugüne dek portföy+müşteri ikilisinden YAKLAŞIK
--    kuruluyordu (teklif ve anlaşma detay sayfalarındaki notlara bakın).
--    Kabul edilen teklif anlaşmaya dönüştürüldüğünde kesin bağ gerekir →
--    offers.deal_id.
--  * Anlaşma kapanış sürecindeki paranın (kapora, tapu harcı, ekspertiz,
--    dışarıya ödenen komisyon vb.) hiçbir yerde kaydı yoktu → deal_costs.
--
-- Tasarım kararları:
--  * offers.deal_id NULL bırakılabilir ve on delete set null — anlaşma
--    silinirse teklif kaydı yaşamaya devam eder, yalnızca bağ düşer.
--  * deal_costs.kind kapalı liste (check) — UI rozetleri ve toplamlar tür
--    üzerinden hesaplanıyor; serbest metin etiketi ayrıca label'da.
--  * paid/paid_at ikilisi: paid_at uygulama tarafında toggle ile yazılır.

-- ============================================================
-- offers.deal_id — kabulden doğan anlaşmaya kesin bağ
-- ============================================================
alter table public.offers
  add column if not exists deal_id uuid references public.deals(id) on delete set null;

comment on column public.offers.deal_id is
  'Teklifin dönüştürüldüğü / bağlandığı anlaşma (kabul sonrası atanır)';

create index if not exists idx_offers_deal_id on public.offers (deal_id);

-- ============================================================
-- deal_costs — anlaşma işlem dosyası kalemleri
-- ============================================================
create table if not exists public.deal_costs (
  id         uuid          primary key default gen_random_uuid(),
  tenant_id  uuid          not null references public.tenants(id) on delete cascade,
  deal_id    uuid          not null references public.deals(id)   on delete cascade,
  kind       text          not null check (kind in ('kapora', 'tapu_harci', 'ekspertiz', 'komisyon_dis', 'diger')),
  label      text,
  amount     numeric(14,2) not null,
  paid       boolean       not null default false,
  paid_at    timestamptz,
  notes      text,
  created_by uuid          references public.profiles(id) on delete set null,
  created_at timestamptz   not null default now()
);

comment on table  public.deal_costs        is 'Anlaşma işlem dosyası — kapora ve masraf kalemleri';
comment on column public.deal_costs.kind   is 'Kalem türü: kapora | tapu_harci | ekspertiz | komisyon_dis (dışarıya ödenen komisyon) | diger';
comment on column public.deal_costs.label  is 'Serbest etiket — tür rozetinin yanında gösterilir';
comment on column public.deal_costs.paid   is 'Ödendi mi — UI''da toggle; paid_at uygulama tarafında yazılır';

create index if not exists idx_deal_costs_deal
  on public.deal_costs(deal_id, created_at);

create index if not exists idx_deal_costs_tenant
  on public.deal_costs(tenant_id, created_at desc);

-- ============================================================
-- RLS — diğer tenant tabloları ile aynı desen (bkz. offer_rounds)
-- ============================================================
alter table public.deal_costs enable row level security;

drop policy if exists deal_costs_tenant        on public.deal_costs;
drop policy if exists deal_costs_tenant_insert on public.deal_costs;

create policy deal_costs_tenant on public.deal_costs
  using (tenant_id = public.current_tenant_id());

create policy deal_costs_tenant_insert on public.deal_costs for insert
  with check (tenant_id = public.current_tenant_id());

grant all on public.deal_costs to authenticated, service_role;
