-- 20261015041000 geri alma: demo gece sifirlama fonksiyonu ve taban tablosu kaldirilir.
-- Silinmis demo satirlari geri gelmez (yalniz 'demo-ofis' kiracisi; gerekirse `npm run seed:demo` ya da PITR).
-- Kod fonksiyon yokken adimi 'skipped' olarak gecer (src/lib/demo-reset.ts).
drop function if exists public.demo_tenant_nightly_reset(uuid, timestamptz);
drop table if exists public.demo_reset_state;
