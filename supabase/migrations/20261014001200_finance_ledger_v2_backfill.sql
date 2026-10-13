-- UYGULANMADI (canlıya henüz uygulanmadı; sahibin onayı + yedek doğrulaması sonrası `npm run db:migrate`).
--
-- Finans v2 (FN1) — 3/3 VERİ TAŞIMA + İZİN. 20261014001000 ve 20261014001100 SONRASI. İdempotent (tekrar çalışması zararsız).
--   1) Cari: hareketlerdeki benzersiz karşı taraf metinleri (büyük/küçük harf duyarsız, kırpılmış) finance_parties satırına dönüşür
--      ve hareketin party_id'si atanır. Tür tahmini: kira kaynaklı → 'kiraci'; komisyon kaynaklı → 'musteri';
--      yalnız çıkış → 'tedarikci'; diğerleri → 'diger'. Hareketin tutarı/tarihi/hesabı DEĞİŞMEZ (bakiye birebir aynı kalır);
--      party_id parasal alan olmadığından dönem kilidi tetiği etkilenmez. Sahte KDV YAZILMAZ (vat_* boş = bilinmiyor).
--   2) Bütçe: expense_budgets satırları finance_budgets'a 'out' yönünde kopyalanır. Eski bütçe her ay geçerli olduğundan
--      period_month = 2000-01-01 (bütçe aydan itibaren taşınır: finance_budget_vs_actual). Eski tablo SİLİNMEZ.
--   3) İzin: muhasebe (accounting) rolüne `expenses` için create + edit (DELETE YOK); src/lib/permissions.ts ile aynı.
--      Ofis/kullanıcı istisnalarına dokunulmaz (on conflict do nothing).
--   Eski giderler TAŞINMAZ: deftere bağlı olmayanlar finance_ledger_v'de 'legacy_expense' (Hesapsız) olarak görünür;
--   kullanıcı isterse finance_adopt_legacy_expenses ile bir hesaba taşır.
--
-- SALT-OKUNUR DOĞRULAMA (uygulamadan önce ve sonra aynı olmalı):
--   select count(*) from public.cash_entries;                                         -- değişmez
--   select account_id, balance from public.finance_account_balances();                -- (oturumlu) değişmez
--   select count(*) from public.cash_entries where nullif(btrim(counterparty), '') is not null and party_id is null;  -- sonra 0
--   select count(*) from public.finance_ledger_v;                                     -- hareket + bağlanmamış eski gider
-- GERİ ALMA: supabase/rollbacks/20261014001200_finance_ledger_v2_backfill.rollback.sql (party_id boşaltılır, taşınan cari/bütçe
--   satırları ve izin satırları geri alınır).
-- RİSK: düşük (yalnız yeni kolon/tablo doldurulur; mevcut parasal veri değişmez).

set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('public.finance_parties') is null
     or pg_catalog.to_regclass('public.finance_budgets') is null
     or pg_catalog.to_regclass('public.permission_defaults') is null
     or not exists (select 1 from pg_catalog.pg_attribute where attrelid = 'public.cash_entries'::regclass and attname = 'party_id' and not attisdropped) then
    raise exception '20261014001200: önce 20261014001000 (finans v2 şema) uygulanmalı; permission_defaults gerekli.';
  end if;
end $$;

-- 1) Karşı taraf metinlerinden cari
with src as (
  select e.tenant_id,
         pg_catalog.btrim(e.counterparty) as nm,
         pg_catalog.lower(pg_catalog.btrim(e.counterparty)) as lk,
         bool_or(e.source_type = 'rent') as any_rent,
         bool_or(e.source_type = 'commission') as any_commission,
         bool_and(e.direction = 'out') as all_out,
         bool_and(e.is_sample) as all_sample,
         min(e.created_at) as first_at
    from public.cash_entries e
   where nullif(pg_catalog.btrim(coalesce(e.counterparty, '')), '') is not null
   group by e.tenant_id, pg_catalog.btrim(e.counterparty), pg_catalog.lower(pg_catalog.btrim(e.counterparty))
),
-- Aynı ad farklı yazımla (büyük/küçük harf) geçiyorsa ilk görüleni ad olarak alınır.
one_per_name as (
  select distinct on (s.tenant_id, s.lk) s.tenant_id, s.lk, s.nm,
         bool_or(s.any_rent) over w as any_rent,
         bool_or(s.any_commission) over w as any_commission,
         bool_and(s.all_out) over w as all_out,
         bool_and(s.all_sample) over w as all_sample
    from src s
  window w as (partition by s.tenant_id, s.lk)
   order by s.tenant_id, s.lk, s.first_at
)
insert into public.finance_parties (tenant_id, kind, name, is_sample)
select o.tenant_id,
       case when o.any_rent then 'kiraci'
            when o.any_commission then 'musteri'
            when o.all_out then 'tedarikci'
            else 'diger' end,
       pg_catalog.left(o.nm, 120),
       o.all_sample
  from one_per_name o
 where not exists (
   select 1 from public.finance_parties p
    where p.tenant_id = o.tenant_id and pg_catalog.lower(p.name) = o.lk and p.archived_at is null
 )
on conflict do nothing;

update public.cash_entries e
   set party_id = (
     select p.id from public.finance_parties p
      where p.tenant_id = e.tenant_id and pg_catalog.lower(p.name) = pg_catalog.lower(pg_catalog.btrim(e.counterparty))
        and p.archived_at is null
      order by p.created_at, p.id
      limit 1)
 where e.party_id is null
   and nullif(pg_catalog.btrim(coalesce(e.counterparty, '')), '') is not null;

-- 2) Eski gider bütçesi → finance_budgets (her ay geçerli: 2000-01-01'den itibaren)
insert into public.finance_budgets (tenant_id, period_month, direction, category, amount, created_by, is_sample)
select b.tenant_id, date '2000-01-01', 'out', b.category, b.monthly_amount, b.created_by, b.is_sample
  from public.expense_budgets b
on conflict (tenant_id, period_month, direction, category) do nothing;

-- 3) Muhasebe rolü: gelir/gider ekleme ve düzenleme (silme yok)
insert into public.permission_defaults (role, module, action)
values ('accounting', 'expenses', 'create'), ('accounting', 'expenses', 'edit')
on conflict do nothing;
