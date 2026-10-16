-- 20261020020002 geri alma: teslim/tahliye tutanağı, fotoğraf ve kalemli depozito kesintisi tabloları düşer;
--   rental_deposit_post gövdesi 20261017010500'deki haline (iade = tam depozito) döner. Tutanak ve kesinti verisi SİLİNİR.
set local lock_timeout = '5s';

-- Depozito emanet gövdesi (20261017010500 ile birebir).
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


drop table if exists public.rental_deposit_deductions;
drop table if exists public.rental_inspection_photos;
drop table if exists public.rental_inspections;
drop function if exists public.rental_deposit_deductions_guard();
drop function if exists public.rental_inspections_guard();
