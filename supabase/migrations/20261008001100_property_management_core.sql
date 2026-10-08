-- Mülk yönetimi omurgası (M1): kira tahsilat kaydı + yönetim sözleşmesi + mülk sahibi hakediş defteri.
--
-- NEDEN: Kiralamada tahakkuk yalnız "ödendi/bekliyor" işaretiydi; kısmi ödeme, makbuz, yöntem, geri alma yoktu. Mülkü kiralayıp
--   mülk sahibine kira ödeyen ofisler yönetim ücretini ve mülk sahibine ödemeyi takip edemiyordu.
-- İÇERİK:
--   1) rent_charges: status'e 'partial' (kısmi) eklenir + paid_amount (ödenen toplam; rent_payments'tan türer).
--   2) rent_receipt_counters + rent_payments: tahsilat kaydı (yöntem, banka/açıklama, ofis başına otomatik sıralı makbuz no,
--      yönetim ücreti anlık değeri, iptal = silme yok; iptal nedeni + kim/ne zaman). Yazma YALNIZ RPC ile (record_rent_payment /
--      void_rent_payment: tutar/tahakkuk kilidi, makbuz sırası, durum türetme ve denetim kaydı tek transaction).
--   3) rental_management_agreements: kira başına yönetim sözleşmesi (yönetiyor mu, ücret % veya sabit TL/ay, ödeme günü, mülk sahibi
--      IBAN'ı = kişisel veri; okuma/yazma yalnız rentals:edit). Uygulama IBAN'ı maskeli gösterir, AI'ya göndermez.
--   4) owner_payouts: mülk sahibine yapılan ödeme kaydı (yöntem, dekont no); iptal edilebilir, silinmez. Yazma RPC ile.
--   5) owner_charge_links: mülke ait gider/aidatın hakedişe yansıtılması (tek kaynak; aynı gider iki hakedişe girmez).
--   6) property_management_settings: ofis ayarı (gecikme bedeli; KAPALI doğar).
--   7) rent_reminders.kind'a 'owner_payout' (mülk sahibine ödeme günü hatırlatması; tablo yoksa atlanır).
--   8) Eski "ödendi" tahakkuklar için tek seferlik geri doldurma: rent_payments satırı (legacy) + paid_amount + makbuz no.
-- Hakediş bakiyesi SAKLANMAZ; saf fonksiyonla (src/lib/property-management/ledger.ts) tahsilat − ücret − gider − aidat − ödemelerden türer.
-- RLS: tüm okumalar has_effective_permission('rentals', ...) kapılı; mülk sahibi finansmanı (sözleşme, ödeme, bağlantı) rentals:edit ister.
-- BAĞIMLILIK: 20260726000074 (rentals/rent_charges), 20260809000020 (idx_rentals_id_tenant_unique), 20260802000300
--   (current_active_tenant_id / has_effective_permission), audit_logs, expenses, property_dues. rent_reminders varsa genişler.
-- GERİ ALMA: rollbacks/20261008001100_property_management_core.rollback.sql (yeni tablolar/fonksiyonlar düşer; rent_charges eski
--   sınırına döner: 'partial' satırlar 'pending'e çekilir; tahsilat kayıtları KAYBOLUR, paid durumundakiler paid kalır).
-- RİSK: orta (rent_charges status CHECK'i genişler, tek seferlik geri doldurma). Kod tablolar yokken eski davranışa düşer.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.rentals') is null
     or pg_catalog.to_regclass('public.rent_charges') is null
     or pg_catalog.to_regclass('public.expenses') is null
     or pg_catalog.to_regclass('public.property_dues') is null
     or pg_catalog.to_regclass('public.audit_logs') is null
     or pg_catalog.to_regclass('public.tenants') is null
     or pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null then
    raise exception '20261008001100: rentals/rent_charges/expenses/property_dues/audit_logs veya yetki yardimcilari yok.';
  end if;
  if not exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public' and indexname = 'idx_rentals_id_tenant_unique') then
    raise exception '20261008001100: idx_rentals_id_tenant_unique yok; 20260809000020 once uygulanmali.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) rent_charges: 'partial' durumu + ödenen toplam
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select con.conname
      from pg_catalog.pg_constraint con
     where con.conrelid = 'public.rent_charges'::regclass
       and con.contype = 'c'
       and pg_catalog.pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute pg_catalog.format('alter table public.rent_charges drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.rent_charges
  add constraint rent_charges_status_check check (status in ('pending', 'partial', 'paid', 'overdue'));

alter table public.rent_charges
  add column if not exists paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0);

