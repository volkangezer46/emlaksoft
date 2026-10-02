export const CORE_WORKFLOW_SCAFFOLD_MIGRATION = "20260812000000_core_workflow_scaffold.sql";
export const CORE_WORKFLOW_INVARIANT_MIGRATION = "20260813000000_core_workflow_invariants.sql";

/** Aggregate-only, read-only preflight. It never returns tenant/entity IDs or PII. */
export const CORE_WORKFLOW_PREFLIGHT_SQL = `
with
won as (
  select d.*, p.status as property_status, p.commission_rate
  from public.deals d
  left join public.properties p on p.id = d.property_id and p.tenant_id = d.tenant_id
  where d.stage = 'won'
),
active_rental as (
  select r.*, p.status as property_status
  from public.rentals r
  left join public.properties p on p.id = r.property_id and p.tenant_id = r.tenant_id
  where r.status = 'active'
),
latest_round as (
  select distinct on (r.offer_id) r.offer_id, r.side, r.amount
  from public.offer_rounds r
  order by r.offer_id, r.round_no desc
)
select
  (select count(*) from won w where w.property_id is not null and (
    w.property_status is null
    or w.property_status <> case when w.deal_type = 'rent' then 'rented' else 'sold' end
  ))::bigint as won_property_status_mismatch,
  (select count(*) from won w where not exists (
    select 1 from public.commissions c where c.tenant_id = w.tenant_id and c.deal_id = w.id
  ))::bigint as won_missing_commission,
  (select count(*) from (
    select w.tenant_id, w.property_id from won w
    where w.property_id is not null
      and w.property_status = case when w.deal_type = 'rent' then 'rented' else 'sold' end
    group by w.tenant_id, w.property_id having count(*) > 1
  ) duplicates)::bigint as duplicate_projected_closure_groups,
  (select count(*) from won w where w.deal_value is null or w.deal_value <= 0
    or (w.property_id is not null and (
      w.commission_rate is null or w.commission_rate <= 0 or w.commission_rate > 100
      or round(w.commission_rate, 2) <> w.commission_rate
    )))::bigint as won_invalid_financials,
  (select count(*) from won w where w.property_id is null and w.project_unit_id is null
  )::bigint as won_missing_asset,
  (select count(*) from active_rental r where r.property_status is distinct from 'rented'
  )::bigint as active_rental_property_mismatch,
  (select count(*) from active_rental r where r.prev_property_status is null
    or r.prev_property_status in ('sold', 'rented')
  )::bigint as active_rental_prev_status_missing,
  (select count(*) from (
    select r.tenant_id, r.property_id from active_rental r
    group by r.tenant_id, r.property_id having count(*) > 1
  ) duplicates)::bigint as duplicate_active_rental_groups,
  (select count(*) from active_rental r where r.deal_id is null or not exists (
    select 1 from public.deals d where d.id = r.deal_id and d.tenant_id = r.tenant_id
      and d.stage = 'won' and d.deal_type = 'rent' and d.property_id = r.property_id
      and d.customer_id = r.renter_customer_id
  ))::bigint as active_rental_deal_mismatch,
  (select count(*) from active_rental r where r.deal_id is null or not exists (
    select 1 from public.commissions c where c.tenant_id = r.tenant_id and c.deal_id = r.deal_id
  ))::bigint as active_rental_missing_commission,
  (select count(*) from public.project_units u where u.status = 'sold' and (
    u.customer_id is null or u.sold_at is null or u.list_price is null or u.list_price <= 0
    or round(u.list_price, 2) <> u.list_price
    or 1 <> (select count(*) from public.deals d where d.tenant_id = u.tenant_id
      and d.project_unit_id = u.id and d.stage = 'won' and d.deal_type = 'sale'
      and d.customer_id = u.customer_id and d.deal_value = u.list_price)
  ))::bigint as sold_unit_deal_mismatch,
  (select count(*) from public.project_units u where u.status = 'sold' and not exists (
    select 1 from public.deals d join public.commissions c
      on c.tenant_id = d.tenant_id and c.deal_id = d.id
    where d.tenant_id = u.tenant_id and d.project_unit_id = u.id
      and d.stage = 'won' and d.deal_type = 'sale'
      and d.customer_id = u.customer_id and d.deal_value = u.list_price
  ))::bigint as sold_unit_missing_commission,
  (select count(*) from public.deals d
    left join public.project_units u
      on u.id = d.project_unit_id and u.tenant_id = d.tenant_id
    where d.stage = 'won' and d.project_unit_id is not null and (
      u.id is null or u.status <> 'sold' or d.deal_type <> 'sale'
      or u.customer_id is null or d.customer_id is distinct from u.customer_id
      or u.list_price is null or u.list_price <= 0
      or round(u.list_price, 2) <> u.list_price
      or d.deal_value is distinct from u.list_price
    ))::bigint as project_unit_deal_mismatch,
  (select count(*) from public.offers o where o.status in ('submitted', 'accepted')
    and not exists (select 1 from public.offer_rounds r where r.offer_id = o.id)
  )::bigint as offer_missing_initial_history,
  (select count(*) from public.offers o where o.status = 'countered'
    and not exists (select 1 from public.offer_rounds r where r.offer_id = o.id)
  )::bigint as countered_offer_missing_history,
  (select count(*) from public.offers o join latest_round r on r.offer_id = o.id where
    (o.status = 'submitted' and (
      r.side <> 'buyer' or r.amount is distinct from o.amount or o.counter_amount is not null
    )) or (o.status = 'countered' and (
      r.side <> 'seller' or r.amount is distinct from o.counter_amount
    )) or (o.status = 'accepted' and r.amount is distinct from o.amount)
  )::bigint as offer_round_projection_mismatch,
  (select count(*) from public.offers o where o.status in ('submitted', 'countered', 'accepted')
    and (
      o.amount < 0.01 or o.amount > 100000000000 or round(o.amount, 2) <> o.amount
      or (o.status = 'countered' and (
        o.counter_amount is null or o.counter_amount < 0.01
        or o.counter_amount > 100000000000
        or round(o.counter_amount, 2) <> o.counter_amount
      ))
      or exists (
        select 1 from latest_round r where r.offer_id = o.id
          and (r.amount < 0.01 or r.amount > 100000000000 or round(r.amount, 2) <> r.amount)
      )
    )
  )::bigint as open_offer_invalid_financials,
  (select count(*) from active_rental r where not exists (
    select 1 from public.customers c where c.id = r.renter_customer_id
      and c.tenant_id = r.tenant_id
      and coalesce(c.customer_types, '{}'::text[]) @> array['Kiracı']::text[]
  ))::bigint as active_renter_missing_tag,
  (select count(*) from public.commissions c join public.deals d
    on d.id = c.deal_id and d.tenant_id = c.tenant_id where d.stage <> 'won'
  )::bigint as non_won_commission;
`;

