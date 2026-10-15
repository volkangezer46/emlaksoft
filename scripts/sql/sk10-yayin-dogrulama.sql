-- SK10 yayın sonrası SALT-OKUNUR doğrulama (yetki ve veri erişimi: 20261016100000..100300).
-- Şema/veri DEĞİŞTİRMEZ: tek `begin transaction read only` + rollback. Migration değildir.
--
-- Çalıştırma (yayından hemen sonra, sahip/ana oturum):
--   docker exec -i <supabase-db-container> psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/sql/sk10-yayin-dogrulama.sql
-- Beklenen: her satırın `durum` sütunu 'TAMAM'. 'EKSIK' varsa migration çıktısını (db:migrate süzülmüş günlük) inceleyin.
-- Ardından: `npm run db:rls-audit` (YAZMA-IZIN-YOK = 0) ve
--   `PERMISSION_DEFAULTS_DB_URL=<url> npx vitest run src/lib/permissions-matrix-contract.test.ts` (kod = DB matrisi).

begin transaction read only;

with beklenen(nesne, var_mi) as (
  values
    ('fn scope_context()', pg_catalog.to_regprocedure('public.scope_context()') is not null),
    ('fn scope_owner_ids()', pg_catalog.to_regprocedure('public.scope_owner_ids()') is not null),
    ('fn scope_enforced()', pg_catalog.to_regprocedure('public.scope_enforced()') is not null),
    ('fn scope_allows(uuid)', pg_catalog.to_regprocedure('public.scope_allows(uuid)') is not null),
    ('6 tablo x 3 politika kapsam kosulu',
      (select count(*) = 18 from pg_policies
        where schemaname = 'public'
          and tablename in ('customers', 'properties', 'deals', 'customer_demands', 'tasks', 'appointments')
          and policyname ~ '^identity_.*_(select|update|delete)$'
          and coalesce(qual, '') ~ 'scope_enforced')),
    ('cron tablolarinda authenticated yazma yok',
      not exists (select 1 from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated')
          and table_name in ('agent_badges', 'agent_score_snapshots', 'automation_logs', 'playbook_runs')
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE'))),
    ('yalniz-kiraci yazma politikasi (B159 tablolari) yok',
      not exists (select 1 from pg_policies
        where schemaname = 'public' and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
          and tablename in ('automations', 'contract_templates', 'definitions', 'message_templates', 'announcements',
                            'playbooks', 'playbook_steps', 'presentations', 'property_dues', 'property_keys',
                            'property_key_events', 'staff_leaves', 'unit_payments', 'network_listings', 'network_demands',
                            'network_requests', 'network_demand_responses', 'lost_sale_dismissals', 'campaign_recipients',
                            'lookup_values', 'rent_reminders', 'approval_comments')
          and coalesce(qual, '') || ' ' || coalesce(with_check, '') !~ '(has_effective_permission|uid\(\))')),
    ('rol matrisi: gm/owner satir korumasi',
      exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tenant_role_permissions'
        and policyname = 'tenant_role_permissions_write' and coalesce(with_check, '') ~ 'role <> ''gm''')),
    ('readonly support:view', exists (select 1 from public.permission_defaults
        where role = 'readonly' and module = 'support' and action = 'view')),
    ('profile_ui_state_mark SECURITY DEFINER',
      (select prosecdef from pg_proc where oid = 'public.profile_ui_state_mark(text)'::regprocedure)),
    ('assign_pool_entry sube siniri',
      pg_get_functiondef('public.assign_pool_entry(uuid,uuid,text,text,smallint,jsonb)'::regprocedure) ~ 'subenize ait degil')
)
select nesne, case when var_mi then 'TAMAM' else 'EKSIK' end as durum from beklenen;

-- Kapsam bayrağı açık ofis sayısı (karar: varsayılan KAPALI; açmak sahibin kararı).
select count(*) as kapsam_acik_ofis
from public.tenant_settings
where key = 'office.access.scope_enforcement' and (value #>> '{}') = 'true';

rollback;
