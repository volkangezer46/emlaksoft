-- Rollback: 20260816000600_customer_demand_structured_columns
-- ÖNCE 20260816000700 (create_customer_with_demand bu sütunları yazar) geri alınmalı.
alter table public.customer_demands drop constraint if exists customer_demands_floor_range;
alter table public.customer_demands
  drop column if exists currency,
  drop column if exists budget_includes_loan,
  drop column if exists swap_ok,
  drop column if exists max_sqm,
  drop column if exists floor_min,
  drop column if exists floor_max,
  drop column if exists max_building_age,
  drop column if exists required_keys;
