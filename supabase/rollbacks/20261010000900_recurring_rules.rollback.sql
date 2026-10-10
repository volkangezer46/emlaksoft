-- Rollback: 20261010000900_recurring_rules
-- Düzenli ödeme kuralları ve onay bekleyen taslaklar KAYBOLUR. Üretilmiş cash_entries hareketleri ve expenses kayıtları ETKİLENMEZ
-- ("Kurala çevir" ile hatırlatmadan çıkarılmış gider serileri otomatik geri gelmez; gerekirse expenses.recurrence elle doldurulur).

set local lock_timeout = '5s';

drop function if exists public.recurring_run_due(date, uuid[]);
drop function if exists public.recurring_occurrence_skip(uuid);
drop function if exists public.recurring_occurrence_approve(uuid, numeric);
drop function if exists public.recurring_rule_from_expense(uuid, uuid, integer, text);
drop function if exists public.recurring_rule_delete(uuid);
drop function if exists public.recurring_rule_set_active(uuid, boolean);
drop function if exists public.recurring_rule_update(uuid, text, numeric, uuid, integer, date, text);
drop function if exists public.recurring_rule_create(text, text, text, text, numeric, uuid, text, integer, date, date, text, text, text, boolean);
drop function if exists public.recurring_insert_rule(uuid, uuid, text, text, text, text, numeric, uuid, text, integer, date, date, date, text, text, text, boolean, uuid);
drop function if exists public.recurring_advance(uuid, date);
drop function if exists public.recurring_post_occurrence(uuid, numeric, uuid);
drop function if exists public.recurring_money_text(numeric);
drop function if exists public.recurring_notify(uuid, text, text, text, text);

drop table if exists public.recurring_occurrences;
drop table if exists public.recurring_rules;

drop function if exists public.recurring_rule_access(uuid, text);
drop function if exists public.recurring_period_on_or_after(date, integer, text, date);
drop function if exists public.recurring_freq_months(text);
drop function if exists public.recurring_due_date(date, integer);

notify pgrst, 'reload schema';
