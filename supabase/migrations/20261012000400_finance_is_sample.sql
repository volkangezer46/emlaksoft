-- Finans tablolarına örnek veri işareti (is_sample) — "Gerçek kullanıma geç" temizliği bunları da silebilsin.
--
-- BULGU (Konsey ertelenen #14+#15): demo/örnek veri kasa-banka hesaplarını, kasa hareketlerini, düzenli ödeme kurallarını ve gider
--   bütçesini YAZIYORDU ya da örnek modda hiç yazmıyordu; çünkü bu tablolarda is_sample yoktu. Sonuç: demo ofis finans ekranları boş
--   ya da gerçek kayıtla karışık kalıyor, temizlik bu satırları süremiyordu.
-- ÇÖZÜM: finance_accounts, cash_entries, recurring_rules ve expense_budgets tablolarına `is_sample boolean not null default false`.
--   Mevcut satırlar false kalır (davranış değişmez). Temizlik (TS: purgeSampleModuleData) yalnız is_sample = true satırları siler:
--   hesap silinince hareketler, kurallar, oluşumlar ve ekstre kayıtları ON DELETE CASCADE ile gider.
-- Fonksiyon/RLS/izin DEĞİŞMEZ; purge_tenant_sample_data RPC'sine dokunulmaz.
-- GERİ ALMA: supabase/rollbacks/20261012000400_finance_is_sample.rollback.sql (işaret kolonları düşer; satırlar KALIR).
-- BAĞIMLILIK: 20261008000700 (expense_budgets), 20261010000600 (finance_accounts, cash_entries), 20261010000900 (recurring_rules).
-- RİSK: düşük (sabit varsayılanlı kolon ekleme; tablolar küçük).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.finance_accounts') is null
     or pg_catalog.to_regclass('public.cash_entries') is null
     or pg_catalog.to_regclass('public.recurring_rules') is null
     or pg_catalog.to_regclass('public.expense_budgets') is null then
    raise exception 'finans tabloları yok (20261008000700, 20261010000600 ve 20261010000900 önce uygulanmalı)';
  end if;
end $$;

alter table public.finance_accounts add column if not exists is_sample boolean not null default false;
alter table public.cash_entries     add column if not exists is_sample boolean not null default false;
alter table public.recurring_rules  add column if not exists is_sample boolean not null default false;
alter table public.expense_budgets  add column if not exists is_sample boolean not null default false;

comment on column public.finance_accounts.is_sample is 'Örnek (demo) hesap: Gerçek kullanıma geç temizliğinde silinir.';
comment on column public.cash_entries.is_sample is 'Örnek (demo) hareket: Gerçek kullanıma geç temizliğinde silinir.';
comment on column public.recurring_rules.is_sample is 'Örnek (demo) düzenli ödeme: Gerçek kullanıma geç temizliğinde silinir.';
comment on column public.expense_budgets.is_sample is 'Örnek (demo) bütçe: Gerçek kullanıma geç temizliğinde silinir.';
