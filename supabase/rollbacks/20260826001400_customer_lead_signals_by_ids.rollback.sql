-- Rollback: 20260826001400_customer_lead_signals_by_ids. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Yalniz yeni asiri yukleme kalkar; eski customer_lead_signals(uuid) etkilenmez, istemci eskiye duser.
drop function if exists public.customer_lead_signals(uuid, uuid[]);
