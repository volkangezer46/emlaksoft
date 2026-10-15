-- MIGRATION 20261016010000_finance_fx_inline.sql
-- SK1 / B045 (2026-10-16): finance_fx SQL fonksiyonu satır içine (inline) açılabilir hale gelir.
-- Geri alma: supabase/rollbacks/20261016010000_finance_fx_inline.rollback.sql
--
-- NEDEN: public.finance_fx(text, jsonb) LANGUAGE sql IMMUTABLE ama `SET search_path = ''` taşıyor. Postgres, SET (proconfig)
--   taşıyan SQL fonksiyonunu çağıran sorguya İNLINE ETMEZ: finance_overview / nakit akışı / KDV sorgularında her satır için
--   tam fonksiyon çağrısı (bağlam kurma + search_path değişimi) yapılır. Canlı ölçüm (2026-10-15, salt-okunur EXPLAIN
--   ANALYZE, 100 bin satır): fonksiyonla 440,5 ms; aynı ifade satır içinde 40,1 ms (~11x).
-- NE YAPAR: aynı gövde SET OLMADAN yeniden yazılır; search_path güvenliği nitelikli yazımla korunur: her işleç
--   `operator(pg_catalog.…)`, her tür `pg_catalog.numeric`, fonksiyon `pg_catalog.jsonb_typeof`. Çağıranın search_path'i ne
--   olursa olsun ifade pg_catalog nesnelerine çözülür (inline edilen ifade çağıranın bağlamında ayrıştırılır).
--   Sonuç birebir aynı (TRY/null → 1; geçerli pozitif kur → kur; aksi null). PARALLEL SAFE (saf ifade).
-- ETKİ: yalnız plan (inline). Davranış ve yetkiler (grant) aynı; create or replace mevcut grant'ları korur.
-- VERİ: değişiklik yok. IDEMPOTENT.

set local lock_timeout = '5s';

create or replace function public.finance_fx(p_currency text, p_rates jsonb)
returns numeric
language sql
immutable
parallel safe
as $$
  select case
    when p_currency is null or p_currency operator(pg_catalog.=) 'TRY' then 1::pg_catalog.numeric
    when p_rates is not null
     and pg_catalog.jsonb_typeof(p_rates operator(pg_catalog.->) p_currency) operator(pg_catalog.=) 'number'
     and (p_rates operator(pg_catalog.->>) p_currency)::pg_catalog.numeric operator(pg_catalog.>) 0::pg_catalog.numeric
      then (p_rates operator(pg_catalog.->>) p_currency)::pg_catalog.numeric
    else null
  end;
$$;

-- create or replace önceki SET'i zaten düşürür; eski sürümlerden kalan her yapılandırma açıkça temizlenir (inline şartı).
alter function public.finance_fx(text, jsonb) reset all;

comment on function public.finance_fx(text, jsonb) is
  'Para birimi -> TRY carpani (TRY/null=1, gecerli pozitif kur, aksi null). SET yok + nitelikli isleçler: cagiran sorguya inline edilir (SK1).';
