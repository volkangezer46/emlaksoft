-- Muhasebe v2 (FN6): düzenli ödeme kuralına cari, KDV ve stopaj koşulları.
--
-- recurring_rules.party_id / vat_rate / withholding_rate sütunları FN1 migration'ında (20261014001000_finance_ledger_v2)
-- eklenir; eski recurring_rule_create/update imzaları DEĞİŞMEZ (Kasam, kira-tahakkuk ve düzenli ödeme döngüsü kırılmaz).
-- Bu dosya yalnız ayrı bir yazma RPC'si ekler: kural oluşturulduktan / düzenlendikten sonra koşullar bununla yazılır.
-- plpgsql gövdesi sütunları ÇALIŞMA anında çözer: FN1 uygulanmadan çağrılırsa 42703 döner, kod bunu "kurulum bekliyor"
-- olarak ele alır (kural yine kaydedilir). İdempotent (create or replace); geri alma: supabase/rollbacks/ eşi.
--
-- Yetki: recurring_rule_access(p_rule_id, 'edit') (ofis kuralı = expenses:edit, maaş yalnız owner/gm). Yalnız OFİS
-- kuralları cari/KDV/stopaj taşır (kişisel kural ofis carisine bağlanmaz). Cari aynı ofisin arşivlenmemiş kaydı olmalı.

create or replace function public.recurring_rule_set_terms(
  p_rule_id uuid, p_party_id uuid, p_vat_rate numeric, p_withholding_rate numeric
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_scope text;
begin
  if v_uid is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  v_tenant := public.current_active_tenant_id();
  if v_tenant is null then return jsonb_build_object('outcome', 'unauthorized'); end if;
  if (p_vat_rate is not null and (p_vat_rate < 0 or p_vat_rate > 100))
     or (p_withholding_rate is not null and (p_withholding_rate < 0 or p_withholding_rate > 100)) then
    return jsonb_build_object('outcome', 'invalid_input');
  end if;
  if not public.recurring_rule_access(p_rule_id, 'edit') then return jsonb_build_object('outcome', 'forbidden'); end if;
  select r.scope into v_scope from public.recurring_rules r where r.id = p_rule_id and r.tenant_id = v_tenant for update;
  if not found then return jsonb_build_object('outcome', 'not_found'); end if;
  if v_scope <> 'office' then return jsonb_build_object('outcome', 'invalid_input'); end if;
  if p_party_id is not null and not exists (
    select 1 from public.finance_parties p where p.id = p_party_id and p.tenant_id = v_tenant and p.archived_at is null
  ) then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  update public.recurring_rules
     set party_id = p_party_id,
         vat_rate = case when p_vat_rate is null then null else pg_catalog.round(p_vat_rate, 2) end,
         withholding_rate = case when p_withholding_rate is null then null else pg_catalog.round(p_withholding_rate, 2) end,
         updated_at = pg_catalog.now()
   where id = p_rule_id and tenant_id = v_tenant;

  insert into public.audit_logs (tenant_id, actor_id, action, entity_type, entity_id, new_value)
  values (v_tenant, v_uid, 'recurring_rule.terms', 'recurring_rule', p_rule_id,
    jsonb_build_object('party_id', p_party_id, 'vat_rate', p_vat_rate, 'withholding_rate', p_withholding_rate));
  return jsonb_build_object('outcome', 'updated');
end;
$$;

revoke all on function public.recurring_rule_set_terms(uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.recurring_rule_set_terms(uuid, uuid, numeric, numeric) to authenticated, service_role;
