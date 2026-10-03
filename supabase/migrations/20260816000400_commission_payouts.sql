-- Faz 2 / 04: commission_payouts — danışmana hakediş (ödeme) kaydı, onay ve denetim.
--
-- NEDEN: commissions.status müşteriden TAHSİLAT durumudur; danışmana ödeme ayrı bir yaşam döngüsü
-- (hesaplandı -> onaylandı -> ödendi) ve ayrı denetim ister. Karıştırılmaz (belge 3d).
-- TASARIM:
--   * status: pending -> approved -> paid; cancelled her aşamadan (paid hariç) olabilir.
--   * Tutarlılık check'leri: approved/paid için approved_at, paid için paid_at + paid_by zorunlu.
--   * Çift ödeme engeli: split_id doluysa iptal edilmemiş tek hakediş (kısmi unique index).
--   * Para/kimlik alanları onaydan sonra değişmez (trigger); ödenmiş satır silinemez.
--   * Denetim: her INSERT/UPDATE/DELETE audit_logs'a yazılır (SECURITY DEFINER trigger; audit_logs
--     authenticated'a kapalı olduğu için başka yol yok). Yeni service_role/admin-client kullanımı YOK.
-- GERİ ALMA: rollbacks/20260816000400_commission_payouts.rollback.sql (tablo + trigger fonksiyonları).
-- RİSK: orta-düşük: yeni tablo; audit trigger'ı audit_logs şemasına bağlıdır (tenant_id, actor_id, action,
--   entity_type, entity_id, old_value, new_value). Bu sütunlar init'ten beri sabit.
--   commission_id FK'si ON DELETE RESTRICT: hakedişi olan komisyon atomik "yeniden aç" akışıyla
--   silinemez (para izi korunur); akış bu hatayı kullanıcıya anlamlı iletmelidir.
-- RLS: SELECT kendi hakedişi VEYA earnings_all; yazma yalnız owner/gm (belge 3d). Muhasebe yazımı
--   açılacaksa ayrı karar ve yeni migration gerekir.

create table if not exists public.commission_payouts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  commission_id uuid not null,
  split_id uuid,
  profile_id uuid not null,
  amount numeric(14,2) not null check (amount >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'paid', 'cancelled')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  paid_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz,
  payment_ref text check (payment_ref is null or char_length(payment_ref) <= 200),
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_payouts_commission_tenant_fkey
    foreign key (tenant_id, commission_id)
    references public.commissions (tenant_id, id) on delete restrict,
  constraint commission_payouts_split_tenant_fkey
    foreign key (split_id, tenant_id)
    references public.commission_splits (id, tenant_id) on delete restrict,
  constraint commission_payouts_profile_tenant_fkey
    foreign key (profile_id, tenant_id)
    references public.profiles (id, tenant_id) on delete restrict,
  constraint commission_payouts_approved_consistency
    check (status not in ('approved', 'paid') or approved_at is not null),
  constraint commission_payouts_paid_consistency
    check (status <> 'paid' or (paid_at is not null and paid_by is not null))
);

comment on table public.commission_payouts is
  'Danışman hakedişi (ödeme yaşam döngüsü). commissions.status tahsilattır, bununla karıştırılmaz.';

create unique index if not exists uq_commission_payouts_active_split
  on public.commission_payouts (split_id)
  where split_id is not null and status <> 'cancelled';
create index if not exists idx_commission_payouts_commission
  on public.commission_payouts (tenant_id, commission_id);
create index if not exists idx_commission_payouts_profile
  on public.commission_payouts (tenant_id, profile_id, status);

-- Onay/ödeme sonrası kimlik ve tutar değişmez; ödenmiş kayıt silinemez.
create or replace function public.guard_commission_payout_immutability()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'paid' then
      raise exception 'Odenmis hakedis silinemez; iptal icin yeni duzeltme kaydi acin.' using errcode = '42501';
    end if;
    return old;
  end if;

  if old.status in ('approved', 'paid') and (
       new.tenant_id is distinct from old.tenant_id
    or new.commission_id is distinct from old.commission_id
    or new.split_id is distinct from old.split_id
    or new.profile_id is distinct from old.profile_id
    or new.amount is distinct from old.amount
  ) then
    raise exception 'Onaylanmis hakedisin kimlik ve tutar alanlari degistirilemez.' using errcode = '42501';
  end if;

  if old.status = 'paid' and new.status is distinct from 'paid' then
    raise exception 'Odenmis hakedis geri cevrilemez.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_commission_payout_immutability()
  from public, anon, authenticated;

create or replace function public.audit_commission_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.commission_payouts;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    v_row := old;
    v_old := to_jsonb(old);
  elsif tg_op = 'UPDATE' then
    v_row := new;
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
  else
    v_row := new;
    v_new := to_jsonb(new);
  end if;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (
    v_row.tenant_id,
    auth.uid(),
    'commission_payout.' || lower(tg_op),
    'commission_payout',
    v_row.id,
    v_old,
    v_new
  );
  return v_row;
end;
$$;

revoke all on function public.audit_commission_payout()
  from public, anon, authenticated;

drop trigger if exists trg_commission_payouts_touch on public.commission_payouts;
create trigger trg_commission_payouts_touch
before update on public.commission_payouts
for each row execute function public.faz2_touch_updated_at();

drop trigger if exists trg_commission_payouts_guard on public.commission_payouts;
create trigger trg_commission_payouts_guard
before update or delete on public.commission_payouts
for each row execute function public.guard_commission_payout_immutability();

drop trigger if exists trg_commission_payouts_audit on public.commission_payouts;
create trigger trg_commission_payouts_audit
after insert or update or delete on public.commission_payouts
for each row execute function public.audit_commission_payout();

alter table public.commission_payouts enable row level security;

create policy commission_payouts_select on public.commission_payouts
for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (
    profile_id = (select auth.uid())
    or (select public.has_effective_permission('earnings_all', 'view'))
  )
);

create policy commission_payouts_insert on public.commission_payouts
for insert to authenticated
with check (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
);

create policy commission_payouts_update on public.commission_payouts
for update to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
)
with check (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
);

create policy commission_payouts_delete on public.commission_payouts
for delete to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.current_profile_role()) in ('owner', 'gm')
);

revoke all on table public.commission_payouts from public, anon;
grant select, insert, update, delete on table public.commission_payouts to authenticated;
grant all on table public.commission_payouts to service_role;
