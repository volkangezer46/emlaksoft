-- Açık ev ziyaretçi sayacı RPC (kod çağırıyordu ama fonksiyon tanımlı değildi → sayaç hep 0)
create or replace function public.increment_visitor_count(open_house_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.open_houses
  set visitor_count = coalesce(visitor_count, 0) + 1
  where id = open_house_id;
$$;

grant execute on function public.increment_visitor_count(uuid) to authenticated, service_role;
