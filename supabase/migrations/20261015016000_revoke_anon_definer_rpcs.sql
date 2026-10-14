-- MIGRATION 20261015016000_revoke_anon_definer_rpcs.sql
-- UYGULANMADI: yalniz restore edilebilir backup/PITR dogrulandiktan sonra SAHIBI uygular (gölgede denendi:
--   supabase/tests/kq2_anon_rpc_acl.test.sql).
-- Geri alma: supabase/rollbacks/20261015016000_revoke_anon_definer_rpcs.rollback.sql (anon/PUBLIC EXECUTE geri verilir).
--
-- AMAC (KQ2, anon RPC yuzeyi): canlida anon'un EXECUTE edebildigi 17 SECURITY DEFINER fonksiyon tek tek incelendi
--   (2026-10-15, salt-okunur `has_function_privilege('anon', oid, 'EXECUTE')`). Cagri yeri koddan cikarildi:
--
--   ANON GEREKLI -> DOKUNULMAZ (herkese acik sayfa/rota anon anahtarla cagirir ya da RLS ifadesinde kullanilir):
--     current_tenant_id, current_user_scope, current_user_team_id, current_user_branch_id, has_permission_with_scope,
--       is_platform_staff                                  : RLS yardimcisi (TO public politikalar anon icin de degerlendirir)
--     api_v1_list                                          : /api/v1/[resource] (API anahtari, oturumsuz)
--     contract_signer_resolve_short                        : /imza/k/[kod]
--     decide_property_price_proposal_by_token              : malik portali (owner-price-proposal action, oturumsuz)
--     growth_invite_preview                                : /kayit davet bandi
--     portal_customer_request                              : musteri portali istekleri
--     portal_rent_receipt_target                           : kiraci dekont yukleme
--     vitrin_chat_context                                  : /api/vitrin-sohbet
--   ANON GEREKSIZ -> anon + PUBLIC EXECUTE GERI ALINIR (authenticated/service_role acikca korunur):
--     aidat_kpi()                  : yalniz /app/aidat (oturumlu sunucu istemcisi); anon cagiran yok
--     tcmb_rate_on(date)           : koddan cagrilmiyor (kur okuma tcmb_rates tablosundan, cron service_role); anon cagiran yok
--     increment_template_usage(uuid): yalniz oturumlu server action (message-templates); gölge zincirinde anon acik, canlida zaten kapali
--     log_property_price_change()  : TETIKLEYICI fonksiyonu (RPC olarak cagrilamaz; tetikleyici atesi EXECUTE denetlemez) - hijyen
--     rls_auto_enable()            : olay tetikleyicisi fonksiyonu (yalniz canlida, Supabase kurulumu); varsa hijyen icin kapatilir
--   Sonuc: anon anahtarla /rest/v1/rpc/aidat_kpi, /rpc/tcmb_rate_on, /rpc/increment_template_usage 'permission denied' (42501) doner.
-- scripts/function-acl-allowlist.ts ayni anda daraltildi (aidat_kpi / tcmb_rate_on / increment_template_usage cikti).
-- Idempotent; fonksiyon yoksa atlanir (to_regprocedure).
set local lock_timeout = '5s';

do $$
declare
  f text;
begin
  -- RPC'ler: anon + PUBLIC kapanir, oturumlu roller acikca korunur.
  foreach f in array array['public.aidat_kpi()', 'public.tcmb_rate_on(date)', 'public.increment_template_usage(uuid)'] loop
    if pg_catalog.to_regprocedure(f) is null then
      raise notice 'KQ2: % yok, atlandi', f;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;

  -- Tetikleyici / olay tetikleyicisi fonksiyonlari: RPC degil; yalniz anon + PUBLIC kapanir.
  foreach f in array array['public.log_property_price_change()', 'public.rls_auto_enable()'] loop
    if pg_catalog.to_regprocedure(f) is null then
      raise notice 'KQ2: % yok, atlandi', f;
      continue;
    end if;
    execute format('revoke execute on function %s from public, anon', f);
  end loop;
end $$;
