-- Sayaç (sequence) kayması denetimi: public, auth ve storage şemalarında bir sütuna bağlı
-- (OWNED BY / identity) her sayaç için sıradaki nextval() değeri sütun azamisine eşit ya da
-- küçükse satır NOTICE ile raporlanır (2026-10-13 olayı: auth.refresh_tokens_pkey çakışması → giriş 500).
--
-- Varsayılan SALT-OKUNUR rapordur. Düzeltme isteğe bağlıdır:
--   psql ... -f scripts/sunucu/check-sequences.sql              # yalnız rapor
--   psql ... -v fix=1 -f scripts/sunucu/check-sequences.sql     # rapor + setval(azami)
-- İdempotenttir: düzeltilmiş bir veritabanında ikinci çalıştırma hiçbir şey bulmaz/değiştirmez.
-- Yetki: tüm şemalardaki tabloları okuyabilen rol (supabase_admin / postgres).
\if :{?fix}
\else
\set fix 0
\endif
select set_config('emlaksoft.check_sequences_fix', :'fix', false) as fix_modu;

do $$
declare
  r record;
  mx bigint;
  lv bigint;
  called boolean;
  fix boolean := current_setting('emlaksoft.check_sequences_fix', true) = '1';
  bulunan int := 0;
begin
  for r in
    select n.nspname as sch, s.relname as seq, tn.nspname as tsch, t.relname as tbl, a.attname as col
    from pg_class s
    join pg_namespace n on n.oid = s.relnamespace
    join pg_sequence ps on ps.seqrelid = s.oid
    join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass and d.deptype in ('a', 'i')
    join pg_class t on t.oid = d.refobjid
    join pg_namespace tn on tn.oid = t.relnamespace
    join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
    where s.relkind = 'S'
      and n.nspname in ('public', 'auth', 'storage')
      and ps.seqincrement > 0
    order by 1, 2
  loop
    execute format('select max(%I)::bigint from %I.%I', r.col, r.tsch, r.tbl) into mx;
    continue when mx is null;
    execute format('select last_value, is_called from %I.%I', r.sch, r.seq) into lv, called;
    -- is_called=false ise sıradaki değer last_value'nun kendisidir.
    if (case when called then lv else lv - 1 end) < mx then
      bulunan := bulunan + 1;
      if fix then
        perform setval(format('%I.%I', r.sch, r.seq), mx, true);
        raise notice 'DÜZELTİLDİ %.% (%.%.%): last_value % → %', r.sch, r.seq, r.tsch, r.tbl, r.col, lv, mx;
      else
        raise notice 'KAYMA %.% (%.%.%): last_value % < max %', r.sch, r.seq, r.tsch, r.tbl, r.col, lv, mx;
      end if;
    end if;
  end loop;
  if bulunan = 0 then
    raise notice 'Sayaç kayması yok (public/auth/storage).';
  elsif not fix then
    raise notice '% sayaç kaymış — düzeltmek için: -v fix=1', bulunan;
  end if;
end $$;
