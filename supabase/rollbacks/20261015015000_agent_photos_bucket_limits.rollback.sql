-- 20261015015000 geri alma: agent-photos kovasinin sinirlari onceki haline (NULL = sinirsiz) doner. Nesneler degismez.
set local lock_timeout = '5s';

do $$
begin
  if pg_catalog.to_regclass('storage.buckets') is null then
    return;
  end if;
  update storage.buckets
     set file_size_limit = null,
         allowed_mime_types = null
   where id = 'agent-photos';
end $$;
