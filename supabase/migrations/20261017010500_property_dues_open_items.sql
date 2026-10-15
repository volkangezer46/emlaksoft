-- UYGULANMADI (canlıya henüz uygulanmadı; sahibin onayı + yedek doğrulaması sonrası `npm run db:migrate`).
--
-- WP4 (docs/design/FINANS_ENTEGRASYON_2026-10.md) — Kira, aidat, dues: tekil mülk aidatı tahakkuk alt defterine taşınır.
-- NEDEN: property_dues (unpaid/paid) açık kalemlerde yoktu (yaşlandırma/cari eksik), deleteDue kaydı SERT siliyordu (denetim yok),
--   kira/mülk sahibi/bina tahsilat hareketlerinin carisi (party_id) boştu, depozito kasaya hiç işlenmiyordu.
-- İÇERİK:
--   1) property_dues.direction ('payable' varsayılan = bugünkü anlam: ofis mülk adına aidatı öder, gerekirse malik hakedişine
--      yansıtır; 'receivable' = ofis tahsil eder) + property_dues.open_item_id. Tablo GEÇMİŞ olarak kalır: authenticated/anon
--      INSERT/UPDATE/DELETE yetkisi ve yazma politikaları kaldırılır (salt okunur). Yeni aidat yalnız finance_open_items'a yazılır.
--   2) finance_open_items.settled_on (kalemin tamamen kapandığı gün; tetikle türer) + aidat kalemi tekilliği
--      (tenant_id, source_id) where source_type = 'due'. Olay anahtarı 'due:{id}' (WP1 posting_key sütunu VARSA damgalanır,
--      yoksa NOTICE ile atlanır; WP1 sonradan geri doldurabilir).
--   3) finance_due_backfill(): her property_dues satırı (tutar > 0) için bir açık kalem (source_type 'due', source_id = due.id,
--      kategori payable 'aidat' / receivable 'aidat_tahsilat'). Ödenmiş satır 'paid' + note 'kasa dışı' (nakit UYDURULMAZ).
--      Kilitli aya düşen tahakkuk ilk açık aya tarihlenir ve not düşülür. İki kez çalışması değişiklik yapmaz.
--   4) Aidat RPC'leri (SECURITY DEFINER, search_path '', kiracı + expenses izni): finance_due_create / _update / _mark_paid
--      (hesap verilirse finance_open_item_settle ile kasa hareketi; verilmezse 'kasa dışı') / _reopen / _cancel
--      (SİLME YOK: finance_open_item_cancel; neden zorunlu, denetim kaydı). aidat_kpi() açık kalemlerden okur.
--   5) Depozito emanet: rentals.deposit_received_entry_id / deposit_returned_entry_id + rental_deposit_post / _unpost
--      (mevcut finance_record_entry_v2 / finance_void_entry yolu; kategori 'depozito'; anahtar 'deposit:{rental}:received|returned').
--   6) Cari bağı: finance_customer_party (müşteri → cari, customer_id bağlı) + cash_entries BEFORE INSERT tetiği
--      (kaynak 'rent' → kiracı, 'owner_payout' → malik, 'building' → ödeyen daire sahibi/kiracı) + mevcut satırların geri doldurması.
--      Yalnız party_id (parasal olmayan alan) yazılır; kilitli ay tetiği engellemez, tahakkuk/nakit üretilmez.
--   7) owner_charge_links 'due' yansıtması property_dues yerine aidat açık kalemini (source_id) doğrular.
-- K/Z: 'depozito' kategorisi emanettir; finance_pnl v3 (WP2) bu kategoriyi dışlar. TODO(WP2): finance_pnl_v3 'depozito' hariç.
-- GERİ ALMA: supabase/rollbacks/20261017010500_property_dues_open_items.rollback.sql (fonksiyon/tetik/sütun düşer, property_dues
--   yazma politikaları 20261016100100 haline döner; taşınan açık kalemler İPTAL edilmez, source_type='due' ile ayırt edilir).
-- RİSK: orta (aidat yazma yolu değişir; tek seferlik geri doldurma). Kod bu migration'dan SONRA yayınlanır.

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.property_dues') is null
     or pg_catalog.to_regclass('public.finance_open_items') is null
     or pg_catalog.to_regclass('public.finance_parties') is null
     or pg_catalog.to_regclass('public.cash_entries') is null
     or pg_catalog.to_regclass('public.rentals') is null
     or pg_catalog.to_regclass('public.rent_payments') is null
     or pg_catalog.to_regclass('public.owner_payouts') is null
     or pg_catalog.to_regclass('public.owner_charge_links') is null
     or pg_catalog.to_regclass('public.building_payments') is null
     or pg_catalog.to_regclass('public.building_charges') is null
     or pg_catalog.to_regclass('public.customers') is null
     or pg_catalog.to_regclass('public.audit_logs') is null
     or pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null
     or pg_catalog.to_regprocedure('public.finance_v2_ctx(text)') is null
     or pg_catalog.to_regprocedure('public.finance_v2_raise(text)') is null
     or pg_catalog.to_regprocedure('public.finance_v2_resolve_party(uuid,uuid,text,text)') is null
     or pg_catalog.to_regprocedure('public.finance_period_is_locked(uuid,date)') is null
     or pg_catalog.to_regprocedure('public.finance_open_item_recompute(uuid)') is null
     or pg_catalog.to_regprocedure('public.finance_open_item_cancel(uuid,text)') is null
     or pg_catalog.to_regprocedure('public.finance_open_item_settle(uuid,uuid,numeric,date,text)') is null
     or pg_catalog.to_regprocedure('public.finance_record_entry_v2(jsonb)') is null
     or pg_catalog.to_regprocedure('public.finance_void_entry(uuid,text)') is null
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.rentals'::regclass and attname = 'deposit_returned' and not attisdropped)
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.properties'::regclass and attname = 'owner_customer_id' and not attisdropped) then
    raise exception '20261017010500: finans v2 (20261014001000/001100/011000, 20261016060100), mülk/bina yönetimi (20261008001100/001700) ve 20260729000129 önce uygulanmalı.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) Şema ekleri
