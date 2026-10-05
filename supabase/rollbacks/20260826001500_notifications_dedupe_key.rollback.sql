-- Rollback: 20260826001500_notifications_dedupe_key. Elle calistirilir; schema_migrations ledger satirina DOKUNMAZ.
-- Yalniz dedupe anahtarlari kaybolur (bildirimlerin kendisi korunur); kod kolon yoksa eski davranisa duser.
drop index if exists public.notifications_tenant_dedupe_key_uidx;
alter table public.notifications drop column if exists dedupe_key;