export type CoreWorkflowPreflightRow = Record<string, string | number | bigint | null>;

export const CORE_WORKFLOW_BLOCKER_KEYS = [
  "won_property_status_mismatch",
  "won_missing_commission",
  "duplicate_projected_closure_groups",
  "won_invalid_financials",
  "won_missing_asset",
  "active_rental_property_mismatch",
  "active_rental_prev_status_missing",
  "duplicate_active_rental_groups",
  "active_rental_deal_mismatch",
  "active_rental_missing_commission",
  "sold_unit_deal_mismatch",
  "sold_unit_missing_commission",
  "project_unit_deal_mismatch",
  "countered_offer_missing_history",
  "offer_round_projection_mismatch",
  "open_offer_invalid_financials",
  "non_won_commission",
] as const;

export const CORE_WORKFLOW_REPAIRABLE_KEYS = [
  "offer_missing_initial_history",
  "active_renter_missing_tag",
] as const;

export function preflightCount(row: CoreWorkflowPreflightRow, key: string): number {
  const count = Number(row[key] ?? 0);
  return Number.isSafeInteger(count) && count >= 0 ? count : Number.POSITIVE_INFINITY;
}

export function coreWorkflowBlockerTotal(row: CoreWorkflowPreflightRow): number {
  return CORE_WORKFLOW_BLOCKER_KEYS.reduce((sum, key) => sum + preflightCount(row, key), 0);
}

export function formatCoreWorkflowCounts(row: CoreWorkflowPreflightRow): string {
  return Object.entries(row).map(([key]) => `${key}=${preflightCount(row, key)}`).join(", ");
}