-- ---------------------------------------------------------------------------
alter table public.property_dues
  add column if not exists direction text not null default 'payable';
do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.property_dues'::regclass and conname = 'property_dues_direction_check') then
    alter table public.property_dues add constraint property_dues_direction_check check (direction in ('payable', 'receivable'));
  end if;
end $$;
alter table public.property_dues
  add column if not exists open_item_id uuid references public.finance_open_items(id) on delete set null;

alter table public.finance_open_items add column if not exists settled_on date;

create unique index if not exists idx_finance_open_items_due_source_unique
  on public.finance_open_items (tenant_id, source_id) where source_type = 'due';
create index if not exists idx_finance_open_items_due_list
  on public.finance_open_items (tenant_id, issue_date desc) where source_type = 'due';

alter table public.rentals add column if not exists deposit_received_entry_id uuid references public.cash_entries(id) on delete set null;
alter table public.rentals add column if not exists deposit_returned_entry_id uuid references public.cash_entries(id) on delete set null;

comment on column public.property_dues.direction is 'payable: ofis öder (varsayılan, eski anlam); receivable: ofis tahsil eder. Tablo salt okunur geçmiştir.';
comment on column public.property_dues.open_item_id is 'Bu aidatın finance_open_items karşılığı (source_type=due, source_id=property_dues.id).';
comment on column public.finance_open_items.settled_on is 'Kalemin tamamen kapandığı gün (status=paid); bağlı son hareket tarihi ya da kasa dışı kapama günü. Tetikle türer.';

