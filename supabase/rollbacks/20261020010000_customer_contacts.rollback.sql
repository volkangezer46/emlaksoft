-- 20261020010000 geri alma: customer_contacts (ek telefon/e-posta) ve arama sutunu customers.contacts_fold duser,
--   lookup_customer_by_phone 20261016070000 govdesine doner. ONKOSUL: 20261020010004 ve 20261020010001 once geri alinir.
-- VERI: ek numaralar ve e-postalar SILINIR (birincil telefon/e-posta customers satirinda kalir). Kod arama sutunu
--   yokken musteri aramasi hata verir: bu geri alma KOD GERI ALINDIKTAN sonra uygulanir.
set local lock_timeout = '5s';

drop trigger if exists trg_kvkk_erasure_purge_customer_extras on public.kvkk_erasure_log;
drop function if exists public.kvkk_erasure_purge_customer_extras();
drop function if exists public.customer_contact_make_primary(uuid);
drop table if exists public.customer_contacts;
drop function if exists public.customer_contacts_sync_fold();
drop function if exists public.customer_contacts_fold_of(uuid);
drop index if exists public.idx_customers_contacts_fold_trgm;
alter table public.customers drop column if exists contacts_fold;

-- lookup_customer_by_phone: 20261016070000 govdesi (yalniz birincil telefon)
create or replace function public.lookup_customer_by_phone(p_phone text, p_exclude uuid[] default '{}'::uuid[])
returns table (full_name text, phone_masked text, advisor_name text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_digits text;
begin
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null or not public.has_effective_permission('customers', 'view') then
    return;
  end if;

  -- Saklama biçimine indir: TR '05XXXXXXXXX' (rakamlar '05…'), yabancı '+<E.164>' (rakamlar ülke koduyla).
  v_digits := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  if length(v_digits) = 14 and left(v_digits, 4) = '0090' then
    v_digits := '0' || substr(v_digits, 5);
  elsif length(v_digits) = 12 and left(v_digits, 2) = '90' then
    v_digits := '0' || substr(v_digits, 3);
  elsif length(v_digits) = 10 and left(v_digits, 1) <> '0' then
    v_digits := '0' || v_digits;
  end if;
  if length(v_digits) < 7 then
    return;
  end if;

  return query
    select
      c.full_name,
      case
        when length(c.phone) >= 7 then left(c.phone, 4) || ' *** ** ' || right(c.phone, 2)
        else '***'
      end,
      p.full_name
    from public.customers c
    left join public.profiles p on p.id = c.assigned_to and p.tenant_id = c.tenant_id
    where c.tenant_id = v_tenant
      and c.deleted_at is null
      and c.phone_digits = v_digits
      and not (c.id = any(coalesce(p_exclude, '{}'::uuid[])))
    order by c.created_at desc
    limit 5;
end;
$$;

comment on function public.lookup_customer_by_phone(text, uuid[]) is
  'SK7/B059: kapsam dışı tam telefon eşleşmesi — yalnız ad, maskeli telefon, danışman adı. Kiracı + customers:view şartlı.';

revoke all on function public.lookup_customer_by_phone(text, uuid[]) from public, anon;
grant execute on function public.lookup_customer_by_phone(text, uuid[]) to authenticated;
grant execute on function public.lookup_customer_by_phone(text, uuid[]) to service_role;