comment on column public.rent_charges.paid_amount is 'Ödenen toplam (iptal edilmemiş rent_payments toplamı); yalnız record/void RPC''leri yazar.';
comment on column public.rent_charges.status is 'pending | partial (kısmi ödeme) | paid | overdue (vade + 7 gün). RPC''ler ödenen toplamdan türetir.';

create unique index if not exists idx_rent_charges_id_tenant_unique on public.rent_charges (id, tenant_id);

-- ---------------------------------------------------------------------------
-- 2) Makbuz sayacı + tahsilat kaydı
-- ---------------------------------------------------------------------------
create table if not exists public.rent_receipt_counters (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  last_no   integer not null default 0 check (last_no >= 0)
);

comment on table public.rent_receipt_counters is 'Ofis başına makbuz sırası. Yalnız record_rent_payment (DEFINER) artırır; istemci erişimi YOK.';

create table if not exists public.rent_payments (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  rental_id      uuid not null,
  charge_id      uuid not null,
  amount         numeric(14,2) not null check (amount > 0 and amount <= 1000000000),
  paid_on        date not null,
  method         text not null check (method in ('cash', 'bank_transfer', 'card', 'cheque')),
  bank_note      text check (bank_note is null or char_length(bank_note) <= 300),
  receipt_no     integer not null check (receipt_no > 0),
  management_fee numeric(14,2) not null default 0 check (management_fee >= 0),
  fee_type       text check (fee_type is null or fee_type in ('percent', 'fixed')),
  fee_value      numeric(12,2) check (fee_value is null or fee_value >= 0),
  legacy         boolean not null default false,
  recorded_by    uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  voided_by      uuid references public.profiles(id) on delete set null,
  void_reason    text check (void_reason is null or char_length(void_reason) between 3 and 300),
  constraint rent_payments_rental_tenant_fkey foreign key (rental_id, tenant_id)
    references public.rentals(id, tenant_id) on delete cascade,
  constraint rent_payments_charge_tenant_fkey foreign key (charge_id, tenant_id)
    references public.rent_charges(id, tenant_id) on delete cascade,
  constraint rent_payments_receipt_unique unique (tenant_id, receipt_no),
  constraint rent_payments_void_consistent check ((voided_at is null) = (void_reason is null))
);

create index if not exists idx_rent_payments_charge on public.rent_payments (charge_id, created_at);
create index if not exists idx_rent_payments_rental on public.rent_payments (rental_id, paid_on desc);
create index if not exists idx_rent_payments_tenant_paid on public.rent_payments (tenant_id, paid_on desc) where voided_at is null;

comment on table public.rent_payments is 'Kira tahsilat kaydı. Silinmez; iptal = voided_at + neden. Yazma yalnız record_rent_payment / void_rent_payment RPC''leri.';
comment on column public.rent_payments.management_fee is 'Bu tahsilattan ofisin yönetim ücreti (anlık değer; fee_type/fee_value o günkü sözleşmenin kopyası). Ofis geliri bunun toplamıdır.';

-- ---------------------------------------------------------------------------
-- 3) Yönetim sözleşmesi (kira başına tek)
-- ---------------------------------------------------------------------------
create table if not exists public.rental_management_agreements (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  rental_id            uuid not null,
  managed              boolean not null default true,
  fee_type             text not null default 'percent' check (fee_type in ('percent', 'fixed')),
  fee_value            numeric(12,2) not null default 0,
  payout_day           smallint not null default 5 check (payout_day between 1 and 28),
  owner_iban           text check (owner_iban is null or owner_iban ~ '^TR[0-9]{24}$'),
  owner_account_holder text check (owner_account_holder is null or char_length(owner_account_holder) <= 120),
  notes                text check (notes is null or char_length(notes) <= 1000),
  created_by           uuid references public.profiles(id) on delete set null,
  updated_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint rental_mgmt_agreements_rental_tenant_fkey foreign key (rental_id, tenant_id)
    references public.rentals(id, tenant_id) on delete cascade,
  constraint rental_mgmt_agreements_rental_unique unique (rental_id),
  constraint rental_mgmt_agreements_fee_range check (
    (fee_type = 'percent' and fee_value between 0 and 100)
    or (fee_type = 'fixed' and fee_value between 0 and 1000000000)
  )
);

