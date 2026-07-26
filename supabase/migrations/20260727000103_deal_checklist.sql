-- Anlaşma kapanış dosyası — evrak kontrol listesi (deal_checklist_items)
--
-- Neden:
--  * Satış/kiralama kapanışında gereken evraklar (tapu fotokopisi, kimlik,
--    DASK, vekaletname, enerji kimlik belgesi vb.) hiçbir yerde takip
--    edilmiyordu; eksik evrak tapu randevusunda ortaya çıkıyordu.
--  * Anlaşma başına madde listesi: zorunlu/opsiyonel ayrımı, tamamlanma
--    yüzdesi ve "dosya tamam" durumu buradan hesaplanır.
--
-- Tasarım kararları:
--  * done_by on delete set null — işaretleyen kullanıcı silinse de iz kalır.
--  * label 1..200 karakter check — boş madde DB'de de kesilir.
--  * file_url şimdilik serbest metin (harici link/DMS yolu); dosya yükleme
--    altyapısına bağlamak ayrı iş.
--  * update/delete tenant genelinde açık (deal_notes'un yazar kilidi burada
--    YOK): evrak dosyası ekip işidir, kapatan kişi tek sahibi değildir.

create table if not exists public.deal_checklist_items (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id)  on delete cascade,
  deal_id     uuid        not null references public.deals(id)    on delete cascade,
  label       text        not null check (char_length(label) between 1 and 200),
  is_required boolean     not null default true,
  is_done     boolean     not null default false,
  done_at     timestamptz,
  done_by     uuid        references public.profiles(id) on delete set null,
  file_url    text,
  note        text        check (note is null or char_length(note) <= 500),
  sort_order  int         not null default 0,
  created_at  timestamptz not null default now()
);

comment on table  public.deal_checklist_items             is 'Anlaşma kapanış dosyası — evrak kontrol listesi (tapu, kimlik, DASK vb.)';
comment on column public.deal_checklist_items.is_required is 'Zorunlu evrak mı — dosya tamamlanma yüzdesi yalnız zorunlulardan hesaplanır';
comment on column public.deal_checklist_items.done_by     is 'Maddeyi tamamlandı işaretleyen profil — kullanıcı silinirse null kalır';
comment on column public.deal_checklist_items.file_url    is 'Evrağın harici bağlantısı/yolu (opsiyonel, serbest metin)';

create index if not exists idx_deal_checklist_items_deal
  on public.deal_checklist_items(deal_id);
create index if not exists idx_deal_checklist_items_tenant_deal
  on public.deal_checklist_items(tenant_id, deal_id, sort_order);

-- ============================================================
-- RLS — tenant deseni (bkz. deal_costs / deal_notes)
-- ============================================================
alter table public.deal_checklist_items enable row level security;

drop policy if exists deal_checklist_tenant_select on public.deal_checklist_items;
drop policy if exists deal_checklist_tenant_insert on public.deal_checklist_items;
drop policy if exists deal_checklist_tenant_update on public.deal_checklist_items;
drop policy if exists deal_checklist_tenant_delete on public.deal_checklist_items;

create policy deal_checklist_tenant_select on public.deal_checklist_items for select
  using (tenant_id = public.current_tenant_id());

create policy deal_checklist_tenant_insert on public.deal_checklist_items for insert
  with check (tenant_id = public.current_tenant_id());

create policy deal_checklist_tenant_update on public.deal_checklist_items for update
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy deal_checklist_tenant_delete on public.deal_checklist_items for delete
  using (tenant_id = public.current_tenant_id());

grant all on public.deal_checklist_items to authenticated, service_role;
