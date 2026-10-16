-- SP6: Teslim (giriş) ve tahliye (çıkış) tutanağı + kalemli depozito kesintisi.
--
--   * rental_inspections: kira başına tür başına tek tutanak (move_in | move_out). Oda oda kalemler (rooms jsonb),
--     sayaç okumaları (meters jsonb), anahtarlar (keys jsonb). draft → final (kilitli). İmza: tutanaktan üretilen
--     sözleşme taslağı (contracts, mevcut SMS OTP imza akışı) contract_id ile bağlanır.
--   * rental_inspection_photos: kalem fotoğrafları (özel kova customer-files, yol <ofis>/<tutanak>/<dosya>.<uzantı>).
--   * rental_deposit_deductions: kalemli depozito kesintisi. Toplam depozitoyu aşamaz; depozito iade edildikten
--     sonra değiştirilemez (iade geri alınırsa yeniden düzenlenebilir).
--   * rental_deposit_post: GÖVDE AYNI, tek fark iade (returned) hareketinin tutarı = depozito - kesintiler.
--     Defter (finance_record_entry_v2) DEĞİŞMEZ; imza aynı (aşırı yükleme yok). Tam kesintide çıkış hareketi yazılmaz.
-- Okuma: rentals:view; yazma: rentals:edit. Silme: tutanak/fotoğraf yalnız taslakta, kesinti iade öncesinde.

-- ---------------------------------------------------------------------------
-- 1) Tutanak
-- ---------------------------------------------------------------------------
create table if not exists public.rental_inspections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rental_id uuid not null references public.rentals(id) on delete cascade,
  kind text not null,
  status text not null default 'draft',
  inspected_on date not null default ((now() at time zone 'Europe/Istanbul')::date),
  rooms jsonb not null default '[]'::jsonb,
  meters jsonb not null default '{}'::jsonb,
  keys jsonb not null default '[]'::jsonb,
  notes text,
  contract_id uuid references public.contracts(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_sample boolean not null default false,
  constraint rental_inspections_kind_chk check (kind in ('move_in', 'move_out')),
  constraint rental_inspections_status_chk check (status in ('draft', 'final')),
  constraint rental_inspections_json_chk check (
    jsonb_typeof(rooms) = 'array' and jsonb_typeof(meters) = 'object' and jsonb_typeof(keys) = 'array'
    and pg_column_size(rooms) <= 262144 and pg_column_size(meters) <= 16384 and pg_column_size(keys) <= 16384
  ),
  constraint rental_inspections_notes_chk check (notes is null or char_length(notes) <= 4000),
  constraint rental_inspections_final_chk check ((status = 'final') = (finalized_at is not null))
);

create unique index if not exists rental_inspections_rental_kind_key on public.rental_inspections (rental_id, kind);
create index if not exists rental_inspections_tenant_idx on public.rental_inspections (tenant_id, updated_at desc);
create index if not exists rental_inspections_contract_idx on public.rental_inspections (contract_id) where contract_id is not null;

-- ---------------------------------------------------------------------------
-- 2) Fotoğraf
-- ---------------------------------------------------------------------------
create table if not exists public.rental_inspection_photos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  inspection_id uuid not null references public.rental_inspections(id) on delete cascade,
  item_key text not null,
  storage_path text not null,
  file_name text not null,
  file_size bigint not null,
  mime_type text not null,
  status text not null default 'pending',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  constraint rental_inspection_photos_key_chk check (item_key ~ '^[a-z0-9_-]{1,64}$'),
  constraint rental_inspection_photos_status_chk check (status in ('pending', 'verified', 'blocked')),
  constraint rental_inspection_photos_mime_chk check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint rental_inspection_photos_size_chk check (file_size > 0 and file_size <= 10485760)
);

create unique index if not exists rental_inspection_photos_path_key on public.rental_inspection_photos (storage_path);
create index if not exists rental_inspection_photos_insp_idx on public.rental_inspection_photos (inspection_id, status);
create index if not exists rental_inspection_photos_pending_idx on public.rental_inspection_photos (created_at) where status = 'pending';

-- ---------------------------------------------------------------------------
-- 3) Kalemli depozito kesintisi
-- ---------------------------------------------------------------------------
create table if not exists public.rental_deposit_deductions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rental_id uuid not null references public.rentals(id) on delete cascade,
  inspection_id uuid references public.rental_inspections(id) on delete set null,
  item_key text,
  label text not null,
  amount numeric(14,2) not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint rental_deposit_deductions_label_chk check (char_length(btrim(label)) between 2 and 200),
  constraint rental_deposit_deductions_amount_chk check (amount > 0 and amount < 100000000),
  constraint rental_deposit_deductions_key_chk check (item_key is null or item_key ~ '^[a-z0-9_-]{1,64}$')
);

create index if not exists rental_deposit_deductions_rental_idx on public.rental_deposit_deductions (rental_id);
create index if not exists rental_deposit_deductions_insp_idx on public.rental_deposit_deductions (inspection_id) where inspection_id is not null;

