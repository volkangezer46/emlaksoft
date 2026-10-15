-- 20261020010001 geri alma: customer_relations duser (iliskiler silinir; musteriler kalir). KVKK temizlik tetikleyicisi
--   20261020010000 govdesine (yalniz ek iletisim bilgisi) doner. ONKOSUL: 20261020010004 once geri alinir.
set local lock_timeout = '5s';

drop table if exists public.customer_relations;

create or replace function public.kvkk_erasure_purge_customer_extras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.customer_contacts
   where customer_id = new.customer_id and tenant_id = new.tenant_id;
  return null;
end;
$$;

revoke all on function public.kvkk_erasure_purge_customer_extras() from public, anon, authenticated;
