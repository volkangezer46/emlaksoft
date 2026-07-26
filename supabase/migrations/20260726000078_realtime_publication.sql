-- Realtime publication — kod tarafı 6 tabloyu dinliyor (use-realtime-refresh +
-- bildirim zili + destek konuşması) ama publication BOŞTU: canlı yenileme
-- sessizce hiç çalışmıyordu. Idempotent ekleme (deploy'da tekrar koşabilir).
do $$
declare
  t text;
begin
  foreach t in array array[
    'notifications',
    'deals',
    'commissions',
    'portal_listings',
    'customers',
    'support_ticket_messages'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