-- Kesinti kapısı: iade edilmiş depozitoda değişiklik yok; toplam kesinti depozitoyu aşamaz. Satır kilidi yarışları keser.
create or replace function public.rental_deposit_deductions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rental uuid := coalesce(new.rental_id, old.rental_id);
  v_r record;
  v_total numeric;
begin
  -- Tutanak silinince bağın boşalması (on delete set null) tutar/etiket değiştirmez: her zaman geçer.
  if tg_op = 'UPDATE' and new.inspection_id is null and old.inspection_id is not null
     and new.amount = old.amount and new.label = old.label and new.rental_id = old.rental_id
     and new.item_key is not distinct from old.item_key then
    return new;
  end if;
  select r.id, r.tenant_id, coalesce(r.deposit, 0) as deposit, r.deposit_returned
    into v_r
    from public.rentals r where r.id = v_rental for update;
  if not found then
    -- Kira kaydı silinirken (cascade) üst satır görünmez: silmeyi engelleme.
    if tg_op = 'INSERT' then
      raise exception 'RD:not_found' using errcode = 'P0001';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if v_r.deposit_returned then
    raise exception 'RD:deposit_returned' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.tenant_id <> v_r.tenant_id then
    raise exception 'RD:tenant_mismatch' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.rental_id <> old.rental_id then
    raise exception 'RD:immutable' using errcode = 'P0001';
  end if;
  if new.inspection_id is not null and not exists (
    select 1 from public.rental_inspections i where i.id = new.inspection_id and i.rental_id = new.rental_id
  ) then
    raise exception 'RD:inspection_mismatch' using errcode = 'P0001';
  end if;
  select coalesce(sum(d.amount), 0) into v_total
    from public.rental_deposit_deductions d
   where d.rental_id = new.rental_id and d.id <> new.id;
  if v_total + new.amount > v_r.deposit then
    raise exception 'RD:exceeds_deposit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists rental_deposit_deductions_guard_trg on public.rental_deposit_deductions;
create trigger rental_deposit_deductions_guard_trg
  before insert or update or delete on public.rental_deposit_deductions
  for each row execute function public.rental_deposit_deductions_guard();

-- Tutanak kapısı: kesinleşmiş tutanağın içeriği değişmez (yalnız sözleşme bağı ve geri açma: final → draft).
create or replace function public.rental_inspections_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.rental_id <> old.rental_id or new.kind <> old.kind or new.tenant_id <> old.tenant_id then
    raise exception 'RI:immutable' using errcode = 'P0001';
  end if;
  if old.status = 'final' and new.status = 'final' and (
       new.rooms is distinct from old.rooms or new.meters is distinct from old.meters
       or new.keys is distinct from old.keys or new.notes is distinct from old.notes
       or new.inspected_on is distinct from old.inspected_on) then
    raise exception 'RI:final' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists rental_inspections_guard_trg on public.rental_inspections;
create trigger rental_inspections_guard_trg
  before update on public.rental_inspections
  for each row execute function public.rental_inspections_guard();

revoke all on function public.rental_deposit_deductions_guard() from public, anon, authenticated;
revoke all on function public.rental_inspections_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) RLS
-- ---------------------------------------------------------------------------
alter table public.rental_inspections enable row level security;
alter table public.rental_inspection_photos enable row level security;
alter table public.rental_deposit_deductions enable row level security;

drop policy if exists rental_inspections_select on public.rental_inspections;
create policy rental_inspections_select on public.rental_inspections
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'view')));
drop policy if exists rental_inspections_insert on public.rental_inspections;
create policy rental_inspections_insert on public.rental_inspections
  for insert to authenticated
  with check (
    tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit'))
    and exists (select 1 from public.rentals r where r.id = rental_id and r.tenant_id = (select public.current_active_tenant_id()))
  );
drop policy if exists rental_inspections_update on public.rental_inspections;
create policy rental_inspections_update on public.rental_inspections
  for update to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')))
  with check (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')));
drop policy if exists rental_inspections_delete on public.rental_inspections;
create policy rental_inspections_delete on public.rental_inspections
  for delete to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and status = 'draft' and (select public.has_effective_permission('rentals', 'edit')));

drop policy if exists rental_inspection_photos_select on public.rental_inspection_photos;
create policy rental_inspection_photos_select on public.rental_inspection_photos
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'view')));

drop policy if exists rental_deposit_deductions_select on public.rental_deposit_deductions;
create policy rental_deposit_deductions_select on public.rental_deposit_deductions
  for select to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'view')));
