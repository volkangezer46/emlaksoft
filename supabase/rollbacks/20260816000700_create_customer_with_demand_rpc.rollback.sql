-- Rollback: 20260816000700_create_customer_with_demand_rpc
-- Önce kodu eski iki adımlı akışa (createCustomer + createDemand) döndürün.
drop function if exists public.create_customer_with_demand(
  uuid, text, text, text, text[], uuid, uuid, uuid, text, uuid, text, jsonb
);
