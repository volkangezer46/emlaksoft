-- 20261015017000 geri alma: migration'in supabase_realtime yayinindan cikardigi tablolar, yayinin yorumuna yazilan
--   `kq2_trimmed:<schema.tablo,...>` izinden geri eklenir; iz yoksa (canlida hicbir tablo cikarilmadi) hicbir sey yapilmaz.
--   Tablo artik yoksa ya da zaten yayindaysa atlanir. Sonda iz temizlenir. Veri degismez.
set local lock_timeout = '5s';

do $$
declare
  v_comment text;
  v_item text;
begin
  select pg_catalog.obj_description(p.oid, 'pg_publication') into v_comment
  from pg_catalog.pg_publication p where p.pubname = 'supabase_realtime';
  if v_comment is null or v_comment not like 'kq2_trimmed:%' then
    raise notice 'KQ2 geri alma: supabase_realtime izi yok, yapilacak is yok';
    return;
  end if;
  foreach v_item in array string_to_array(substr(v_comment, length('kq2_trimmed:') + 1), ',') loop
    if pg_catalog.to_regclass(v_item) is null then
      raise notice 'KQ2 geri alma: % yok, atlandi', v_item;
      continue;
    end if;
    if exists (
      select 1 from pg_catalog.pg_publication_tables pt
      where pt.pubname = 'supabase_realtime' and pt.schemaname || '.' || pt.tablename = v_item
    ) then
      continue;
    end if;
    execute format('alter publication supabase_realtime add table %s', pg_catalog.to_regclass(v_item));
  end loop;
  execute 'comment on publication supabase_realtime is null';
end $$;