-- ---------------------------------------------------------------------------
-- 2) Yardımcılar (istemciye kapalı)
-- ---------------------------------------------------------------------------
-- WP1 posting_key sütunu varsa olay anahtarını damgalar; yoksa hiçbir şey yapmaz. Tekillik çakışması kaydı bozmaz.
create or replace function public.finance_wp4_stamp_key(p_table text, p_id uuid, p_key text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_table not in ('finance_open_items', 'cash_entries') or p_id is null or p_key is null then return false; end if;
  if not exists (select 1 from pg_catalog.pg_attribute
                  where attrelid = pg_catalog.format('public.%I', p_table)::regclass and attname = 'posting_key' and not attisdropped) then
    return false;
  end if;
  begin
    execute pg_catalog.format('update public.%I set posting_key = $1 where id = $2 and posting_key is null', p_table) using p_key, p_id;
  exception when unique_violation then
    raise notice 'posting_key % zaten kullanımda; damgalanmadı', p_key;
    return false;
  end;
  return true;
end;
$$;

-- Müşteri → cari (customer_id bağlı). Aynı müşteri + tür varsa onu, aynı ad + tür varsa (müşterisiz) onu bağlar, yoksa açar.
-- Yalnız definer gövdelerinden ve tetikten çağrılır (yetki çağıranda).
create or replace function public.finance_customer_party(p_tenant uuid, p_customer uuid, p_kind text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_cust uuid;
  v_name text;
begin
  if p_tenant is null or p_customer is null or p_kind not in ('musteri', 'malik', 'kiraci', 'tedarikci', 'diger') then return null; end if;
  select p.id into v_id from public.finance_parties p
   where p.tenant_id = p_tenant and p.customer_id = p_customer and p.kind = p_kind and p.archived_at is null
   order by p.created_at limit 1;
  if v_id is not null then return v_id; end if;
  select pg_catalog.left(pg_catalog.btrim(coalesce(c.full_name, '')), 120) into v_name
    from public.customers c where c.id = p_customer and c.tenant_id = p_tenant;
  if v_name is null or v_name = '' then return null; end if;
  select p.id, p.customer_id into v_id, v_cust from public.finance_parties p
   where p.tenant_id = p_tenant and pg_catalog.lower(p.name) = pg_catalog.lower(v_name) and p.kind = p_kind and p.archived_at is null
   limit 1;
  if v_id is not null then
    if v_cust is null then
      update public.finance_parties set customer_id = p_customer, updated_at = pg_catalog.now() where id = v_id;
      return v_id;
    end if;
    -- Aynı adlı başka müşteri: ad benzersizliği için kısa ek (cari karışmaz).
    v_name := pg_catalog.left(v_name, 110) || ' #' || pg_catalog.left(p_customer::text, 6);
  end if;
  insert into public.finance_parties (tenant_id, kind, name, customer_id)
  values (p_tenant, p_kind, v_name, p_customer)
  on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select p.id into v_id from public.finance_parties p
     where p.tenant_id = p_tenant and pg_catalog.lower(p.name) = pg_catalog.lower(v_name) and p.kind = p_kind and p.archived_at is null
     limit 1;
  end if;
  return v_id;
end;
$$;

-- Kaynak bağlı tahsilat/ödeme hareketinin carisi: kira → kiracı, mülk sahibi ödemesi → malik, bina tahsilatı → ödeyen.
create or replace function public.finance_source_party(p_tenant uuid, p_source_type text, p_source_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
  v_kind text;
begin
  if p_source_id is null then return null; end if;
  if p_source_type = 'rent' then
    select r.renter_customer_id, 'kiraci' into v_customer, v_kind
      from public.rent_payments rp join public.rentals r on r.id = rp.rental_id and r.tenant_id = rp.tenant_id
     where rp.id = p_source_id and rp.tenant_id = p_tenant;
  elsif p_source_type = 'owner_payout' then
    select pr.owner_customer_id, 'malik' into v_customer, v_kind
      from public.owner_payouts op
      join public.rentals r on r.id = op.rental_id and r.tenant_id = op.tenant_id
      join public.properties pr on pr.id = r.property_id and pr.tenant_id = r.tenant_id
     where op.id = p_source_id and op.tenant_id = p_tenant;
  elsif p_source_type = 'building' then
    select bc.payer_customer_id, case when bc.payer_role = 'tenant' then 'kiraci' else 'malik' end into v_customer, v_kind
      from public.building_payments bp join public.building_charges bc on bc.id = bp.charge_id and bc.tenant_id = bp.tenant_id
     where bp.id = p_source_id and bp.tenant_id = p_tenant;
  else
    return null;
  end if;
  return public.finance_customer_party(p_tenant, v_customer, v_kind);
end;
$$;

create or replace function public.cash_entries_source_party()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.party_id is null and new.source_type in ('rent', 'owner_payout', 'building') then
    new.party_id := public.finance_source_party(new.tenant_id, new.source_type, new.source_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cash_entries_source_party on public.cash_entries;
create trigger trg_cash_entries_source_party
  before insert on public.cash_entries
  for each row when (new.party_id is null and new.source_type in ('rent', 'owner_payout', 'building'))
  execute function public.cash_entries_source_party();

-- Kapanış günü: 'paid' olunca bağlı son hareket tarihi (yoksa açıkça verilen ya da bugün); 'paid' değilse boş.
create or replace function public.finance_open_items_settled_on()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
begin
  if new.status = 'paid' then
    if tg_op = 'INSERT' then
      new.settled_on := coalesce(new.settled_on, v_today);
    elsif old.status is distinct from 'paid' then
      new.settled_on := coalesce(
        case when new.settled_on is distinct from old.settled_on then new.settled_on end,
        (select max(e.entry_date) from public.cash_entries e where e.open_item_id = new.id and e.voided_at is null),
        v_today);
    end if;
  else
    new.settled_on := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_finance_open_items_settled_on on public.finance_open_items;
create trigger trg_finance_open_items_settled_on
  before insert or update on public.finance_open_items
  for each row execute function public.finance_open_items_settled_on();

-- ---------------------------------------------------------------------------
-- 3) Geri doldurma: property_dues → finance_open_items (idempotent)
-- ---------------------------------------------------------------------------
create or replace function public.finance_due_backfill()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  d record;
  v_issue date;
  v_due date;
  v_note text;
  v_moved boolean;
  v_guard integer;
  v_party uuid;
  v_id uuid;
  v_n integer := 0;
begin
  for d in
    select pd.*, pr.owner_customer_id
      from public.property_dues pd
      left join public.properties pr on pr.id = pd.property_id and pr.tenant_id = pd.tenant_id
     where pd.amount > 0
       and not exists (select 1 from public.finance_open_items o
                        where o.tenant_id = pd.tenant_id and o.source_type = 'due' and o.source_id = pd.id)
     order by pd.tenant_id, pd.period, pd.created_at
  loop
    v_issue := least(greatest(d.period, date '2000-01-01'), date '2100-12-01');
    v_moved := false;
    v_guard := 0;
    while public.finance_period_is_locked(d.tenant_id, v_issue) and v_guard < 240 loop
      v_issue := (pg_catalog.date_trunc('month', v_issue) + interval '1 month')::date;
      v_moved := true;
      v_guard := v_guard + 1;
    end loop;
    v_due := least(greatest(coalesce(d.due_date, v_issue), v_issue), date '2100-12-31');
    v_note := concat_ws(' · ',
      nullif(pg_catalog.btrim(coalesce(d.notes, '')), ''),
      case when d.status = 'paid' then 'kasa dışı' end,
      case when v_moved then 'kilitli dönemden taşındı (' || pg_catalog.to_char(d.period, 'DD.MM.YYYY') || ')' end);
    if char_length(coalesce(v_note, '')) > 1000 then v_note := pg_catalog.left(v_note, 1000); end if;
    v_party := case when d.direction = 'receivable' then public.finance_customer_party(d.tenant_id, d.owner_customer_id, 'malik') end;

    insert into public.finance_open_items (tenant_id, direction, party_id, title, category, amount, currency, issue_date, due_date,
      paid_amount, status, settled_on, source_type, source_id, property_id, note, created_by, created_at)
    values (d.tenant_id, d.direction, v_party,
      pg_catalog.left(coalesce(nullif(pg_catalog.btrim(d.title), ''), 'Aidat'), 160),
      case when d.direction = 'receivable' then 'aidat_tahsilat' else 'aidat' end,
      d.amount, 'TRY', v_issue, v_due,
      case when d.status = 'paid' then d.amount else 0 end,
      case when d.status = 'paid' then 'paid' else 'open' end,
      case when d.status = 'paid' then coalesce((d.paid_at at time zone 'Europe/Istanbul')::date, v_issue) end,
      'due', d.id, d.property_id, nullif(v_note, ''), d.created_by, d.created_at)
    on conflict do nothing
    returning id into v_id;

    if v_id is not null then
      update public.property_dues set open_item_id = v_id where id = d.id and open_item_id is distinct from v_id;
      perform public.finance_wp4_stamp_key('finance_open_items', v_id, 'due:' || d.id::text);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

do $$
declare
  v_n integer;
begin
  v_n := public.finance_due_backfill();
  raise notice '20261017010500: % aidat açık kaleme taşındı', v_n;
  if not exists (select 1 from pg_catalog.pg_attribute
                  where attrelid = 'public.finance_open_items'::regclass and attname = 'posting_key' and not attisdropped) then
    raise notice '20261017010500: finance_open_items.posting_key yok (WP1 uygulanmamış); due:{id} anahtarı damgalanmadı';
  end if;
end $$;

-- Mevcut kaynak bağlı hareketlerin carisi (yalnız party_id; parasal alan değişmez).
do $$
declare
  e record;
  v_party uuid;
begin
  for e in
    select c.id, c.tenant_id, c.source_type, c.source_id from public.cash_entries c
     where c.party_id is null and c.source_type in ('rent', 'owner_payout', 'building') and c.source_id is not null
  loop
    v_party := public.finance_source_party(e.tenant_id, e.source_type, e.source_id);
    if v_party is not null then
      update public.cash_entries set party_id = v_party where id = e.id and party_id is null;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4) property_dues salt okunur (geçmiş). service_role/sahip yazabilir (kiracı silme zinciri, portföy silme set null).
-- ---------------------------------------------------------------------------
drop policy if exists property_dues_tenant_insert on public.property_dues;
drop policy if exists property_dues_tenant_update on public.property_dues;
drop policy if exists property_dues_delete on public.property_dues;
revoke insert, update, delete, truncate on public.property_dues from public, anon, authenticated;
comment on table public.property_dues is 'GEÇMİŞ (salt okunur, 20261017010500): tekil mülk aidatı artık finance_open_items (source_type=due) içindedir.';

-- owner_charge_links 'due' yansıtması: aidat açık kalemi (source_id = ref_id, iptal edilmemiş) kira ile aynı portföyde olmalı.
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
        select 1 from public.finance_open_items o
          join public.rentals r on r.property_id = o.property_id and r.tenant_id = o.tenant_id
         where o.source_type = 'due' and o.source_id = ref_id and o.status <> 'cancelled'
           and o.tenant_id = owner_charge_links.tenant_id and r.id = owner_charge_links.rental_id
      ))
    )
  );

