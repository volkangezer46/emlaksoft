-- Tapu süreci adım takibi (satış anlaşması): teklif kabul -> kapora -> ekspertiz/kredi -> DASK -> TKGM randevusu
-- -> harç/döner sermaye -> tapu devri -> anahtar teslim. Her adım için planlanan tarih, sorumlu, not ve "yapıldı" damgası.
--
-- NEDEN: Anlaşma detayında yalnız evrak listesi ve GÖS/tapu randevu alanı vardı; sürecin hangi adımda olduğu, kimin
--   elinde olduğu ve gecikme görünmüyordu. Müşteri portalında da alıcı/satıcıya ilerleme gösterilemiyordu.
-- NE: (1) deal_process_steps (deal_id + step_key tekil; adım anahtarı CHECK ile sabit sekiz değer);
--     (2) RLS: okuma ofis içinde (anlaşma görünürlüğüyle), yazma 'commissions' düzenleme izniyle ve yalnız aynı ofisin anlaşmasına.
-- GİZLİLİK: para/IBAN alanı YOK. Portal (token'lı) bu tabloyu service_role ile okur ve YALNIZ adım adı/durum/tarih gösterir;
--   not ve sorumlu kişi portala gitmez (kod: src/lib/deal-process.ts toPortalSteps).
-- GERİ ALMA: rollbacks/20261008001500_deal_process_steps.rollback.sql (tablo düşer; kod tablo yokken bölümü "etkin değil" der).
-- RİSK: düşük (yeni tablo; mevcut tablo/politika değişmez).

set local lock_timeout = '5s';

create table if not exists public.deal_process_steps (
  id          uuid        primary key default gen_random_uuid(),
  tenant_id   uuid        not null references public.tenants(id) on delete cascade,
  deal_id     uuid        not null references public.deals(id) on delete cascade,
  step_key    text        not null
    check (step_key in ('offer_accepted','deposit','appraisal_credit','dask','tkgm_appointment','fees','title_transfer','key_handover')),
  planned_at  timestamptz,
  done_at     timestamptz,
  assigned_to uuid        references public.profiles(id) on delete set null,
  note        text        check (note is null or char_length(note) <= 500),
  updated_by  uuid        references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint deal_process_steps_unique unique (deal_id, step_key)
);

comment on table public.deal_process_steps is 'Satış anlaşması tapu süreci adımları (8 sabit adım). Para/IBAN tutulmaz. Portal yalnız adım/durum/tarih gösterir; not ve sorumlu iç kullanımdır.';

create index if not exists idx_deal_process_steps_tenant_deal on public.deal_process_steps (tenant_id, deal_id);
create index if not exists idx_deal_process_steps_open_planned on public.deal_process_steps (tenant_id, planned_at) where done_at is null and planned_at is not null;

alter table public.deal_process_steps enable row level security;

drop policy if exists deal_process_steps_select on public.deal_process_steps;
create policy deal_process_steps_select on public.deal_process_steps
  for select to authenticated using (tenant_id = public.current_active_tenant_id());

drop policy if exists deal_process_steps_insert on public.deal_process_steps;
create policy deal_process_steps_insert on public.deal_process_steps
  for insert to authenticated
  with check (
    tenant_id = public.current_active_tenant_id()
    and public.has_effective_permission('commissions', 'edit')
    and exists (select 1 from public.deals d where d.id = deal_id and d.tenant_id = deal_process_steps.tenant_id)
  );

drop policy if exists deal_process_steps_update on public.deal_process_steps;
create policy deal_process_steps_update on public.deal_process_steps
  for update to authenticated
  using (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('commissions', 'edit'))
  with check (
    tenant_id = public.current_active_tenant_id()
    and public.has_effective_permission('commissions', 'edit')
    and exists (select 1 from public.deals d where d.id = deal_id and d.tenant_id = deal_process_steps.tenant_id)
  );

drop policy if exists deal_process_steps_delete on public.deal_process_steps;
create policy deal_process_steps_delete on public.deal_process_steps
  for delete to authenticated
  using (tenant_id = public.current_active_tenant_id() and public.has_effective_permission('commissions', 'edit'));
