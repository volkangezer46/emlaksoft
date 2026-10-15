-- 20261018080000 geri alma: asama gecmisi tetikleyicileri, olay tablosu, satis hizi ve rapor yardimcilari kaldirilir;
-- transition_deal_stage_atomic 20260813000000 govdesine (birebir) doner. deals.stage_changed_at / expected_close_date / closed_at
-- kolonlari DUSER (girilen beklenen kapanis tarihleri kaybolur; gerekirse PITR).
-- BAGIMLI: 20261018080002 (report_* fonksiyonlari report_scope_member_ids/report_sample_included kullanir) ONCE geri alinmalidir.

set local lock_timeout = '5s';

drop function if exists public.deal_stage_velocity(date, date, uuid, uuid, uuid, integer);
drop function if exists public.report_scope_member_ids(uuid, uuid, uuid);
drop function if exists public.report_sample_included(integer);

drop trigger if exists deals_stage_history_after on public.deals;
drop trigger if exists deals_stage_history_before on public.deals;
drop function if exists public.deals_stage_history_after();
drop function if exists public.deals_stage_history_before();

drop table if exists public.deal_stage_events;

drop index if exists public.idx_deals_tenant_closed_at;
alter table public.deals drop column if exists stage_changed_at;
alter table public.deals drop column if exists expected_close_date;
alter table public.deals drop column if exists closed_at;

