-- Geri alma: 20261016020000_tenant_broadcast_changes.sql
-- Deyim duzeyindeki Broadcast tetikleyicileri, bildirim tetikleyicisi, iki fonksiyon ve realtime.messages okuma
-- politikalari kaldirilir. Veri degismez. ONEMLI: 20261016020100 (yayin kirpma) uygulandiysa ONCE onun geri almasi
-- calistirilir (sayfa tablolari supabase_realtime yayinina geri doner); aksi halde eski istemci postgres_changes ile
-- olay alamaz. Politika adimi realtime.messages sahibi olmayan rolde atlanir (supabase_admin ile tekrar calistirin).
set local lock_timeout = '5s';

do $$
declare
  t text;
begin
  foreach t in array array[
    'appointments', 'approval_requests', 'branches', 'calls', 'cash_entries', 'commissions', 'communications', 'contracts',
    'customer_demands', 'customers', 'deal_notes', 'deals', 'finance_open_items', 'finance_parties', 'fsbo_leads',
    'listing_control_events', 'listing_pool_entries', 'offers', 'portal_listings', 'profiles', 'properties',
    'property_keys', 'rent_charges', 'rent_payments', 'support_ticket_attachments', 'support_ticket_messages',
    'support_tickets', 'targets', 'tasks', 'teams'
  ] loop
    if pg_catalog.to_regclass('public.' || t) is null then
      continue;
    end if;
    execute pg_catalog.format('drop trigger if exists zz_rt_change_ins on public.%I', t);
    execute pg_catalog.format('drop trigger if exists zz_rt_change_upd on public.%I', t);
    execute pg_catalog.format('drop trigger if exists zz_rt_change_del on public.%I', t);
  end loop;
  if pg_catalog.to_regclass('public.notifications') is not null then
    drop trigger if exists zz_rt_notification on public.notifications;
  end if;
end
$$;

drop function if exists public.rt_emit_tenant_change();
drop function if exists public.rt_emit_notification();

do $$
declare
  v_owner oid;
begin
  if pg_catalog.to_regclass('realtime.messages') is null then
    return;
  end if;
  select c.relowner into v_owner from pg_catalog.pg_class c where c.oid = 'realtime.messages'::regclass;
  if not (
    coalesce((select rolsuper from pg_catalog.pg_roles where rolname = current_user), false)
    or pg_catalog.pg_has_role(current_user, v_owner, 'USAGE')
  ) then
    raise notice 'SK2 geri alma: % realtime.messages sahibi degil; politikalar supabase_admin ile kaldirilmali', current_user;
    return;
  end if;
  execute 'drop policy if exists rt_tenant_topic_read on realtime.messages';
  execute 'drop policy if exists rt_inbox_topic_read on realtime.messages';
end
$$;