-- ---------------------------------------------------------------------------
-- 5) Aidat RPC'leri
-- ---------------------------------------------------------------------------
create or replace function public.finance_due_create(p jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('create');
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_dir text := coalesce(nullif(p ->> 'direction', ''), 'payable');
  v_title text := pg_catalog.btrim(coalesce(p ->> 'title', ''));
  v_note text := nullif(pg_catalog.btrim(coalesce(p ->> 'note', '')), '');
  v_amount numeric;
  v_issue date;
  v_due date;
  v_property uuid;
  v_party uuid;
  v_owner uuid;
  v_id uuid := gen_random_uuid();
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then perform public.finance_v2_raise('invalid_input'); end if;
  begin
    v_amount := nullif(p ->> 'amount', '')::numeric;
    v_issue := coalesce(nullif(p ->> 'issue_date', '')::date, v_today);
    v_due := coalesce(nullif(p ->> 'due_date', '')::date, v_issue);
    v_property := nullif(p ->> 'property_id', '')::uuid;
    v_party := nullif(p ->> 'party_id', '')::uuid;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    perform public.finance_v2_raise('invalid_input');
  end;
  if v_dir not in ('payable', 'receivable') or char_length(v_title) not between 1 and 160
     or v_amount is null or v_amount < 0.01 or v_amount > 9999999999.99 or pg_catalog.round(v_amount, 2) <> v_amount
     or v_issue < date '2000-01-01' or v_issue > date '2100-12-31' or v_due < v_issue or v_due > date '2100-12-31'
     or char_length(coalesce(v_note, '')) > 1000 then
    perform public.finance_v2_raise('invalid_input');
  end if;
  if v_property is not null then
    select pr.owner_customer_id into v_owner from public.properties pr where pr.id = v_property and pr.tenant_id = v_tenant;
    if not found then perform public.finance_v2_raise('invalid_input'); end if;
  end if;
  v_party := public.finance_v2_resolve_party(v_tenant, v_party, p ->> 'party_name',
    coalesce(nullif(p ->> 'party_kind', ''), case when v_dir = 'receivable' then 'malik' else 'tedarikci' end));
  -- Ofisin malikten tahsil ettiği aidat: cari verilmediyse portföyün malik müşterisi.
  if v_party is null and v_dir = 'receivable' and v_owner is not null then
    v_party := public.finance_customer_party(v_tenant, v_owner, 'malik');
  end if;

  insert into public.finance_open_items (id, tenant_id, direction, party_id, title, category, amount, currency, issue_date, due_date,
    source_type, source_id, property_id, note, created_by)
  values (v_id, v_tenant, v_dir, v_party, v_title, case when v_dir = 'receivable' then 'aidat_tahsilat' else 'aidat' end,
    v_amount, 'TRY', v_issue, v_due, 'due', v_id, v_property, v_note, auth.uid());
  perform public.finance_wp4_stamp_key('finance_open_items', v_id, 'due:' || v_id::text);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, auth.uid(), 'finance_due.create', 'finance_open_item', v_id,
    jsonb_build_object('direction', v_dir, 'amount', v_amount, 'issue_date', v_issue, 'due_date', v_due, 'property_id', v_property));
  return v_id;
