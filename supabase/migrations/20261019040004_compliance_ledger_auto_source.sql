-- MIGRATION 20261019040004_compliance_ledger_auto_source.sql
-- UYGULANMADI: yalniz restore edilebilir yedek dogrulandiktan sonra SAHIBI uygular (`npm run db:migrate`).
-- KOD YAYININDAN ONCE ya da SONRA uygulanabilir: sutun yokken "Kapanistan deftere isle" eylemi "etkin degil" der,
--   defter listesi "Otomatik" rozetini gostermez; elle kayit akisi degismez.
-- Geri alma: supabase/rollbacks/20261019040004_compliance_ledger_auto_source.rollback.sql
-- BAGIMLILIK: public.compliance_ledger_entries (20260821000200).
--
-- NE (SP7): yasal kayit defterine kapanmis anlasmadan taslak satir.
--   source: 'manual' (elle form) | 'auto' (kapanmis anlasmadan, danisman kimlik ve odeme yontemini onaylayarak).
--   Ayni anlasma + taraf rolu + islem turu icin TEK otomatik satir (kismi benzersiz indeks): cift tik / tekrar deneme
--   ikinci satir uretmez. Defter degismezligi korunur (UPDATE/DELETE tetigi aynen); duzeltme yine yeni kayittir.
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.compliance_ledger_entries') is null then
    raise exception 'compliance_ledger_entries yok; once 20260821000200 uygulanmali.';
  end if;
end $$;

alter table public.compliance_ledger_entries add column if not exists source text not null default 'manual';

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conname = 'compliance_ledger_entries_source_check') then
    alter table public.compliance_ledger_entries add constraint compliance_ledger_entries_source_check
      check (source in ('manual', 'auto'));
  end if;
end $$;

create unique index if not exists idx_compliance_ledger_auto_deal_party
  on public.compliance_ledger_entries (tenant_id, deal_id, party_role, transaction_type)
  where source = 'auto' and kind = 'entry' and deal_id is not null;

create index if not exists idx_compliance_ledger_deal
  on public.compliance_ledger_entries (tenant_id, deal_id)
  where deal_id is not null;

comment on column public.compliance_ledger_entries.source is 'SP7: manual (elle form) | auto (kapanmis anlasmadan, danisman onayli)';
