-- Kasa: maaş gizliliği (bakiyeden çıkarım kapanır) + kaynak bağlı iptalde audit kaydı.
--
-- BULGU (Konsey 2026-10-11 #55+#56):
--  * finance_account_balances() SECURITY DEFINER olduğundan RLS'i atlar ve maaş (category='maas') hareketlerini
--    yetkisiz rol için de bakiyeye/giriş-çıkış toplamına katıyordu: ofis hesabı bakiyesi + diğer hareketler
--    arasındaki fark maaş tutarını ele veriyordu (maaş yalnız owner/gm görmeli).
--  * finance_void_source_entries() (komisyon/kira/aidat tahsilat geri alma) hiç audit_logs yazmıyordu.
-- KARAR (bakiye): yetkisiz rol (owner/gm değil) için ofis hesaplarında maaş hareketleri bakiyeden, toplamlardan,
--   hareket sayısından ve son hareket tarihinden HARİÇ tutulur ("maaş hariç bakiye"); owner/gm tam bakiyeyi görür.
--   Kişisel hesaplar etkilenmez (yalnız sahibi görür). İmza değişmez (arayüz sözleşmesi korunur).
--   finance_cash_summary() SECURITY INVOKER'dır ve cash_entries RLS'i maaşı zaten süzer; gövde DEĞİŞMEZ.
-- AUDIT: kaynak bağlı iptal, en az bir hareket iptal edildiğinde tek satır 'cash_entry.void_source' yazar
--   (finance_void_entry ofis hesabı için zaten yazıyor; canlı tanımla aynı kalır, değiştirilmedi).
-- Gövdeler CANLI son tanımdan (pg_get_functiondef, 2026-10-11) alınmıştır. search_path=''; ACL CREATE OR REPLACE ile korunur.
-- GERİ ALMA: supabase/rollbacks/20261011001100_finance_salary_privacy_void_audit.rollback.sql (önceki gövdeler).
-- RİSK: düşük (yalnız iki fonksiyon gövdesi; tablo/veri değişmez).

create or replace function public.finance_account_balances()
returns table(account_id uuid, balance numeric, total_in numeric, total_out numeric, entry_count bigint, last_entry_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id,
         a.opening_balance + coalesce(sum(case when e.direction = 'in' then e.amount else -e.amount end), 0),
         coalesce(sum(case when e.direction = 'in' then e.amount end), 0),
         coalesce(sum(case when e.direction = 'out' then e.amount end), 0),
         count(e.id),
         max(e.entry_date)
  from public.finance_accounts a
  left join public.cash_entries e on e.account_id = a.id and e.tenant_id = a.tenant_id and e.voided_at is null
    -- Maaş hareketleri ofis hesabında yalnız owner/gm için bakiyeye girer (yetkisiz rol "maaş hariç bakiye" görür).
    and (a.owner_scope = 'user' or e.category is distinct from 'maas' or (select public.finance_is_owner_gm()))
  where a.tenant_id = public.current_active_tenant_id()
    and ((a.owner_scope = 'user' and a.owner_user_id = auth.uid())
         or (a.owner_scope = 'office' and public.has_effective_permission('expenses', 'view')))
  group by a.id, a.opening_balance;
$$;

create or replace function public.finance_void_source_entries(p_source_type text, p_source_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_n integer;
  v_total numeric;
  v_reason text;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if p_source_type not in ('commission', 'rent', 'building') or p_source_id is null then return jsonb_build_object('outcome', 'invalid_input'); end if;
  if not (case p_source_type
            when 'commission' then public.has_effective_permission('commissions', 'edit')
            when 'rent' then public.has_effective_permission('rentals', 'delete')
            else public.has_effective_permission('expenses', 'edit') end) then
    return jsonb_build_object('outcome', 'forbidden');
  end if;
  v_reason := pg_catalog.left(coalesce(nullif(pg_catalog.btrim(coalesce(p_reason, '')), ''), 'Tahsilat geri alındı'), 300);
  with voided as (
    update public.cash_entries e set voided_at = pg_catalog.now(), voided_by = v_uid, void_reason = v_reason
    from public.finance_accounts a
    where e.tenant_id = v_tenant and e.source_type = p_source_type and e.source_id = p_source_id and e.voided_at is null
      and a.id = e.account_id and a.tenant_id = e.tenant_id and a.owner_scope = 'office'
    returning e.amount
  )
  select count(*), coalesce(sum(amount), 0) into v_n, v_total from voided;
  if v_n > 0 then
    insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, old_value, new_value)
    values (v_tenant, v_uid, 'cash_entry.void_source', p_source_type, p_source_id,
      jsonb_build_object('amount', v_total, 'source_type', p_source_type),
      jsonb_build_object('reason', v_reason, 'legs', v_n));
  end if;
  return jsonb_build_object('outcome', 'voided', 'count', v_n);
end;
$$;
