-- Kira içe aktarma: kiralama anlaşması (won) + komisyon (0 olabilir) + aktif kira TEK transaction'da (PB52).
--
-- NEDEN: Aktif kira kaydı, kazanılmış kiralama anlaşması + komisyon zinciri ister (rentals/deals/commissions guard
--   tetikleyicileri, 20260813000000). Mevcut create_rental_atomic yalnız service_role'e açık ve portföyde geçerli komisyon
--   ORANI şart koşar; geçmiş kiraları toplu aktaran ofislerde oran/komisyon çoğu zaman yoktur (§29 ERTELENDİ notu).
-- RPC import_rental_with_deal(...) → jsonb {outcome[, rental_id, deal_id, commission_id]}:
--   - authenticated + SECURITY DEFINER + boş search_path. Yetki İÇERİDE: auth.uid(), aktif tenant
--     (current_active_tenant_id: aktif profil, askıda olmayan ofis, 2FA, salt-okunur destek oturumu hariç) ve
--     has_effective_permission('rentals','create') + ('commissions','create') (createRental action'ı ile aynı iki kapı).
--     Tenant ÇAĞIRANDAN alınmaz; tüm kayıtlar oturumun ofisinde aranır (başka ofis kimliği = not_found).
--   - Portföy kilitlenir (tüm kapanış yollarının ortak muteksi); aktif kira / kapanmış anlaşma / satılmış portföy reddedilir.
--   - Komisyon: p_commission verilirse o tutar (0 dahil), verilmezse portföy oranı × aylık kira, oran yoksa 0.
--     KDV %20, paylaşım 50/50 (create_won_deal_atomic varsayılanı).
--   - Guard tetikleyicileri `auth.role() = authenticated` iken doğrudan yazımı reddeder; bu fonksiyon yetkiyi doğruladıktan
--     SONRA yalnız kendi transaction'ı için `request.jwt.claim.role`u service_role yapar (atomik iş akışı kimliği) ve
--     dönmeden önce eski değere geri koyar. auth.uid() değişmez (denetim kaydı gerçek kullanıcıya yazılır).
--   - Kiracıya 'Kiracı' etiketi; malik verildiyse ve portföyün maliki boşsa owner_customer_id bağlanır.
--   - audit_logs: rental.import (deal/rental/komisyon kimlikleri, toplu kimlik).
-- BAGIMLILIK: 20260813000000 (guard'lar + uq_* indeksleri), 20260812000000 (rentals.deal_id, deals.closure_active),
--   20260825000100 (properties.owner_customer_id; yoksa malik bağı atlanır), 20260802000300 (yetki yardımcıları).
-- GERI ALMA: rollbacks/20261007000710_import_rental_with_deal.rollback.sql (yalnız fonksiyon düşer; aktarılmış kayıtlar KALIR).
-- RISK: düşük-orta (yeni authenticated yazma RPC'si; mevcut fonksiyon/politika değişmez).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.rentals') is null
     or pg_catalog.to_regclass('public.deals') is null
     or pg_catalog.to_regclass('public.commissions') is null
     or pg_catalog.to_regclass('public.audit_logs') is null
     or pg_catalog.to_regprocedure('public.current_active_tenant_id()') is null
     or pg_catalog.to_regprocedure('public.has_effective_permission(text,text)') is null then
    raise exception '20261007000710: rentals/deals/commissions/audit_logs veya yetki yardimcilari yok.';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'rentals' and column_name = 'deal_id'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'deals' and column_name = 'closure_active'
  ) then
    raise exception '20261007000710: rentals.deal_id / deals.closure_active yok (20260812000000 once uygulanmali).';
  end if;
end $$;

create or replace function public.import_rental_with_deal(
  p_property_id uuid,
  p_renter_id uuid,
  p_monthly_rent numeric,
  p_due_day integer,
  p_start_date date,
  p_end_date date default null,
  p_deposit numeric default null,
  p_commission numeric default null,
  p_owner_id uuid default null,
  p_assigned_to uuid default null,
  p_notes text default null,
  p_batch_id uuid default null
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
  v_property public.properties%rowtype;
  v_assignee uuid;
  v_prev_role text;
  v_commission numeric;
  v_vat numeric;
  v_advisor numeric;
  v_deal_id uuid;
  v_commission_id uuid;
  v_rental_id uuid;
  v_prev_status text;
  v_owner_linked boolean := false;
  v_owner_rows integer := 0;
  v_has_owner_col boolean;
begin
  if v_uid is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then
    return jsonb_build_object('outcome', 'unauthorized');
  end if;
  if not public.has_effective_permission('rentals', 'create')
     or not public.has_effective_permission('commissions', 'create') then
    return jsonb_build_object('outcome', 'forbidden');
  end if;

  if p_property_id is null or p_renter_id is null
     or p_monthly_rent is null or p_monthly_rent < 0.01 or p_monthly_rent > 1000000000
     or round(p_monthly_rent, 2) <> p_monthly_rent
     or p_due_day is null or p_due_day not between 1 and 28
     or p_start_date is null
     or (p_end_date is not null and p_end_date <= p_start_date)
     or (p_deposit is not null and (p_deposit < 0 or p_deposit > 1000000000 or round(p_deposit, 2) <> p_deposit))
     or (p_commission is not null and (p_commission < 0 or p_commission > 100000000000 or round(p_commission, 2) <> p_commission))
     or char_length(coalesce(p_notes, '')) > 5000 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  v_assignee := coalesce(p_assigned_to, v_uid);
  if not exists (
    select 1 from public.profiles pr
     where pr.id = v_assignee and pr.tenant_id = v_tenant and pr.is_active = true
  ) then
    return jsonb_build_object('outcome', 'assignee_not_found');
  end if;

  -- Portföy satırı tüm kapanış yollarının ortak muteksi.
  select p.* into v_property
    from public.properties p
   where p.id = p_property_id and p.tenant_id = v_tenant and p.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'property_not_found');
  end if;
  if v_property.status = 'sold' then
    return jsonb_build_object('outcome', 'property_unavailable');
  end if;
  if exists (
    select 1 from public.rentals r
     where r.tenant_id = v_tenant and r.property_id = p_property_id and r.status = 'active'
  ) then
    return jsonb_build_object('outcome', 'property_active_rental');
  end if;
  if exists (
    select 1 from public.deals d
     where d.tenant_id = v_tenant and d.property_id = p_property_id and d.closure_active = true
  ) then
    return jsonb_build_object('outcome', 'property_already_closed');
  end if;

  perform 1 from public.customers c
   where c.id = p_renter_id and c.tenant_id = v_tenant and c.deleted_at is null
   for update;
  if not found then
    return jsonb_build_object('outcome', 'renter_not_found');
  end if;
  if p_owner_id is not null then
    if p_owner_id = p_renter_id then
      return jsonb_build_object('outcome', 'invalid_input');
    end if;
    perform 1 from public.customers c
     where c.id = p_owner_id and c.tenant_id = v_tenant and c.deleted_at is null;
    if not found then
      return jsonb_build_object('outcome', 'owner_not_found');
    end if;
  end if;

  v_commission := coalesce(
    p_commission,
    case
      when v_property.commission_rate is not null and v_property.commission_rate > 0 and v_property.commission_rate <= 100
        then round(p_monthly_rent * (v_property.commission_rate / 100), 2)
      else 0
    end
  );
  v_vat := round(v_commission * 0.20, 2);
  v_advisor := round(v_commission * 0.50, 2);
  v_prev_status := case
    when v_property.status in ('sold', 'rented') then 'live'
    else coalesce(v_property.status, 'live')
  end;

  -- Atomik iş akışı kimliği: yetki yukarıda doğrulandı; guard tetikleyicileri yalnız bu transaction'da geçer.
  v_prev_role := pg_catalog.current_setting('request.jwt.claim.role', true);
  perform pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

  insert into public.deals (
    tenant_id, property_id, customer_id, deal_type, stage, deal_value, probability,
    assigned_to, closure_active, prev_property_status
  ) values (
    v_tenant, p_property_id, p_renter_id, 'rent', 'won', p_monthly_rent, 100,
    v_assignee, true, v_prev_status
  ) returning id into v_deal_id;

  insert into public.commissions (tenant_id, deal_id, gross_amount, vat_amount, status, splits)
  values (
    v_tenant, v_deal_id, v_commission, v_vat, 'calculated',
    jsonb_build_array(
      jsonb_build_object('label', 'Danışman', 'rate', 50, 'amount', v_advisor),
      jsonb_build_object('label', 'Ofis', 'rate', 50, 'amount', v_commission - v_advisor)
    )
  ) returning id into v_commission_id;

  insert into public.rentals (
    tenant_id, created_by, property_id, renter_customer_id, monthly_rent, due_day,
    start_date, end_date, deposit, notes, status, prev_property_status, deal_id
  ) values (
    v_tenant, v_uid, p_property_id, p_renter_id, p_monthly_rent, p_due_day,
    p_start_date, p_end_date, p_deposit, nullif(btrim(coalesce(p_notes, '')), ''), 'active',
    v_prev_status, v_deal_id
  ) returning id into v_rental_id;

  update public.properties
     set status = 'rented', updated_at = pg_catalog.clock_timestamp()
   where id = p_property_id and tenant_id = v_tenant;

  update public.customers
     set customer_types = case
           when coalesce(customer_types, '{}'::text[]) @> array['Kiracı']::text[] then customer_types
           else pg_catalog.array_append(coalesce(customer_types, '{}'::text[]), 'Kiracı')
         end,
         updated_at = pg_catalog.clock_timestamp()
   where id = p_renter_id and tenant_id = v_tenant;

  if p_owner_id is not null then
    select exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'properties' and column_name = 'owner_customer_id'
    ) into v_has_owner_col;
    if v_has_owner_col then
      execute 'update public.properties set owner_customer_id = $1 where id = $2 and tenant_id = $3 and owner_customer_id is null'
        using p_owner_id, p_property_id, v_tenant;
      get diagnostics v_owner_rows = row_count;
      v_owner_linked := v_owner_rows > 0;
    end if;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (
    v_tenant, v_uid, 'rental.import', 'rental', v_rental_id,
    jsonb_build_object(
      'property_id', p_property_id, 'renter_id', p_renter_id, 'owner_id', p_owner_id,
      'owner_linked', v_owner_linked, 'monthly_rent', p_monthly_rent, 'deal_id', v_deal_id,
      'commission_id', v_commission_id, 'commission', v_commission, 'batch_id', p_batch_id
    )
  );

  perform pg_catalog.set_config('request.jwt.claim.role', coalesce(v_prev_role, ''), true);

  return jsonb_build_object(
    'outcome', 'created', 'rental_id', v_rental_id, 'deal_id', v_deal_id,
    'commission_id', v_commission_id, 'owner_linked', v_owner_linked
  );
end;
$$;

revoke all on function public.import_rental_with_deal(
  uuid, uuid, numeric, integer, date, date, numeric, numeric, uuid, uuid, text, uuid
) from public, anon;
grant execute on function public.import_rental_with_deal(
  uuid, uuid, numeric, integer, date, date, numeric, numeric, uuid, uuid, text, uuid
) to authenticated, service_role;

comment on function public.import_rental_with_deal(
  uuid, uuid, numeric, integer, date, date, numeric, numeric, uuid, uuid, text, uuid
) is 'Kira ice aktarma: kazanilmis kiralama anlasmasi + komisyon (0 olabilir) + aktif kira tek transaction. Yetki icerde (aktif tenant + rentals/commissions create).';

notify pgrst, 'reload schema';
