-- 20261013008400 geri alma: defter eki depolama politikaları kaldırılır, e-Fatura okuma politikaları eski haline döner.
-- Yüklenmiş nesneler ve finance_attachments satırları SİLİNMEZ (yalnız oturumlu erişim kapanır; yükleme ucu
-- "Dosya kaydedilemedi" der). Veri kaybı yok.
do $$
begin
  if pg_catalog.to_regclass('storage.objects') is not null then
    execute 'drop policy if exists finance_ledger_objects_select on storage.objects';
    execute 'drop policy if exists finance_ledger_objects_insert on storage.objects';
    execute 'drop policy if exists finance_ledger_objects_delete on storage.objects';
  end if;
  if pg_catalog.to_regclass('public.einvoices') is not null then
    execute 'drop policy if exists einvoices_select on public.einvoices';
    execute $p$create policy einvoices_select on public.einvoices
      for select to authenticated
      using (
        tenant_id = (select public.current_active_tenant_id())
        and (select public.has_effective_permission('commissions', 'create'))
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
        )
      )$p$;
  end if;
end $$;
drop function if exists public.finance_ledger_object_orphan(text, text, timestamptz);
drop function if exists public.finance_ledger_object_allowed(text, text);
notify pgrst, 'reload schema';
