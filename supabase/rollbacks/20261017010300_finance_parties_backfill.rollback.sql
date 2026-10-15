-- Geri alma: 20261017010300_finance_parties_backfill.sql
-- ONCE 20261017010400 geri alinir (sira: 010400 -> 010300 -> 010200). Yalniz geri doldurma fonksiyonu duser.
-- VERI: acilan cariler, tahakkuk kalemleri ve eski yol hareketlerinin open_item_id bagi YERINDE KALIR (silme yok; nakit
-- yazilmadigindan kasa bakiyesi degismez). 20261017010200 yerindeyse tetikleyiciler kalemleri esitlemeye devam eder.
set local lock_timeout = '5s';

drop function if exists public.finance_accrual_backfill();
