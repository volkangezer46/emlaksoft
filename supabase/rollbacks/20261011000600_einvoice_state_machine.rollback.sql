-- 20261011000600 geri alma: dogrudan yazma yetkisi ve eski guard donulur; RPC'ler ve kilit sutunu duser.
drop function if exists public.einvoice_delete_draft(uuid);
drop function if exists public.einvoice_reopen(uuid);
drop function if exists public.einvoice_mark_cancelled(uuid, text);
drop function if exists public.einvoice_record_status(uuid, text, text, text, text, jsonb);
drop function if exists public.einvoice_mark_issued(uuid, jsonb, text);
drop function if exists public.einvoice_record_progress(uuid, jsonb, text, text, boolean);
drop function if exists public.einvoice_claim_issue(uuid);
drop function if exists public.einvoice_save_draft(uuid, jsonb);
drop function if exists public._einvoice_audit(uuid, text, uuid, jsonb, jsonb);
drop function if exists public._einvoice_gate();

grant insert, update, delete on public.einvoices to authenticated;

drop policy if exists einvoices_delete on public.einvoices;
create policy einvoices_delete on public.einvoices
  for delete to authenticated
  using (
    tenant_id = (select public.current_active_tenant_id())
    and status = 'draft'
    and (select public.has_effective_permission('commissions', 'create'))
  );

create or replace function public.einvoices_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'cancelled' then
      raise exception 'Iptal edilmis fatura degistirilemez.' using errcode = 'check_violation';
    end if;
    if old.status = 'issued' and (
         new.lines is distinct from old.lines
      or new.buyer_name is distinct from old.buyer_name
      or new.buyer_tax_id is distinct from old.buyer_tax_id
      or new.net_total is distinct from old.net_total
      or new.vat_total is distinct from old.vat_total
      or new.gross_total is distinct from old.gross_total
      or new.issue_date is distinct from old.issue_date
      or new.doc_type is distinct from old.doc_type
      or new.source_type is distinct from old.source_type
      or new.source_id is distinct from old.source_id
      or new.idempotency_key is distinct from old.idempotency_key
      or new.external_id is distinct from old.external_id
      or new.tenant_id is distinct from old.tenant_id
    ) then
      raise exception 'Resmilesmis faturanin icerigi degistirilemez.' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

alter table public.einvoices drop column if exists issue_claimed_at;
notify pgrst, 'reload schema';