end;
$$;

-- Aidat kalemini bul (kiracı + kaynak kontrolü); kilitli satır döner.
create or replace function public.finance_due_lock(p_tenant uuid, p_id uuid)
returns public.finance_open_items
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_item public.finance_open_items%rowtype;
begin
  select * into v_item from public.finance_open_items o
   where o.id = p_id and o.tenant_id = p_tenant and o.source_type = 'due' for update;
  if not found then perform public.finance_v2_raise('not_found'); end if;
  return v_item;
end;
$$;

create or replace function public.finance_due_update(p_id uuid, p jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('edit');
  v_item public.finance_open_items%rowtype;
  v_title text := pg_catalog.btrim(coalesce(p ->> 'title', ''));
  v_note text := nullif(pg_catalog.btrim(coalesce(p ->> 'note', '')), '');
  v_amount numeric;
  v_issue date;
  v_due date;
  v_property uuid;
begin
  if p_id is null or p is null or pg_catalog.jsonb_typeof(p) <> 'object' then perform public.finance_v2_raise('invalid_input'); end if;
  v_item := public.finance_due_lock(v_tenant, p_id);
  if v_item.status not in ('open', 'partial') then perform public.finance_v2_raise('item_closed'); end if;
  begin
    v_amount := nullif(p ->> 'amount', '')::numeric;
    v_issue := coalesce(nullif(p ->> 'issue_date', '')::date, v_item.issue_date);
    v_due := coalesce(nullif(p ->> 'due_date', '')::date, v_issue);
    v_property := case when (p -> 'property_id') is not null then nullif(p ->> 'property_id', '')::uuid else v_item.property_id end;
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
    perform public.finance_v2_raise('invalid_input');
  end;
  if char_length(v_title) not between 1 and 160
     or v_amount is null or v_amount < 0.01 or v_amount > 9999999999.99 or pg_catalog.round(v_amount, 2) <> v_amount
     or v_issue < date '2000-01-01' or v_issue > date '2100-12-31' or v_due < v_issue or v_due > date '2100-12-31'
     or char_length(coalesce(v_note, '')) > 1000 then
    perform public.finance_v2_raise('invalid_input');
  end if;
  if v_amount < v_item.paid_amount then perform public.finance_v2_raise('amount_below_paid'); end if;
  if v_property is not null and v_property is distinct from v_item.property_id
     and not exists (select 1 from public.properties pr where pr.id = v_property and pr.tenant_id = v_tenant) then
    perform public.finance_v2_raise('invalid_input');
  end if;

  update public.finance_open_items o
     set title = v_title, amount = v_amount, issue_date = v_issue, due_date = v_due, note = v_note, property_id = v_property
   where o.id = p_id;
  perform public.finance_open_item_recompute(p_id);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  values (v_tenant, auth.uid(), 'finance_due.update', 'finance_open_item', p_id,
    jsonb_build_object('amount', v_item.amount, 'issue_date', v_item.issue_date, 'due_date', v_item.due_date),
    jsonb_build_object('amount', v_amount, 'issue_date', v_issue, 'due_date', v_due));
end;
$$;

-- Ödendi işareti (tekil ya da toplu, en çok 200). Hesap verilirse kalan tutar o hesaba hareket olarak yazılır
-- (finance_open_item_settle; KDV/stopaj/kilit kuralları aynı). Hesap yoksa yalnız hiç hareketi olmayan açık kalem
-- 'kasa dışı' kapatılır (nakit uydurulmaz). Zaten kapalı/iptal kalemler atlanır. Dönüş: kapatılan kalem sayısı.
create or replace function public.finance_due_mark_paid(p_ids uuid[], p_account_id uuid default null, p_date date default null)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('edit');
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_date date := coalesce(p_date, v_today);
  v_item public.finance_open_items%rowtype;
  v_id uuid;
  v_n integer := 0;
begin
  if p_ids is null or coalesce(pg_catalog.array_length(p_ids, 1), 0) = 0 or pg_catalog.array_length(p_ids, 1) > 200
     or v_date > v_today or v_date < date '2000-01-01' then
    perform public.finance_v2_raise('invalid_input');
  end if;
  foreach v_id in array p_ids loop
    select * into v_item from public.finance_open_items o
     where o.id = v_id and o.tenant_id = v_tenant and o.source_type = 'due' for update;
    if not found then
      if pg_catalog.array_length(p_ids, 1) = 1 then perform public.finance_v2_raise('not_found'); end if;
      continue;
    end if;
    if v_item.status not in ('open', 'partial') then continue; end if;
    if p_account_id is not null then
      perform public.finance_open_item_settle(v_id, p_account_id, null, v_date, 'Aidat ödemesi');
    else
      if v_item.status <> 'open' or exists (select 1 from public.cash_entries e where e.open_item_id = v_id and e.voided_at is null) then
        if pg_catalog.array_length(p_ids, 1) = 1 then perform public.finance_v2_raise('account_required'); end if;
        continue;
      end if;
      update public.finance_open_items o
         set paid_amount = o.amount, status = 'paid', settled_on = v_date,
             note = pg_catalog.left(concat_ws(' · ', nullif(o.note, ''), 'kasa dışı'), 1000)
       where o.id = v_id;
      insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
      values (v_tenant, auth.uid(), 'finance_due.mark_paid', 'finance_open_item', v_id,
        jsonb_build_object('amount', v_item.amount, 'cash', false, 'settled_on', v_date));
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Ödendi işaretini geri alır: yalnız 'kasa dışı' kapatılmış kalem (bağlı geçerli hareket varsa hareket Muhasebe'den iptal edilir).
create or replace function public.finance_due_reopen(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('edit');
  v_item public.finance_open_items%rowtype;
begin
  if p_id is null then perform public.finance_v2_raise('invalid_input'); end if;
  v_item := public.finance_due_lock(v_tenant, p_id);
  if v_item.status <> 'paid' then perform public.finance_v2_raise('item_not_paid'); end if;
  if exists (select 1 from public.cash_entries e where e.open_item_id = p_id and e.voided_at is null) then
    perform public.finance_v2_raise('has_cash');
  end if;
  update public.finance_open_items o set paid_amount = 0, status = 'open' where o.id = p_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value)
  values (v_tenant, auth.uid(), 'finance_due.reopen', 'finance_open_item', p_id, jsonb_build_object('status', 'paid', 'amount', v_item.amount));
end;
$$;

-- Silme YOK: iptal (status cancelled + neden + denetim; finance_open_item_cancel). Mülk sahibine yansıtılmış kalem önce geri alınır.
create or replace function public.finance_due_cancel(p_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.finance_v2_ctx('delete');
  v_item public.finance_open_items%rowtype;
begin
  if p_id is null then perform public.finance_v2_raise('invalid_input'); end if;
  v_item := public.finance_due_lock(v_tenant, p_id);
  if exists (select 1 from public.owner_charge_links l where l.tenant_id = v_tenant and l.kind = 'due' and l.ref_id = v_item.source_id) then
    perform public.finance_v2_raise('linked_to_owner');
  end if;
  perform public.finance_open_item_cancel(p_id, p_reason);
end;
$$;

-- Aidat KPI'ı (tekil mülk aidatı = source_type 'due', iptal hariç). Açık kiracı süzgeci + expenses:view.
create or replace function public.aidat_kpi()
returns table (
  total         numeric,
  unpaid        numeric,
  overdue_count bigint,
  overdue_total numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid := public.current_active_tenant_id();
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
begin
  if v_tenant is null or not public.has_effective_permission('expenses', 'view') then
    return query select 0::numeric, 0::numeric, 0::bigint, 0::numeric;
    return;
  end if;
  return query
  select coalesce(sum(o.amount), 0)::numeric,
         coalesce(sum(o.amount - o.paid_amount) filter (where o.status in ('open', 'partial')), 0)::numeric,
         count(*) filter (where o.status in ('open', 'partial') and o.due_date <= v_today),
         coalesce(sum(o.amount - o.paid_amount) filter (where o.status in ('open', 'partial') and o.due_date <= v_today), 0)::numeric
    from public.finance_open_items o
   where o.tenant_id = v_tenant and o.source_type = 'due' and o.status <> 'cancelled';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Depozito emanet (K/Z dışı; kiracıya borç). Hareket mevcut finance_record_entry_v2 yolundan yazılır.
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

  v_party := public.finance_customer_party(v_tenant, v_r.renter_customer_id, 'kiraci');
  v_id := public.finance_record_entry_v2(jsonb_build_object(
    'account_id', p_account_id,
    'direction', case when p_event = 'received' then 'in' else 'out' end,
    'amount', v_r.deposit,
    'entry_date', coalesce(p_date, v_today),
    'category', 'depozito',
    'title', case when p_event = 'received' then 'Depozito alındı' else 'Depozito iadesi' end,
    'party_id', v_party,
    'property_id', v_r.property_id,
    'note', 'Emanet (kâr/zarar dışı)'));

  if p_event = 'received' then
    update public.rentals set deposit_received_entry_id = v_id where id = p_rental_id;
  else
    update public.rentals set deposit_returned_entry_id = v_id where id = p_rental_id;
  end if;
  perform public.finance_wp4_stamp_key('cash_entries', v_id, 'deposit:' || p_rental_id::text || ':' || p_event);

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, v_uid, 'rental.deposit_post', 'rental', p_rental_id,
    jsonb_build_object('event', p_event, 'entry_id', v_id, 'amount', v_r.deposit));
  return v_id;
end;
$$;

-- Depozito hareketini iptal eder (silinmez; finance_void_entry). Hareket yoksa no-op.
create or replace function public.rental_deposit_unpost(p_rental_id uuid, p_event text, p_reason text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_entry uuid;
  v_res jsonb;
begin
  if auth.uid() is null then perform public.finance_v2_raise('unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then perform public.finance_v2_raise('unauthorized'); end if;
  if public.current_profile_role() = 'readonly' or not public.has_effective_permission('rentals', 'edit') then
    perform public.finance_v2_raise('forbidden');
  end if;
  if p_rental_id is null or p_event not in ('received', 'returned') then perform public.finance_v2_raise('invalid_input'); end if;
  select case when p_event = 'received' then r.deposit_received_entry_id else r.deposit_returned_entry_id end
    into v_entry from public.rentals r where r.id = p_rental_id and r.tenant_id = v_tenant for update;
  if not found then perform public.finance_v2_raise('not_found'); end if;
  if v_entry is null then return false; end if;
  v_res := public.finance_void_entry(v_entry, coalesce(nullif(pg_catalog.btrim(coalesce(p_reason, '')), ''), 'Depozito kaydı geri alındı'));
  if coalesce(v_res ->> 'outcome', '') not in ('voided', 'already_voided', 'not_found') then
    perform public.finance_v2_raise(coalesce(v_res ->> 'outcome', 'error'));
  end if;
  if p_event = 'received' then
    update public.rentals set deposit_received_entry_id = null where id = p_rental_id;
  else
    update public.rentals set deposit_returned_entry_id = null where id = p_rental_id;
  end if;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) Yetkiler
-- ---------------------------------------------------------------------------
revoke all on function public.finance_wp4_stamp_key(text, uuid, text) from public, anon, authenticated;
revoke all on function public.finance_customer_party(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.finance_source_party(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.cash_entries_source_party() from public, anon, authenticated;
revoke all on function public.finance_open_items_settled_on() from public, anon, authenticated;
revoke all on function public.finance_due_backfill() from public, anon, authenticated;
revoke all on function public.finance_due_lock(uuid, uuid) from public, anon, authenticated;
grant execute on function public.finance_due_backfill() to service_role;

revoke all on function public.finance_due_create(jsonb) from public, anon;
revoke all on function public.finance_due_update(uuid, jsonb) from public, anon;
revoke all on function public.finance_due_mark_paid(uuid[], uuid, date) from public, anon;
revoke all on function public.finance_due_reopen(uuid) from public, anon;
revoke all on function public.finance_due_cancel(uuid, text) from public, anon;
revoke all on function public.aidat_kpi() from public, anon;
revoke all on function public.rental_deposit_post(uuid, text, uuid, date) from public, anon;
revoke all on function public.rental_deposit_unpost(uuid, text, text) from public, anon;
grant execute on function public.finance_due_create(jsonb) to authenticated, service_role;
grant execute on function public.finance_due_update(uuid, jsonb) to authenticated, service_role;
grant execute on function public.finance_due_mark_paid(uuid[], uuid, date) to authenticated, service_role;
grant execute on function public.finance_due_reopen(uuid) to authenticated, service_role;
grant execute on function public.finance_due_cancel(uuid, text) to authenticated, service_role;
grant execute on function public.aidat_kpi() to authenticated, service_role;
grant execute on function public.rental_deposit_post(uuid, text, uuid, date) to authenticated, service_role;
grant execute on function public.rental_deposit_unpost(uuid, text, text) to authenticated, service_role;

comment on function public.finance_due_cancel(uuid, text) is 'Aidat iptali (deleteDue yerine): kayıt silinmez; status cancelled + neden + audit_logs.';
comment on function public.rental_deposit_post(uuid, text, uuid, date) is 'Depozito emaneti kasaya: received = giriş, returned = çıkış; kategori depozito (K/Z dışı); rentals.deposit_*_entry_id ile tekil.';
