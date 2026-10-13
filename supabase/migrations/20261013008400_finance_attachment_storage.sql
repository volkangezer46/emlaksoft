-- FN5 (2026-10-13): Muhasebe > Belgeler — defter eklerinin özel kovaya JWT kimlikli yazımı + e-Fatura listesinin
-- muhasebe yetkisiyle görüntülenmesi.
--
-- 1) storage.objects politikaları: 'expense-receipts' kovasında YALNIZ `{tenant_id}/ledger/{uuid}-{ad}` yolları,
--    yalnız kendi ofisinin öneki ve `expenses` izni (okuma: view, yazma: create, silme: edit). service_role GEREKMEZ
--    (yükleme ucu `/api/app/finans/belge` oturumlu istemciyle yazar; createAdminClient kullanılmaz).
--    Mevcut gider fişi yolları (`{tenant}/{expense_id}/...`) bu politikalara girmez; eski hat (service_role imzalı
--    jeton) aynen sürer.
-- 2) e-Fatura okuma tutarsızlığı: Faturalar artık Muhasebe > Belgeler altında; listeyi `expenses:view` olan da görür.
--    Taslak/resmileştirme yazma politikaları DEĞİŞMEZ (commissions:create).
--
-- İdempotent (create or replace + drop if exists). Mevcut veriye dokunmaz. Geri alma: supabase/rollbacks/20261013008400_*.

create or replace function public.finance_ledger_object_allowed(p_name text, p_action text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_action in ('view', 'create', 'edit')
    and p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ledger/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,120}$'
    and position('..' in p_name) = 0
    and split_part(p_name, '/', 1) = public.current_active_tenant_id()::text
    and public.has_effective_permission('expenses', p_action);
$$;

comment on function public.finance_ledger_object_allowed(text, text) is
  'FN5: expense-receipts kovasinda {tenant}/ledger/{uuid}-{ad} nesnesine erisim (kendi ofisi + expenses izni).';

revoke all privileges on function public.finance_ledger_object_allowed(text, text) from public, anon;
grant execute on function public.finance_ledger_object_allowed(text, text) to authenticated, service_role;

do $$
begin
  if pg_catalog.to_regclass('storage.objects') is not null then
    execute 'drop policy if exists finance_ledger_objects_select on storage.objects';
    execute 'drop policy if exists finance_ledger_objects_insert on storage.objects';
    execute 'drop policy if exists finance_ledger_objects_delete on storage.objects';
    execute $p$create policy finance_ledger_objects_select on storage.objects for select to authenticated
      using (bucket_id = 'expense-receipts' and public.finance_ledger_object_allowed(name, 'view'))$p$;
    execute $p$create policy finance_ledger_objects_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'expense-receipts' and public.finance_ledger_object_allowed(name, 'create'))$p$;
    execute $p$create policy finance_ledger_objects_delete on storage.objects for delete to authenticated
      using (bucket_id = 'expense-receipts' and public.finance_ledger_object_allowed(name, 'edit'))$p$;
  end if;
end $$;

-- e-Fatura: görüntüleme = commissions:create (eski) VEYA expenses:view (Muhasebe > Belgeler).
do $$
begin
  if pg_catalog.to_regclass('public.einvoices') is not null then
    execute 'drop policy if exists einvoices_select on public.einvoices';
    execute $p$create policy einvoices_select on public.einvoices
      for select to authenticated
      using (
        tenant_id = (select public.current_active_tenant_id())
        and (
          (select public.has_effective_permission('commissions', 'create'))
          or (select public.has_effective_permission('expenses', 'view'))
        )
      )$p$;
  end if;
  if pg_catalog.to_regclass('public.einvoice_connections') is not null then
    execute 'drop policy if exists einvoice_connections_select on public.einvoice_connections';
    execute $p$create policy einvoice_connections_select on public.einvoice_connections
      for select to authenticated
      using (
        tenant_id = (select public.current_active_tenant_id())
        and (
          (select public.has_effective_permission('settings', 'view'))
          or (select public.has_effective_permission('commissions', 'create'))
          or (select public.has_effective_permission('expenses', 'view'))
        )
      )$p$;
  end if;
end $$;

notify pgrst, 'reload schema';
