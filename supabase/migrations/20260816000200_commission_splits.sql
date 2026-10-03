-- Faz 2 / 02: commission_splits — komisyon paylarının profile_id'ye bağlı, sorgulanabilir kaydı.
--
-- NEDEN: commissions.splits jsonb payları ad etiketiyle tutuyor (ad değişince eşleşme kırılır) ve
-- RLS bir jsonb içini verimli/güvenli süzemez. Kazanç gizliliği (05) "bu satır benim payım mı?"
-- sorusunu SQL'de cevaplamak zorunda.
-- TASARIM KARARI (belge 3d önerisi değerlendirildi): jsonb'ye profile_id eklemek DB'de FK/RLS
-- sağlamaz; bu yüzden yeni tablo. Mükerrer değil: bugün commission_splits tablosu yok.
--  * BACKFILL YOK: mevcut jsonb olduğu gibi kalır (kod okuma yedeği). Tablo, kod geçişinde
--    (çift yazım) dolmaya başlar; eski kayıtlar için payı olmayan danışman kendi satırını
--    05'teki deal.assigned_to kuralıyla yine görür.
--  * Tutarlılık: (tenant_id, commission_id) -> commissions, (profile_id, tenant_id) -> profiles
--    bileşik FK'leri çapraz-tenant bağı fiziksel olarak engeller.
-- GERİ ALMA: rollbacks/20260816000200_commission_splits.rollback.sql (tablo yeni; veri kaybı yalnız
--   kod geçişinden sonra yazılmış satırlardır, jsonb kaynak kalır).
-- RİSK: düşük (yeni tablo, mevcut akışı değiştirmez). RLS: tenant + commissions yetkisi + kendi
--   satırı veya earnings_all; yazma commissions:edit + earnings_all:view.

create or replace function public.faz2_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.commission_splits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  commission_id uuid not null,
  -- null: ofis/dış taraf payı (ofis, referans, franchise); dolu: ofisteki bir kişi.
  profile_id uuid,
  kind text not null default 'advisor'
    check (kind in ('advisor', 'office', 'referral', 'franchise', 'other')),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  share_rate numeric(7,4) not null check (share_rate >= 0 and share_rate <= 100),
  amount numeric(14,2) not null default 0 check (amount >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_splits_commission_tenant_fkey
    foreign key (tenant_id, commission_id)
    references public.commissions (tenant_id, id) on delete cascade,
  constraint commission_splits_profile_tenant_fkey
    foreign key (profile_id, tenant_id)
    references public.profiles (id, tenant_id) on delete restrict,
  constraint commission_splits_advisor_has_profile
    check (kind <> 'advisor' or profile_id is not null)
);

comment on table public.commission_splits is
  'Komisyon payı satırları (profile_id''ye bağlı). commissions.splits jsonb legacy okuma yedeğidir; backfill yoktur.';

create unique index if not exists uq_commission_splits_id_tenant
  on public.commission_splits (id, tenant_id);
create index if not exists idx_commission_splits_commission
  on public.commission_splits (tenant_id, commission_id);
create index if not exists idx_commission_splits_profile
  on public.commission_splits (tenant_id, profile_id) where profile_id is not null;

drop trigger if exists trg_commission_splits_touch on public.commission_splits;
create trigger trg_commission_splits_touch
before update on public.commission_splits
for each row execute function public.faz2_touch_updated_at();

alter table public.commission_splits enable row level security;

-- SELECT: kendi payı VEYA earnings_all (owner/gm/accounting). Ofis/dış pay satırları (profile_id null)
-- yalnız earnings_all'a görünür.
create policy commission_splits_select on public.commission_splits
for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('commissions', 'view'))
  and (
    profile_id = (select auth.uid())
    or (select public.has_effective_permission('earnings_all', 'view'))
  )
);

create policy commission_splits_insert on public.commission_splits
for insert to authenticated
with check (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('commissions', 'edit'))
  and (select public.has_effective_permission('earnings_all', 'view'))
);

create policy commission_splits_update on public.commission_splits
for update to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('commissions', 'edit'))
  and (select public.has_effective_permission('earnings_all', 'view'))
)
with check (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('commissions', 'edit'))
  and (select public.has_effective_permission('earnings_all', 'view'))
);

create policy commission_splits_delete on public.commission_splits
for delete to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.has_effective_permission('commissions', 'edit'))
  and (select public.has_effective_permission('earnings_all', 'view'))
);

revoke all on table public.commission_splits from public, anon;
grant select, insert, update, delete on table public.commission_splits to authenticated;
grant all on table public.commission_splits to service_role;