create index if not exists idx_rental_mgmt_agreements_tenant on public.rental_management_agreements (tenant_id, payout_day) where managed;

comment on table public.rental_management_agreements is 'Kira başına yönetim sözleşmesi. owner_iban KİŞİSEL VERİ: yalnız rentals:edit okur; arayüz maskeler, AI bağlamına girmez.';

-- ---------------------------------------------------------------------------
-- 4) Mülk sahibine ödeme kaydı
-- ---------------------------------------------------------------------------
create table if not exists public.owner_payouts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  rental_id   uuid not null,
  amount      numeric(14,2) not null check (amount > 0 and amount <= 1000000000),
  paid_on     date not null,
  method      text not null check (method in ('cash', 'bank_transfer', 'cheque')),
  reference   text check (reference is null or char_length(reference) <= 60),
  note        text check (note is null or char_length(note) <= 300),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  voided_at   timestamptz,
  voided_by   uuid references public.profiles(id) on delete set null,
  void_reason text check (void_reason is null or char_length(void_reason) between 3 and 300),
  constraint owner_payouts_rental_tenant_fkey foreign key (rental_id, tenant_id)
    references public.rentals(id, tenant_id) on delete cascade,
  constraint owner_payouts_void_consistent check ((voided_at is null) = (void_reason is null))
);

create index if not exists idx_owner_payouts_rental on public.owner_payouts (rental_id, paid_on desc);
create index if not exists idx_owner_payouts_tenant on public.owner_payouts (tenant_id, paid_on desc) where voided_at is null;

comment on table public.owner_payouts is 'Mülk sahibine yapılan ödeme (dekont no = reference). Silinmez; iptal edilir. Yazma yalnız record_owner_payout / void_owner_payout RPC''leri.';

-- ---------------------------------------------------------------------------
-- 5) Mülke ait gider / aidatın hakedişe yansıtılması
-- ---------------------------------------------------------------------------
create table if not exists public.owner_charge_links (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  rental_id  uuid not null,
  kind       text not null check (kind in ('expense', 'due')),
  ref_id     uuid not null,
  amount     numeric(14,2) not null check (amount > 0 and amount <= 1000000000),
  entry_date date not null,
  label      text not null check (char_length(label) between 1 and 160),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint owner_charge_links_rental_tenant_fkey foreign key (rental_id, tenant_id)
    references public.rentals(id, tenant_id) on delete cascade,
  constraint owner_charge_links_ref_unique unique (kind, ref_id)
);

create index if not exists idx_owner_charge_links_rental on public.owner_charge_links (rental_id, entry_date desc);
create index if not exists idx_owner_charge_links_tenant on public.owner_charge_links (tenant_id, kind);

comment on table public.owner_charge_links is 'Hakedişten düşülecek gider/aidat. Yansıtılan gider ofis kâr/zararında gider sayılmaz (mülk sahibinden geri alınır): çift sayım yok.';

-- ---------------------------------------------------------------------------
-- 6) Ofis ayarı (gecikme bedeli KAPALI doğar)
-- ---------------------------------------------------------------------------
create table if not exists public.property_management_settings (
  tenant_id                uuid primary key references public.tenants(id) on delete cascade,
  late_fee_enabled         boolean not null default false,
  late_fee_monthly_percent numeric(5,2) not null default 0 check (late_fee_monthly_percent between 0 and 20),
  late_fee_grace_days      smallint not null default 0 check (late_fee_grace_days between 0 and 30),
  updated_by               uuid references public.profiles(id) on delete set null,
  updated_at               timestamptz not null default now()
);

comment on table public.property_management_settings is 'Mülk yönetimi ofis ayarı. late_fee_enabled=false (varsayılan) iken gecikme bedeli hesaplanmaz/gösterilmez.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.rent_receipt_counters enable row level security;
alter table public.rent_payments enable row level security;
alter table public.rental_management_agreements enable row level security;
alter table public.owner_payouts enable row level security;
alter table public.owner_charge_links enable row level security;
alter table public.property_management_settings enable row level security;

-- rent_receipt_counters: istemci politikası YOK (yalnız DEFINER RPC / service_role).

drop policy if exists rent_payments_select on public.rent_payments;
create policy rent_payments_select on public.rent_payments
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'view')));