-- transition_deal_stage_atomic: 20260813000000 govdesi (birebir)
create or replace function public.transition_deal_stage_atomic(
  p_tenant_id uuid,
  p_actor_id uuid,
  p_deal_id uuid,
  p_stage text,
  p_loss_reason text default null,
  p_expected_stage text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deal public.deals%rowtype;
  v_property public.properties%rowtype;
  v_commission public.commissions%rowtype;
  v_stage text := lower(btrim(coalesce(p_stage, '')));
  v_value numeric;
  v_rate numeric;
  v_net numeric;
  v_vat numeric;
  v_advisor numeric;
  v_target_property_status text;
  v_now timestamptz := clock_timestamp();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required.' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_actor_id is null or p_deal_id is null
     or v_stage not in ('new', 'qualified', 'negotiation', 'won', 'lost')
     or (p_expected_stage is not null
         and lower(btrim(p_expected_stage)) not in ('new', 'qualified', 'negotiation', 'won', 'lost'))
     or char_length(coalesce(p_loss_reason, '')) > 1000 then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;

  select d.* into v_deal
  from public.deals d
  where d.id = p_deal_id and d.tenant_id = p_tenant_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p_expected_stage is not null
     and v_deal.stage::text <> lower(btrim(p_expected_stage)) then
    return jsonb_build_object('outcome', 'conflict', 'current_stage', v_deal.stage);
  end if;
  if v_deal.stage = v_stage then
    return jsonb_build_object('outcome', 'replay', 'current_stage', v_stage);
  end if;
  if not (
    (v_deal.stage = 'new' and v_stage in ('qualified', 'lost'))
    or (v_deal.stage = 'qualified' and v_stage in ('negotiation', 'lost'))
    or (v_deal.stage = 'negotiation' and v_stage in ('won', 'lost'))
    or (v_deal.stage = 'won' and v_stage = 'negotiation')
    or (v_deal.stage = 'lost' and v_stage = 'negotiation')
  ) then
    return jsonb_build_object(
      'outcome', 'invalid_transition', 'current_stage', v_deal.stage,
      'requested_stage', v_stage
    );
  end if;
  if v_stage = 'lost' and nullif(btrim(coalesce(p_loss_reason, '')), '') is null then
    return jsonb_build_object('outcome', 'loss_reason_required');
  end if;

  if v_deal.stage = 'won' then
    if v_deal.deal_type = 'rent' and exists (
      select 1 from public.rentals r
      where r.tenant_id = p_tenant_id and r.deal_id = p_deal_id
    ) then
      return jsonb_build_object('outcome', 'rental_lifecycle_required');
    end if;
    select c.* into v_commission
    from public.commissions c
    where c.deal_id = p_deal_id and c.tenant_id = p_tenant_id
    for update;
    if found and v_commission.status in ('paid', 'collected') then
      return jsonb_build_object('outcome', 'commission_settled');
    end if;
    if found and exists (
      select 1 from public.payment_links pl
      where pl.tenant_id = p_tenant_id and pl.commission_id = v_commission.id
        and (
          pl.status in ('open', 'paid')
          or exists (
            select 1 from public.billing_payment_captures bpc
            where bpc.payment_link_id = pl.id
              and bpc.status <> 'refunded'
          )
        )
    ) then
      return jsonb_build_object('outcome', 'payment_in_progress');
    end if;
    if found then
      delete from public.commissions
      where id = v_commission.id and tenant_id = p_tenant_id;
    end if;

    update public.deals
    set stage = v_stage,
        closure_active = false,
        loss_reason = null,
        probability = 60,
        updated_at = v_now
    where id = p_deal_id and tenant_id = p_tenant_id and stage = 'won';
    if not found then
      raise exception 'Deal state changed while reopening.' using errcode = '40001';
    end if;

    if v_deal.property_id is not null
       and not exists (
         select 1 from public.deals d
         where d.tenant_id = p_tenant_id
           and d.property_id = v_deal.property_id
           and d.id <> p_deal_id and d.closure_active = true
       ) then
      update public.properties
      set status = case
            when v_deal.prev_property_status is null
              or v_deal.prev_property_status in ('sold', 'rented') then 'live'
            else v_deal.prev_property_status
          end,
          updated_at = v_now
      where id = v_deal.property_id and tenant_id = p_tenant_id
        and status = case when v_deal.deal_type = 'rent' then 'rented' else 'sold' end;
    end if;
  elsif v_stage = 'won' then
    if v_deal.property_id is null then
      return jsonb_build_object('outcome', 'property_required');
    end if;
    if v_deal.customer_id is null then
      return jsonb_build_object('outcome', 'customer_required');
    end if;
    if not exists (
      select 1 from public.customers c
      where c.id = v_deal.customer_id and c.tenant_id = p_tenant_id and c.deleted_at is null
    ) then
      return jsonb_build_object('outcome', 'customer_not_found');
    end if;

    select p.* into v_property
    from public.properties p
    where p.id = v_deal.property_id and p.tenant_id = p_tenant_id and p.deleted_at is null
    for update;
    if not found then
      return jsonb_build_object('outcome', 'property_not_found');
    end if;
    if exists (
      select 1 from public.deals d
      where d.tenant_id = p_tenant_id and d.property_id = v_deal.property_id
        and d.id <> p_deal_id and d.closure_active = true
    ) then
      return jsonb_build_object('outcome', 'property_already_closed');
    end if;
    if (v_deal.deal_type = 'sale' and v_property.status = 'rented')
       or (v_deal.deal_type = 'rent' and v_property.status = 'sold') then
      return jsonb_build_object('outcome', 'property_unavailable');
    end if;
    if v_deal.deal_type = 'rent' and exists (
      select 1 from public.rentals r
      where r.tenant_id = p_tenant_id
        and r.property_id = v_deal.property_id
        and r.status = 'active'
    ) then
      return jsonb_build_object('outcome', 'property_active_rental');
    end if;

    v_value := coalesce(nullif(v_deal.deal_value, 0), nullif(v_property.list_price, 0));
    if v_value is null or v_value <= 0 then
      return jsonb_build_object('outcome', 'deal_value_required');
    end if;
    if v_property.commission_rate is null
       or v_property.commission_rate <= 0
       or v_property.commission_rate > 100
       or round(v_property.commission_rate, 2) <> v_property.commission_rate then
      return jsonb_build_object('outcome', 'commission_rate_required');
    end if;
    v_rate := v_property.commission_rate;
    v_net := round(v_value * (v_rate / 100), 2);
    v_vat := round(v_net * 0.20, 2);
    v_advisor := round(v_net * 0.50, 2);
    v_target_property_status := case when v_deal.deal_type = 'rent' then 'rented' else 'sold' end;

    update public.deals
    set stage = 'won', deal_value = v_value, loss_reason = null,
        closure_active = true,
        prev_property_status = case
          when v_property.status in ('sold', 'rented') then coalesce(v_deal.prev_property_status, 'live')
          else v_property.status
        end,
        probability = 100, updated_at = v_now
    where id = p_deal_id and tenant_id = p_tenant_id and stage = v_deal.stage;
    if not found then
      raise exception 'Deal state changed while closing.' using errcode = '40001';
    end if;

    insert into public.commissions (
      tenant_id, deal_id, gross_amount, vat_amount, status, splits
    ) values (
      p_tenant_id, p_deal_id, v_net, v_vat, 'calculated',
      jsonb_build_array(
        jsonb_build_object('label', 'Danışman', 'rate', 50, 'amount', v_advisor),
        jsonb_build_object('label', 'Ofis', 'rate', 50, 'amount', v_net - v_advisor)
      )
    )
    on conflict (deal_id) where deal_id is not null do nothing;
    if not found then
      raise exception 'Commission already exists for open deal.' using errcode = '23505';
    end if;

    update public.properties
    set status = v_target_property_status, updated_at = v_now
    where id = v_deal.property_id and tenant_id = p_tenant_id;
    if not found then
      raise exception 'Property disappeared while closing deal.' using errcode = '40001';
    end if;
  else
    update public.deals
    set stage = v_stage,
        loss_reason = case when v_stage = 'lost' then btrim(p_loss_reason) else null end,
        probability = case v_stage
          when 'lost' then 0 when 'negotiation' then 60
          when 'qualified' then 40 else 20 end,
        updated_at = v_now
    where id = p_deal_id and tenant_id = p_tenant_id and stage = v_deal.stage;
    if not found then
      raise exception 'Deal state changed while transitioning.' using errcode = '40001';
    end if;
  end if;

  insert into public.audit_logs (
    tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value
  ) values (
    p_tenant_id, p_actor_id, 'deal.stage', 'deal', p_deal_id,
    jsonb_build_object('stage', v_deal.stage),
    jsonb_build_object('stage', v_stage, 'loss_reason', nullif(btrim(coalesce(p_loss_reason, '')), ''))
  );
  return jsonb_build_object(
    'outcome', 'applied', 'previous_stage', v_deal.stage, 'current_stage', v_stage,
    'property_id', v_deal.property_id, 'customer_id', v_deal.customer_id,
    'deal_type', v_deal.deal_type, 'deal_value', coalesce(v_value, v_deal.deal_value)
  );
end;
$$;

revoke all on function public.transition_deal_stage_atomic(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.transition_deal_stage_atomic(uuid, uuid, uuid, text, text, text)
  to service_role;

