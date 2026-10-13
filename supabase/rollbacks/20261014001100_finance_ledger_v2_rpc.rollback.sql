-- Rollback: 20261014001100_finance_ledger_v2_rpc
-- Finans v2 RPC'lerini düşürür. Eski finance_* RPC'leri (imza ve gövde) bu dosyada hiç değişmediği için etkilenmez.
-- 20261014001200 (veri taşıma) bu fonksiyonları kullanmaz; tablolar ve veri 20261014001000 rollback'ine kadar kalır.

set local lock_timeout = '5s';

drop function if exists public.finance_record_entry_v2(jsonb);
drop function if exists public.finance_update_entry_v2(uuid, jsonb);
drop function if exists public.finance_adopt_legacy_expenses(uuid, uuid[]);
drop function if exists public.finance_party_upsert(jsonb);
drop function if exists public.finance_party_set_archived(uuid, boolean);
drop function if exists public.finance_party_balances(text, text);
drop function if exists public.finance_party_statement(uuid, date, date);
drop function if exists public.finance_open_item_create(jsonb);
drop function if exists public.finance_open_item_cancel(uuid, text);
drop function if exists public.finance_open_item_settle(uuid, uuid, numeric, date, text);
drop function if exists public.finance_aging(text);
drop function if exists public.finance_overview(date, date, jsonb);
drop function if exists public.finance_cashflow_forecast(integer, jsonb);
drop function if exists public.finance_pnl(date, date);
drop function if exists public.finance_vat_summary(date, date);
drop function if exists public.finance_category_upsert(jsonb);
drop function if exists public.finance_category_archive(uuid);
drop function if exists public.finance_rule_upsert(jsonb);
drop function if exists public.finance_rule_delete(uuid);
drop function if exists public.finance_rule_suggest(text, numeric, text, text);
drop function if exists public.finance_period_lock(date, text);
drop function if exists public.finance_period_unlock(date);
drop function if exists public.finance_budget_set(date, text, text, numeric);
drop function if exists public.finance_budget_vs_actual(date);
drop function if exists public.finance_attachment_register(text, text, text, bigint, uuid, uuid);
drop function if exists public.finance_attachment_link(uuid, uuid, uuid);
drop function if exists public.finance_attachment_set_ocr(uuid, text, jsonb);
drop function if exists public.finance_settings_save(jsonb);
drop function if exists public.finance_v2_cash_total(jsonb);
drop function if exists public.finance_v2_check_category(uuid, text, text);
drop function if exists public.finance_v2_resolve_party(uuid, uuid, text, text);
drop function if exists public.finance_v2_ctx(text);
drop function if exists public.finance_v2_raise(text);
drop function if exists public.finance_entry_amounts(numeric, numeric, boolean, numeric);
drop function if exists public.finance_vat_split(numeric, numeric, boolean);
drop function if exists public.finance_fx(text, jsonb);

notify pgrst, 'reload schema';