drop policy if exists rental_mgmt_agreements_select on public.rental_management_agreements;
create policy rental_mgmt_agreements_select on public.rental_management_agreements
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')));
drop policy if exists rental_mgmt_agreements_insert on public.rental_management_agreements;
create policy rental_mgmt_agreements_insert on public.rental_management_agreements
  for insert to authenticated
  with check (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')));
drop policy if exists rental_mgmt_agreements_update on public.rental_management_agreements;
create policy rental_mgmt_agreements_update on public.rental_management_agreements
  for update to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')))
  with check (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')));

drop policy if exists owner_payouts_select on public.owner_payouts;
create policy owner_payouts_select on public.owner_payouts
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')));

drop policy if exists owner_charge_links_select on public.owner_charge_links;
create policy owner_charge_links_select on public.owner_charge_links
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')));
-- Yansıtma: gider/aidat aynı ofisin, kira ile AYNI portföyün olmalı (kapsam politika içinde doğrulanır).
drop policy if exists owner_charge_links_insert on public.owner_charge_links;
create policy owner_charge_links_insert on public.owner_charge_links
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('rentals', 'edit'))
    and (
      (kind = 'expense' and exists (
        select 1 from public.expenses e
          join public.rentals r on r.property_id = e.property_id and r.tenant_id = e.tenant_id
         where e.id = ref_id and e.tenant_id = owner_charge_links.tenant_id and r.id = owner_charge_links.rental_id
      ))
      or (kind = 'due' and exists (
        select 1 from public.property_dues d
          join public.rentals r on r.property_id = d.property_id and r.tenant_id = d.tenant_id
         where d.id = ref_id and d.tenant_id = owner_charge_links.tenant_id and r.id = owner_charge_links.rental_id
      ))
    )
  );
drop policy if exists owner_charge_links_delete on public.owner_charge_links;
create policy owner_charge_links_delete on public.owner_charge_links
  for delete to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')));

drop policy if exists property_mgmt_settings_select on public.property_management_settings;
create policy property_mgmt_settings_select on public.property_management_settings
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'view')));
drop policy if exists property_mgmt_settings_insert on public.property_management_settings;
create policy property_mgmt_settings_insert on public.property_management_settings
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('rentals', 'edit'))
    and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
  );
drop policy if exists property_mgmt_settings_update on public.property_management_settings;
create policy property_mgmt_settings_update on public.property_management_settings
  for update to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('rentals', 'edit'))
    and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
  )
  with check (
    tenant_id = (select public.current_active_tenant_id())
    and (select public.has_effective_permission('rentals', 'edit'))
    and (select public.current_profile_role()) in ('owner', 'gm', 'branch_manager')
  );

revoke all on public.rent_receipt_counters from public, anon, authenticated;
revoke all on public.rent_payments from public, anon, authenticated;
revoke all on public.rental_management_agreements from public, anon, authenticated;
revoke all on public.owner_payouts from public, anon, authenticated;
revoke all on public.owner_charge_links from public, anon, authenticated;
revoke all on public.property_management_settings from public, anon, authenticated;

grant select on public.rent_payments to authenticated;
grant select, insert, update on public.rental_management_agreements to authenticated;
grant select on public.owner_payouts to authenticated;
grant select, insert, delete on public.owner_charge_links to authenticated;
grant select, insert, update on public.property_management_settings to authenticated;

grant all on public.rent_receipt_counters to service_role;
grant all on public.rent_payments to service_role;
grant all on public.rental_management_agreements to service_role;
grant all on public.owner_payouts to service_role;
grant all on public.owner_charge_links to service_role;
grant all on public.property_management_settings to service_role;

-- ---------------------------------------------------------------------------
-- Yardımcı: vade tarihi + tahakkuk durum/ücret yeniden hesabı (iç; istemciye AÇIK DEĞİL)
-- ---------------------------------------------------------------------------
create or replace function public.pm_charge_due_date(p_period date, p_due_day integer)
returns date
language sql
immutable
set search_path = ''
as $$
  select p_period + (least(greatest(p_due_day, 1), 28) - 1)
$$;

