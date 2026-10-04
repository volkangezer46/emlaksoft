-- Rollback: 20260816001700_tenant_modules
-- Tüm ofislerin modül tercihleri ve platform kilitleri KALICI silinir; tüm modüller AÇIK döner (kod tablo yokken açık sayar).
-- Kayıtlı iş verisine dokunulmaz.
drop table if exists public.tenant_modules;