drop policy if exists rental_deposit_deductions_insert on public.rental_deposit_deductions;
create policy rental_deposit_deductions_insert on public.rental_deposit_deductions
  for insert to authenticated
  with check (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')));
drop policy if exists rental_deposit_deductions_update on public.rental_deposit_deductions;
create policy rental_deposit_deductions_update on public.rental_deposit_deductions
  for update to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')))
  with check (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')));
drop policy if exists rental_deposit_deductions_delete on public.rental_deposit_deductions;
create policy rental_deposit_deductions_delete on public.rental_deposit_deductions
  for delete to authenticated
  using (tenant_id = (select public.current_active_tenant_id()) and (select public.has_effective_permission('rentals', 'edit')));

revoke all on public.rental_inspections from public, anon, authenticated;
revoke all on public.rental_inspection_photos from public, anon, authenticated;
revoke all on public.rental_deposit_deductions from public, anon, authenticated;
grant select, insert, delete on public.rental_inspections to authenticated;
grant update (status, inspected_on, rooms, meters, keys, notes, contract_id, updated_by, finalized_at) on public.rental_inspections to authenticated;
grant select on public.rental_inspection_photos to authenticated;
grant select, insert, update, delete on public.rental_deposit_deductions to authenticated;
grant all on public.rental_inspections to service_role;
grant all on public.rental_inspection_photos to service_role;
grant all on public.rental_deposit_deductions to service_role;

-- ---------------------------------------------------------------------------
-- 5) Depozito iadesi net tutarla (gövde 20261017010500 ile aynı; yalnız iade tutarı = depozito - kesintiler)
-- ---------------------------------------------------------------------------
create or replace function public.rental_deposit_post(p_rental_id uuid, p_event text, p_account_id uuid, p_date date default null)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_r record;
  v_existing uuid;
  v_party uuid;
  v_id uuid;
  v_deducted numeric := 0;
  v_amount numeric;
begin
  if v_uid is null then perform public.finance_v2_raise('unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then perform public.finance_v2_raise('unauthorized'); end if;
  if public.current_profile_role() = 'readonly' or not public.has_effective_permission('rentals', 'edit') then
    perform public.finance_v2_raise('forbidden');
  end if;
  if p_rental_id is null or p_account_id is null or p_event not in ('received', 'returned')
     or coalesce(p_date, v_today) > v_today then
    perform public.finance_v2_raise('invalid_input');
  end if;
  select r.id, r.deposit, r.status, r.deposit_returned, r.renter_customer_id, r.property_id,
         r.deposit_received_entry_id, r.deposit_returned_entry_id
    into v_r
    from public.rentals r where r.id = p_rental_id and r.tenant_id = v_tenant for update;
  if not found then perform public.finance_v2_raise('not_found'); end if;
  if coalesce(v_r.deposit, 0) <= 0 then perform public.finance_v2_raise('no_deposit'); end if;
  if p_event = 'returned' and not v_r.deposit_returned then perform public.finance_v2_raise('deposit_not_returned'); end if;

  v_existing := case when p_event = 'received' then v_r.deposit_received_entry_id else v_r.deposit_returned_entry_id end;
  if v_existing is not null and exists (select 1 from public.cash_entries e where e.id = v_existing and e.voided_at is null) then
    return v_existing; -- tekrar çağrı: aynı hareket
  end if;

  v_amount := v_r.deposit;
  if p_event = 'returned' then
    select coalesce(sum(d.amount), 0) into v_deducted
      from public.rental_deposit_deductions d where d.rental_id = p_rental_id and d.tenant_id = v_tenant;
    v_amount := v_r.deposit - v_deducted;
    -- Tamamı kesintiye gittiyse iade edilecek nakit yok: çıkış hareketi yazılmaz.
    if v_amount <= 0 then perform public.finance_v2_raise('no_deposit'); end if;
  end if;

  v_party := public.finance_customer_party(v_tenant, v_r.renter_customer_id, 'kiraci');
  v_id := public.finance_record_entry_v2(jsonb_build_object(
    'account_id', p_account_id,
    'direction', case when p_event = 'received' then 'in' else 'out' end,
    'amount', v_amount,
    'entry_date', coalesce(p_date, v_today),
    'category', 'depozito',
    'title', case when p_event = 'received' then 'Depozito alındı' else 'Depozito iadesi' end,
    'party_id', v_party,
    'property_id', v_r.property_id,
    'note', case when v_deducted > 0
      then 'Emanet (kâr/zarar dışı) · kesinti ' || to_char(v_deducted, 'FM999G999G999G990D00') || ' TL'
      else 'Emanet (kâr/zarar dışı)' end));

  if p_event = 'received' then
    update public.rentals set deposit_received_entry_id = v_id where id = p_rental_id;
  else
    update public.rentals set deposit_returned_entry_id = v_id where id = p_rental_id;
  end if;
  perform public.finance_wp4_stamp_key('cash_entries', v_id, 'deposit:' || p_rental_id::text || ':' || p_event);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, v_uid, 'rental.deposit_post', 'rental', p_rental_id,
    jsonb_build_object('event', p_event, 'entry_id', v_id, 'amount', v_amount, 'deposit', v_r.deposit, 'deducted', v_deducted));
  return v_id;
end;
$$;

revoke all on function public.rental_deposit_post(uuid, text, uuid, date) from public, anon;
grant execute on function public.rental_deposit_post(uuid, text, uuid, date) to authenticated, service_role;
comment on function public.rental_deposit_post(uuid, text, uuid, date) is 'Depozito emaneti kasaya: received = giriş (tam depozito), returned = çıkış (depozito - kalemli kesintiler, SP6); kategori depozito (K/Z dışı); rentals.deposit_*_entry_id ile tekil.';