create or replace function public.pm_recompute_charge(p_charge_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_charge public.rent_charges%rowtype;
  v_due_day integer;
  p record;
  v_fee numeric;
  v_prior_fee numeric := 0;
  v_total numeric := 0;
  v_last_paid date;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_status text;
begin
  select c.* into v_charge from public.rent_charges c where c.id = p_charge_id for update;
  if not found then
    return;
  end if;
  select r.due_day into v_due_day from public.rentals r where r.id = v_charge.rental_id and r.tenant_id = v_charge.tenant_id;

  for p in
    select pay.id, pay.amount, pay.paid_on, pay.fee_type, pay.fee_value, pay.management_fee
      from public.rent_payments pay
     where pay.charge_id = p_charge_id and pay.voided_at is null
     order by pay.created_at, pay.id
  loop
    v_fee := case p.fee_type
      when 'percent' then pg_catalog.round(p.amount * coalesce(p.fee_value, 0) / 100, 2)
      when 'fixed' then greatest(0, least(coalesce(p.fee_value, 0) - v_prior_fee, p.amount))
      else 0
    end;
    if p.management_fee is distinct from v_fee then
      update public.rent_payments set management_fee = v_fee where id = p.id;
    end if;
    v_prior_fee := v_prior_fee + v_fee;
    v_total := v_total + p.amount;
    v_last_paid := greatest(coalesce(v_last_paid, p.paid_on), p.paid_on);
  end loop;

  if v_total >= v_charge.amount then
    v_status := 'paid';
  elsif public.pm_charge_due_date(v_charge.period, coalesce(v_due_day, 1)) + 7 < v_today then
    v_status := 'overdue';
  elsif v_total > 0 then
    v_status := 'partial';
  else
    v_status := 'pending';
  end if;

  update public.rent_charges
     set paid_amount = v_total,
         status = v_status,
         paid_at = case when v_status = 'paid' then (v_last_paid::timestamp at time zone 'Europe/Istanbul') else null end
   where id = p_charge_id;
end;
$$;

revoke all on function public.pm_recompute_charge(uuid) from public, anon, authenticated;
grant execute on function public.pm_recompute_charge(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- RPC: tahsilat kaydı
-- ---------------------------------------------------------------------------
create or replace function public.record_rent_payment(
  p_charge_id uuid,
  p_amount numeric,
  p_paid_on date,
  p_method text,
  p_bank_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_charge public.rent_charges%rowtype;
  v_agr public.rental_management_agreements%rowtype;
  v_receipt integer;
  v_payment uuid;
  v_remaining numeric;
  v_status text;
  v_paid numeric;
  v_fee numeric;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  if not public.has_effective_permission('rentals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  if p_charge_id is null
     or p_amount is null or p_amount < 0.01 or p_amount > 1000000000 or pg_catalog.round(p_amount, 2) <> p_amount
     or p_paid_on is null or p_paid_on > v_today or p_paid_on < date '2000-01-01'
     or p_method is null or p_method not in ('cash', 'bank_transfer', 'card', 'cheque')
     or char_length(coalesce(p_bank_note, '')) > 300 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select c.* into v_charge
    from public.rent_charges c
   where c.id = p_charge_id and c.tenant_id = v_tenant
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  v_remaining := v_charge.amount - v_charge.paid_amount;
  if v_remaining <= 0 then
    return jsonb_build_object('outcome', 'already_paid');
  end if;
  if p_amount > v_remaining then
    return jsonb_build_object('outcome', 'overpayment', 'remaining', v_remaining);
  end if;

  select a.* into v_agr
    from public.rental_management_agreements a
   where a.rental_id = v_charge.rental_id and a.tenant_id = v_tenant and a.managed;

  insert into public.rent_receipt_counters (tenant_id, last_no) values (v_tenant, 1)
  on conflict (tenant_id) do update set last_no = public.rent_receipt_counters.last_no + 1
  returning last_no into v_receipt;

  insert into public.rent_payments (
    tenant_id, rental_id, charge_id, amount, paid_on, method, bank_note, receipt_no, fee_type, fee_value, recorded_by
  ) values (
    v_tenant, v_charge.rental_id, v_charge.id, p_amount, p_paid_on, p_method, nullif(pg_catalog.btrim(coalesce(p_bank_note, '')), ''),
    v_receipt,
    case when v_agr.id is null then null else v_agr.fee_type end,
    case when v_agr.id is null then null else v_agr.fee_value end,
    v_uid
  ) returning id into v_payment;

  perform public.pm_recompute_charge(v_charge.id);

  select c.status, c.paid_amount into v_status, v_paid from public.rent_charges c where c.id = v_charge.id;
  select pay.management_fee into v_fee from public.rent_payments pay where pay.id = v_payment;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    v_tenant, v_uid, 'rent_payment.record', 'rent_payment', v_payment,
    jsonb_build_object(
      'rental_id', v_charge.rental_id, 'charge_id', v_charge.id, 'amount', p_amount, 'method', p_method,
      'receipt_no', v_receipt, 'paid_on', p_paid_on, 'management_fee', v_fee, 'charge_status', v_status
    )
  );

  return jsonb_build_object(
    'outcome', 'recorded', 'payment_id', v_payment, 'receipt_no', v_receipt,
    'charge_status', v_status, 'paid_amount', v_paid, 'management_fee', v_fee
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: tahsilat iptali (geri alma) — silme yok
-- ---------------------------------------------------------------------------
create or replace function public.void_rent_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_pay public.rent_payments%rowtype;
  v_charge_id uuid;
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_status text;
  v_paid numeric;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  if not public.has_effective_permission('rentals', 'delete') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_payment_id is null or char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  -- Önce tahakkuk kilidi (record_rent_payment ile aynı sıra: kilitlenme yok).
  select p.charge_id into v_charge_id from public.rent_payments p where p.id = p_payment_id and p.tenant_id = v_tenant;
  if v_charge_id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  perform 1 from public.rent_charges c where c.id = v_charge_id and c.tenant_id = v_tenant for update;

  select p.* into v_pay from public.rent_payments p where p.id = p_payment_id and p.tenant_id = v_tenant for update;
  if v_pay.voided_at is not null then
    return jsonb_build_object('outcome', 'already_voided');
  end if;

  update public.rent_payments
     set voided_at = pg_catalog.now(), voided_by = v_uid, void_reason = v_reason
   where id = v_pay.id;

  perform public.pm_recompute_charge(v_pay.charge_id);
  select c.status, c.paid_amount into v_status, v_paid from public.rent_charges c where c.id = v_pay.charge_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (
    v_tenant, v_uid, 'rent_payment.void', 'rent_payment', v_pay.id,
    jsonb_build_object('amount', v_pay.amount, 'receipt_no', v_pay.receipt_no, 'paid_on', v_pay.paid_on, 'method', v_pay.method),
    jsonb_build_object('reason', v_reason, 'charge_id', v_pay.charge_id, 'charge_status', v_status, 'paid_amount', v_paid)
  );

  return jsonb_build_object('outcome', 'voided', 'charge_status', v_status, 'paid_amount', v_paid);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: mülk sahibine ödeme kaydı / iptali
-- ---------------------------------------------------------------------------
create or replace function public.record_owner_payout(
  p_rental_id uuid,
  p_amount numeric,
  p_paid_on date,
  p_method text,
  p_reference text default null,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_payout uuid;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  if not public.has_effective_permission('rentals', 'edit') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_rental_id is null
     or p_amount is null or p_amount < 0.01 or p_amount > 1000000000 or pg_catalog.round(p_amount, 2) <> p_amount
     or p_paid_on is null or p_paid_on > v_today or p_paid_on < date '2000-01-01'
     or p_method is null or p_method not in ('cash', 'bank_transfer', 'cheque')
     or char_length(coalesce(p_reference, '')) > 60
     or char_length(coalesce(p_note, '')) > 300 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  if not exists (
    select 1 from public.rental_management_agreements a
     where a.rental_id = p_rental_id and a.tenant_id = v_tenant and a.managed
  ) then
    return jsonb_build_object('outcome', 'not_managed');
  end if;

  insert into public.owner_payouts (tenant_id, rental_id, amount, paid_on, method, reference, note, created_by)
  values (
    v_tenant, p_rental_id, p_amount, p_paid_on, p_method,
    nullif(pg_catalog.btrim(coalesce(p_reference, '')), ''), nullif(pg_catalog.btrim(coalesce(p_note, '')), ''), v_uid
  ) returning id into v_payout;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    v_tenant, v_uid, 'owner_payout.record', 'owner_payout', v_payout,
    jsonb_build_object('rental_id', p_rental_id, 'amount', p_amount, 'method', p_method, 'paid_on', p_paid_on, 'reference', p_reference)
  );

  return jsonb_build_object('outcome', 'recorded', 'payout_id', v_payout);
end;
$$;

create or replace function public.void_owner_payout(p_payout_id uuid, p_reason text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_row public.owner_payouts%rowtype;
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  if not public.has_effective_permission('rentals', 'delete') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  if p_payout_id is null or char_length(v_reason) < 3 or char_length(v_reason) > 300 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select o.* into v_row from public.owner_payouts o where o.id = p_payout_id and o.tenant_id = v_tenant for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if v_row.voided_at is not null then
    return jsonb_build_object('outcome', 'already_voided');
  end if;

  update public.owner_payouts
     set voided_at = pg_catalog.now(), voided_by = v_uid, void_reason = v_reason
   where id = v_row.id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (
    v_tenant, v_uid, 'owner_payout.void', 'owner_payout', v_row.id,
    jsonb_build_object('amount', v_row.amount, 'paid_on', v_row.paid_on, 'method', v_row.method, 'reference', v_row.reference),
    jsonb_build_object('reason', v_reason, 'rental_id', v_row.rental_id)
  );

  return jsonb_build_object('outcome', 'voided');
end;
$$;

revoke all on function public.record_rent_payment(uuid, numeric, date, text, text) from public, anon;
revoke all on function public.void_rent_payment(uuid, text) from public, anon;
revoke all on function public.record_owner_payout(uuid, numeric, date, text, text, text) from public, anon;
revoke all on function public.void_owner_payout(uuid, text) from public, anon;
grant execute on function public.record_rent_payment(uuid, numeric, date, text, text) to authenticated, service_role;
grant execute on function public.void_rent_payment(uuid, text) to authenticated, service_role;
grant execute on function public.record_owner_payout(uuid, numeric, date, text, text, text) to authenticated, service_role;
grant execute on function public.void_owner_payout(uuid, text) to authenticated, service_role;

comment on function public.record_rent_payment(uuid, numeric, date, text, text) is 'Kira tahsilatı: tahakkuk kilidi, fazla ödeme reddi, sıralı makbuz no, yönetim ücreti anlık değeri, durum türetme ve denetim kaydı tek transaction. Yetki içerde (rentals:edit).';
comment on function public.void_rent_payment(uuid, text) is 'Tahsilat iptali (silme yok): neden zorunlu, durum yeniden türetilir, denetim kaydı yazılır. Yetki içerde (rentals:delete).';

-- ---------------------------------------------------------------------------
-- rent_reminders: mülk sahibine ödeme günü hatırlatması (tablo yoksa atlanır)
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  if pg_catalog.to_regclass('public.rent_reminders') is null then
    return;
  end if;
  for c in
    select con.conname
      from pg_catalog.pg_constraint con
     where con.conrelid = 'public.rent_reminders'::regclass
       and con.contype = 'c'
       and pg_catalog.pg_get_constraintdef(con.oid) ilike '%kind%'
  loop
    execute pg_catalog.format('alter table public.rent_reminders drop constraint %I', c.conname);
  end loop;
  alter table public.rent_reminders
    add constraint rent_reminders_kind_check check (kind in ('before', 'due', 'late', 'owner_payout'));
end $$;

-- ---------------------------------------------------------------------------
-- Tek seferlik geri doldurma: eski "ödendi" tahakkuklar -> legacy tahsilat kaydı
-- ---------------------------------------------------------------------------
with legacy as (
  select c.id as charge_id, c.rental_id, c.tenant_id, c.amount,
         coalesce((c.paid_at at time zone 'Europe/Istanbul')::date, c.period) as paid_on,
         c.created_at,
         row_number() over (
           partition by c.tenant_id
           order by coalesce((c.paid_at at time zone 'Europe/Istanbul')::date, c.period), c.created_at, c.id
         ) as seq
    from public.rent_charges c
   where c.status = 'paid'
     and not exists (select 1 from public.rent_payments p where p.charge_id = c.id)
), ins as (
  insert into public.rent_payments (tenant_id, rental_id, charge_id, amount, paid_on, method, bank_note, receipt_no, legacy)
  select l.tenant_id, l.rental_id, l.charge_id, l.amount, l.paid_on, 'cash', 'Eski kayıt (aktarım): ödeme yöntemi bilinmiyor', l.seq::integer, true
    from legacy l
  returning tenant_id, receipt_no
)
insert into public.rent_receipt_counters (tenant_id, last_no)
select i.tenant_id, max(i.receipt_no) from ins i group by i.tenant_id
on conflict (tenant_id) do update set last_no = greatest(public.rent_receipt_counters.last_no, excluded.last_no);

update public.rent_charges c
   set paid_amount = c.amount
 where c.status = 'paid' and c.paid_amount = 0;

notify pgrst, 'reload schema';
