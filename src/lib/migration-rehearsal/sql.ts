/**
 * Migration provası SQL kataloğu. Çalıştırıcı (scripts/migration-rehearsal.ts) YALNIZ bu sabitleri ve migration
 * dosyalarının kendisini (findTransactionControl taramasından geçtikten sonra) çalıştırır. Hiçbir sabit
 * kalıcılaştırma deyimi içermez (sözleşme testi + libpg-query ayrıştırması). Şema adları migration dosyalarından
 * okunarak yazıldı (kaynaklar her sorgunun yanında).
 */
import type { Expectation } from "./core";
import { EF_FILE_CHECKS, allEfCatalogSql } from "./ef-sql";

export const TX = {
  begin: "begin",
  rollback: "rollback",
  /** set_config(..., true) = yalnız bu transaction. */
  timeouts:
    "select set_config('statement_timeout', $1, true) as st, set_config('lock_timeout', $2, true) as lt, " +
    "set_config('idle_in_transaction_session_timeout', $3, true) as it",
  /** apply-migrations.ts oturum düzeyi pg_try_advisory_lock(LOCK_KEY) alır; xact düzeyi aynı anahtarla çakışır. */
  tryLock: "select pg_try_advisory_xact_lock($1::bigint) as ok",
  savepoint: "savepoint rh_step",
  toSavepoint: "rollback to savepoint rh_step",
  releaseSavepoint: "release savepoint rh_step",
  savepointNeg: "savepoint rh_neg",
  toSavepointNeg: "rollback to savepoint rh_neg",
  releaseSavepointNeg: "release savepoint rh_neg",
  serverInfo: "select current_setting('server_version_num')::int as version_num, current_user as usr, now()::text as tx_now",
  ledgerExists: "select to_regclass('public.schema_migrations')::text as ledger",
  ledgerApplied: "select version from public.schema_migrations where version = any($1::text[]) order by version",
  /** service_role kimliği: auth.role() = 'service_role' (fatura RPC'leri ve profil eşitleme tetikleyicisi bunu ister). */
  asService: "select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true) as claims",
  resetRole: "reset role",
  asAuthenticatedRole: "set local role authenticated",
  /** $1 = JSON claims: {"sub": profil, "role": "authenticated", "app_metadata": {"tenant_id", "role"}}. */
  setClaims: "select set_config('request.jwt.claims', $1, true) as claims",
} as const;

/** Fatura fonksiyonu gövdeleri (md5(prosrc), CR atılır): 20260825000600 başlığındaki sorguyla aynı biçim. */
export const FN = {
  md5: "select md5(replace(p.prosrc, E'\\r', '')) as md5 from pg_catalog.pg_proc p where p.oid = to_regprocedure($1)",
  hasText:
    "select position($2 in p.prosrc) > 0 as has from pg_catalog.pg_proc p where p.oid = to_regprocedure($1)",
} as const;

export const SIG = {
  fulfill10: "public.fulfill_billing_payment(text, text, text, text, text, uuid, text, text, numeric, text)",
  fulfill9: "public.fulfill_billing_payment(text, text, text, text, text, uuid, text, text, numeric)",
  fulfillV2: "public.fulfill_billing_payment_v2(text, text, text, text, text, uuid, text, text, numeric, text)",
  enforcePlan: "public.enforce_plan_capacity()",
  enforceTenant: "public.enforce_tenant_plan_capacity()",
  updatePlan: "public.update_tenant_plan_subscription(uuid, uuid, text, text)",
  provision: "public.provision_registration(uuid, text, text, text, text, text, text, text, text, text, text, text)",
  convertDemo: "public.convert_demo_request_to_tenant(uuid, uuid, uuid, text)",
} as const;

/** Fonksiyon -> gövdesinin ÖNCE (canlı) ve SONRA (prova) kaynak dosyası. */
export const BILLING_FUNCTIONS = [
  { key: "fulfill10", name: "fulfill_billing_payment", before: "20260809000000_billing_fulfillment_hardening.sql", after: "20260825000600_seat_purchase_fulfillment.sql" },
  { key: "fulfillV2", name: "fulfill_billing_payment_v2", before: "20260810000100_billing_checkout_reconciliation.sql", after: "20260825000600_seat_purchase_fulfillment.sql" },
  { key: "enforcePlan", name: "enforce_plan_capacity", before: "20260802000320_plan_entitlements.sql", after: "20260825000600_seat_purchase_fulfillment.sql" },
  { key: "enforceTenant", name: "enforce_tenant_plan_capacity", before: "20260802000320_plan_entitlements.sql", after: "20260825000600_seat_purchase_fulfillment.sql" },
  { key: "updatePlan", name: "update_tenant_plan_subscription", before: "20260802000300_identity_session_authorization_hardening.sql", after: "20260825000300_billing_plan_amount_integrity.sql" },
] as const;

/**
 * `--ef` kümesi: canlı gövde = 20260825000600 (fulfill/v2/tetikleyiciler) ve 20260825000300 (update plan).
 * Yalnız fulfill + v2 değişir (20260826000300); diğer üçü ÖNCE = SONRA (dokunulmadığının kanıtı).
 */
export const EF_BILLING_FUNCTIONS = [
  { key: "fulfill10", name: "fulfill_billing_payment", before: "20260825000600_seat_purchase_fulfillment.sql", after: "20260826000300_ef_credit_pack_fulfillment.sql" },
  { key: "fulfillV2", name: "fulfill_billing_payment_v2", before: "20260825000600_seat_purchase_fulfillment.sql", after: "20260826000300_ef_credit_pack_fulfillment.sql" },
  { key: "enforcePlan", name: "enforce_plan_capacity", before: "20260825000600_seat_purchase_fulfillment.sql", after: "20260825000600_seat_purchase_fulfillment.sql" },
  { key: "enforceTenant", name: "enforce_tenant_plan_capacity", before: "20260825000600_seat_purchase_fulfillment.sql", after: "20260825000600_seat_purchase_fulfillment.sql" },
  { key: "updatePlan", name: "update_tenant_plan_subscription", before: "20260825000300_billing_plan_amount_integrity.sql", after: "20260825000300_billing_plan_amount_integrity.sql" },
] as const;

export type ExistenceCheck = { id: string; title: string; sql: string; expect: Record<string, Expectation> };

const atLeast = (n: number): Expectation => ({ test: (v) => Number(v) >= n, describe: `>= ${n}` });

/** Dosya başına: uygulamadan ÖNCE (isteğe bağlı) ve SONRA (YAYIN_PENCERESI_2.md §4 ile aynı sorgular). */
export const FILE_CHECKS: Record<string, { pre?: ExistenceCheck; post: ExistenceCheck[] }> = {
  "20260825000100_properties_owner_customer_link.sql": {
    post: [
      {
        id: "4.1",
        title: "malik bağlantısı: sütun, FK, tetikleyici, indeks",
        sql:
          "select (select count(*) from information_schema.columns where table_schema='public' and table_name='properties' and column_name='owner_customer_id') as col, " +
          "(select count(*) from pg_constraint where conname='properties_owner_customer_id_fkey') as fk, " +
          "(select count(*) from pg_trigger where tgname='trg_properties_owner_same_tenant' and not tgisinternal) as trg, " +
          "to_regclass('public.idx_properties_owner_customer') is not null as idx, " +
          "(select count(*) from public.properties where owner_customer_id is not null) as dolu",
        expect: { col: "1", fk: "1", trg: "1", idx: "t", dolu: "0" },
      },
    ],
  },
  "20260825000200_geo_central_management.sql": {
    pre: {
      id: "4.2-once",
      title: "coğrafya: eklenecek sütunlar migration öncesi YOK (rollback güvenliği)",
      sql:
        "select count(*) as n from information_schema.columns where table_schema='public' and table_name in ('geo_provinces','geo_districts','geo_neighborhoods','demo_requests') " +
        "and column_name in ('description','deactivated_at','source','version_id','province_id','district_id')",
      expect: { n: "0" },
    },
    post: [
      {
        id: "4.2",
        title: "coğrafya: tablolar, RLS, politika, RPC, sütunlar, yetki",
        sql:
          "select to_regclass('public.geo_data_versions') is not null as v, to_regclass('public.geo_aliases') is not null as a, " +
          "to_regclass('public.geo_change_requests') is not null as r, " +
          "(select relrowsecurity from pg_class where oid='public.geo_change_requests'::regclass) as rls, " +
          "(select count(*) from pg_policies where schemaname='public' and tablename='geo_change_requests') as pol, " +
          "(select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('geo_usage_counts','geo_usage_totals','geo_usage_rows','geo_merge','geo_merge_undo','geo_move')) as fn, " +
          "(select count(*) from information_schema.columns where table_schema='public' and table_name in ('geo_provinces','geo_districts','geo_neighborhoods') and column_name in ('description','deactivated_at','source','version_id')) as cols, " +
          "has_function_privilege('authenticated','public.geo_merge(text,uuid,uuid,uuid,text)','execute') as auth_exec",
        expect: { v: "t", a: "t", r: "t", rls: "t", pol: "2", fn: "6", cols: "12", auth_exec: "f" },
      },
    ],
  },
  "20260825000300_billing_plan_amount_integrity.sql": {
    post: [
      {
        id: "4.3",
        title: "fiyat bütünlüğü: 5 yardımcı var, authenticated çalıştıramaz",
        sql:
          "select (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('plan_catalog_document','plan_monthly_amount','plan_yearly_paid_months','plan_period_amount','plan_campaign_lock_amount')) as fn, " +
          "has_function_privilege('authenticated','public.plan_monthly_amount(text)','execute') as auth_exec",
        expect: { fn: "5", auth_exec: "f" },
      },
      {
        id: "4.3-govde",
        title: "provision/convert yardımcıyı ve K1 deneme günü ifadesini kullanıyor",
        sql:
          "select (select position('public.plan_monthly_amount(' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.provision_registration(uuid, text, text, text, text, text, text, text, text, text, text, text)')) as prov_helper, " +
          "(select position('make_interval(days => public.platform_default_trial_days())' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.provision_registration(uuid, text, text, text, text, text, text, text, text, text, text, text)')) as prov_k1, " +
          "(select position('public.plan_monthly_amount(' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.convert_demo_request_to_tenant(uuid, uuid, uuid, text)')) as conv_helper, " +
          "(select position('make_interval(days => public.platform_default_trial_days())' in prosrc) > 0 from pg_proc where oid = to_regprocedure('public.convert_demo_request_to_tenant(uuid, uuid, uuid, text)')) as conv_k1",
        expect: { prov_helper: "t", prov_k1: "t", conv_helper: "t", conv_k1: "t" },
      },
    ],
  },
  "20260825000400_subscription_seat_price_lock.sql": {
    post: [
      {
        id: "4.4",
        title: "koltuk fiyat kilidi sütunları",
        sql: "select count(*) as n from information_schema.columns where table_schema='public' and table_name='subscriptions' and column_name in ('seat_price_lock_base_try','seat_price_lock_tiers')",
        expect: { n: "2" },
      },
    ],
  },
  "20260825000500_billing_pause_proration_business_seats.sql": {
    post: [
      {
        id: "4.5",
        title: "duraklatma/extra_seats: sütunlar, RPC'ler, mevcut ek koltuk 0, yetki",
        sql:
          "select (select count(*) from information_schema.columns where table_schema='public' and table_name='subscriptions' and column_name in ('paused_at','pause_resume_at','pause_remaining','extra_seats')) as cols, " +
          "(select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('pause_subscription','resume_subscription','quote_upgrade_proration','effective_seat_limit')) as fn, " +
          "(select count(*) from public.subscriptions where extra_seats <> 0) as ek_koltuk, " +
          "has_function_privilege('authenticated','public.effective_seat_limit(uuid)','execute') as auth_exec",
        expect: { cols: "4", fn: "4", ek_koltuk: "0", auth_exec: "f" },
      },
      {
        id: "4.5-limit",
        title: "effective_seat_limit = plan seat_limit (extra_seats 0) tüm ofislerde",
        sql:
          "select count(*) filter (where public.effective_seat_limit(t.id) is distinct from pe.seat_limit) as farkli " +
          "from public.tenants t join public.plan_entitlements pe on pe.plan = t.plan",
        expect: { farkli: "0" },
      },
    ],
  },
  "20260825000600_seat_purchase_fulfillment.sql": {
    post: [
      {
        id: "4.6",
        title: "seat_purchase_ready var; koltuk tetikleyicileri beklenen fonksiyonlara bağlı",
        sql:
          "select to_regprocedure('public.seat_purchase_ready()') is not null as fn, " +
          "(select count(*) from pg_trigger where not tgisinternal and ((tgname='trg_profiles_plan_capacity' and tgfoid=to_regprocedure('public.enforce_plan_capacity()')) or (tgname='trg_tenants_plan_capacity' and tgfoid=to_regprocedure('public.enforce_tenant_plan_capacity()')))) as trg",
        expect: { fn: "t", trg: "2" },
      },
    ],
  },
  "20260825000700_survey_module.sql": {
    post: [
      {
        id: "4.7",
        title: "anket: 8 RLS'li tablo, 27 politika, 3 fonksiyon, tetikleyici, izin seed",
        sql:
          "select (select count(*) from pg_class where relnamespace='public'::regnamespace and relrowsecurity and relname in ('survey_settings','survey_assignees','survey_templates','survey_questions','survey_triggers','survey_tasks','survey_answers','survey_attempts')) as rls_tablo, " +
          "(select count(*) from pg_policies where schemaname='public' and tablename in ('survey_settings','survey_assignees','survey_templates','survey_questions','survey_triggers','survey_tasks','survey_answers','survey_attempts')) as pol, " +
          "(select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('survey_is_manager','survey_can_work_task','guard_survey_task_update')) as fn, " +
          "(select count(*) from pg_trigger where tgname='trg_survey_tasks_guard' and not tgisinternal) as trg, " +
          "(select count(*) from public.permission_defaults where module='surveys') as izin",
        expect: { rls_tablo: "8", pol: "27", fn: "3", trg: "1", izin: atLeast(16) },
      },
    ],
  },
  "20260825000800_growth_referral_partner_attribution.sql": {
    post: [
      {
        id: "4.8",
        title: "büyüme: 8 RLS'li tablo, görünüm, 2 politika, değiştirilemez defter",
        sql:
          "select (select count(*) from pg_class where relnamespace='public'::regnamespace and relrowsecurity and relname in ('growth_reward_rules','growth_partners','growth_referral_codes','signup_attributions','growth_reward_claims','account_credit_ledger','growth_partner_payouts','success_stories')) as rls_tablo, " +
          "to_regclass('public.account_credit_balances') is not null as view, " +
          "(select count(*) from pg_policies where schemaname='public' and policyname in ('growth_referral_codes_own','credit_ledger_own_select')) as pol, " +
          "(select count(*) from pg_trigger where tgname='trg_credit_ledger_immutable' and not tgisinternal) as trg",
        expect: { rls_tablo: "8", view: "t", pol: "2", trg: "1" },
      },
    ],
  },
  "20260825000900_growth_click_counters.sql": {
    post: [
      {
        id: "4.9",
        title: "tıklama sayacı: tablo, RLS, definer RPC, anon çalıştıramaz",
        sql:
          "select to_regclass('public.growth_click_counters') is not null as tablo, " +
          "(select relrowsecurity from pg_class where oid='public.growth_click_counters'::regclass) as rls, " +
          "(select prosecdef from pg_proc where oid='public.growth_count_click(text,text)'::regprocedure) as definer, " +
          "has_function_privilege('anon','public.growth_count_click(text,text)','execute') as anon_exec",
        expect: { tablo: "t", rls: "t", definer: "t", anon_exec: "f" },
      },
    ],
  },
  "20260825001000_ai_credit_metering.sql": {
    post: [
      {
        id: "4.10",
        title: "AI kredi: ölçüm sütunları, birim CHECK, RPC'ler, indeks, authenticated yalnız SELECT",
        sql:
          "select (select count(*) from information_schema.columns where table_schema='public' and table_name='account_credit_ledger' and column_name in ('feature','model','tokens_in','tokens_out')) as cols, " +
          "(select pg_get_constraintdef(oid) like '%valuation%' from pg_constraint where conname='account_credit_ledger_unit_check' and conrelid='public.account_credit_ledger'::regclass) as unit_ok, " +
          "(select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('ai_credit_charge','ai_credit_metering_ready')) as fn, " +
          "to_regclass('public.idx_credit_ledger_usage') is not null as idx, " +
          "has_table_privilege('authenticated','public.account_credit_ledger','insert') as auth_insert, " +
          "has_table_privilege('authenticated','public.account_credit_ledger','select') as auth_select",
        expect: { cols: "4", unit_ok: "t", fn: "2", idx: "t", auth_insert: "f", auth_select: "t" },
      },
    ],
  },
  "20260825001100_tenant_vitrin_settings.sql": {
    post: [
      {
        id: "4.11",
        title: "vitrin ayarları: 3 sütun, CHECK, varsayılanlar bugünkü davranış",
        sql:
          "select (select count(*) from information_schema.columns where table_schema='public' and table_name='tenants' and column_name in ('vitrin_intro','vitrin_enabled','vitrin_show_phone')) as cols, " +
          "(select count(*) from pg_constraint where conname='tenants_vitrin_intro_len') as chk, " +
          "(select count(*) from public.tenants where not vitrin_enabled or not vitrin_show_phone) as kapali",
        expect: { cols: "3", chk: "1", kapali: "0" },
      },
    ],
  },
  "20260825001200_tenant_vitrin_sections_seo_optin.sql": {
    post: [
      {
        id: "4.12",
        title: "vitrin SEO opt-in: 3 sütun, hiçbir ofis opt-in değil (sitemap kaynağı değişir)",
        sql:
          "select (select count(*) from information_schema.columns where table_schema='public' and table_name='tenants' and column_name in ('vitrin_seo_optin','vitrin_show_lead_form','vitrin_show_valuation')) as cols, " +
          "(select count(*) from public.tenants where vitrin_seo_optin) as optin",
        expect: { cols: "3", optin: "0" },
      },
    ],
  },
  "20260825001300_ownership_transfers.sql": {
    post: [
      {
        id: "4.13",
        title: "sahiplik devri: tablo, RLS, 2 politika, 3 definer RPC, tek bekleyen indeksi, yetki",
        sql:
          "select to_regclass('public.ownership_transfers') is not null as tablo, " +
          "(select relrowsecurity from pg_class where oid='public.ownership_transfers'::regclass) as rls, " +
          "(select count(*) from pg_policies where schemaname='public' and tablename='ownership_transfers') as pol, " +
          "(select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef and proname in ('request_ownership_transfer','accept_ownership_transfer','resolve_ownership_transfer')) as fn, " +
          "to_regclass('public.uq_ownership_transfers_one_pending') is not null as tek_bekleyen, " +
          "has_function_privilege('authenticated','public.accept_ownership_transfer(uuid,uuid,uuid)','execute') as auth_exec",
        expect: { tablo: "t", rls: "t", pol: "2", fn: "3", tek_bekleyen: "t", auth_exec: "f" },
      },
    ],
  },
  "20260816000500_commission_earnings_privacy.sql": {
    post: [
      {
        id: "4.14",
        title: "kazanç gizliliği: fonksiyon + commissions_select politikası onu kullanıyor",
        sql:
          "select (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='can_view_commission_earnings') as fn, " +
          "(select position('can_view_commission_earnings' in qual) > 0 from pg_policies where schemaname='public' and tablename='commissions' and policyname='commissions_select') as pol",
        expect: { fn: "1", pol: "t" },
      },
    ],
  },
  // EmlakFiyati kontör kümesi (`--ef`): kontroller ef-sql.ts'de.
  ...EF_FILE_CHECKS,
};

/** Saf yardımcılar (20260825000300). */
export const HELPERS = {
  catalog: "select public.plan_catalog_document() is null as no_doc",
  prices:
    "select public.plan_monthly_amount('advisor') as advisor, public.plan_monthly_amount('office') as office, " +
    "public.plan_monthly_amount('professional') as professional, public.plan_monthly_amount('business') as business, " +
    "public.plan_monthly_amount('enterprise') as enterprise, public.plan_monthly_amount('free') as bilinmeyen",
  yearly:
    "select bool_and(public.plan_period_amount(p, 'yearly') = round(public.plan_monthly_amount(p) * public.plan_yearly_paid_months(p))) as yearly_ok, " +
    "bool_and(public.plan_period_amount(p, 'monthly') = public.plan_monthly_amount(p)) as monthly_ok, " +
    "bool_and(public.plan_yearly_paid_months(p) between 1 and 12) as months_ok, " +
    "public.plan_period_amount('professional', 'weekly') is null as invalid_cycle_null " +
    "from unnest(array['advisor','office','professional','business','enterprise']) as p",
  tenTimes:
    "select public.plan_period_amount('professional','yearly') = public.plan_monthly_amount('professional') * 10 as pro_x10, " +
    "public.plan_period_amount('office','yearly') = public.plan_monthly_amount('office') * 10 as office_x10, " +
    "public.plan_yearly_paid_months('professional') as odenen_ay",
  seatReady: "select public.seat_purchase_ready() as hazir",
} as const;

/**
 * İşlevsel fatura smoke + RLS simülasyonu için GEÇİCİ satırlar (ROLLBACK ile yok olur).
 * Sütunlar: auth.users (GoTrue), tenants/profiles (20260721000000), subscriptions/invoices (20260722000006,
 * checkout_status 20260810000100), platform_staff (20260722000005), properties (20260721000000),
 * tenant_role_permissions (20260722000014), approval_requests (20260728000123 + 20260823000100),
 * listing_pool_entries (20260816001500), kvkk_requests (20260819010600), property_owner_info (20260819020100).
 */
export const SMOKE = {
  insertAuthUser:
    "insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) " +
    "values ($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', $2, '{}'::jsonb, '{}'::jsonb, now(), now())",
  insertTenant: "insert into public.tenants (id, name, slug, plan, status) values ($1::uuid, $2, $3, $4, 'active')",
  insertSubscription:
    "insert into public.subscriptions (id, tenant_id, plan, status, billing_cycle, amount_try, current_period_start, current_period_end) " +
    "values ($1::uuid, $2::uuid, $3, 'active', 'monthly', $4::numeric, now() - interval '10 days', now() + interval '20 days')",
  insertProfile: "insert into public.profiles (id, tenant_id, full_name, role, is_active) values ($1::uuid, $2::uuid, $3, $4, true)",
  insertStaff: "insert into public.platform_staff (id, email, full_name, role, is_active) values ($1::uuid, $2, $3, 'billing', true)",
  seatLimit: "select pe.seat_limit from public.plan_entitlements pe where pe.plan = $1",
  activeSeats: "select count(*)::int as n from public.profiles where tenant_id = $1::uuid and is_active",
  planAmounts:
    "select public.plan_monthly_amount($1)::text as monthly, public.plan_period_amount($1, 'monthly')::text as period",
  /** fulfill KDV kuralı: total = round(net * 1.20, 2) (20260825000600). */
  grossTotal: "select round($1::numeric * 1.20, 2)::text as total",
  insertInvoice:
    "insert into public.invoices (id, tenant_id, subscription_id, invoice_no, status, amount_try, currency, meta, checkout_status) " +
    "values ($1::uuid, $2::uuid, $3::uuid, $4, 'draft', $5::numeric, 'TRY', $6::jsonb, 'pending_checkout')",
  fulfillV2:
    "select public.fulfill_billing_payment_v2('demo', $1, null, 'demo', 'subscription', $2::uuid, $3, 'monthly', $4::numeric, 'TRY') as result",
  subState:
    "select plan, status, billing_cycle, amount_try::text as amount_try, price_lock_try::text as price_lock_try, price_lock_campaign, " +
    "extra_seats, current_period_start::text as period_start, current_period_end::text as period_end from public.subscriptions where tenant_id = $1::uuid",
  periodExtended:
    "select s.current_period_end = ($2::timestamptz + interval '1 month') as ok, s.current_period_end::text as period_end " +
    "from public.subscriptions s where s.tenant_id = $1::uuid",
  invoiceState: "select status, checkout_status, total_try::text as total_try from public.invoices where id = $1::uuid",
  eventCount: "select count(*)::int as n from public.billing_fulfillment_events where provider = 'demo' and conversation_id = $1",
  tenantPlan: "select plan, status from public.tenants where id = $1::uuid",
  setPriceLock:
    "update public.subscriptions set amount_try = $2::numeric, price_lock_try = $3::numeric, price_lock_campaign = $4 where tenant_id = $1::uuid",
  clearPriceLock: "update public.subscriptions set price_lock_try = null, price_lock_campaign = null where tenant_id = $1::uuid",
  updatePlan: "select public.update_tenant_plan_subscription($1::uuid, $2::uuid, $3, 'active') as result",
  // RLS simülasyonu kurulumu (service kimliğiyle, tablo sahibi olarak)
  grantRolePermission:
    "insert into public.tenant_role_permissions (tenant_id, role, module, action, allowed) values ($1::uuid, $2, $3, $4, true) " +
    "on conflict (tenant_id, role, module, action) do update set allowed = true",
  insertProperty:
    "insert into public.properties (id, tenant_id, property_code, title, transaction_type, property_type, status, created_by, assigned_to) " +
    "values ($1::uuid, $2::uuid, $3, $4, 'Satılık', 'Daire', 'draft', $5::uuid, $6::uuid)",
  insertOwnerInfo:
    "insert into public.property_owner_info (tenant_id, property_id, created_by, deed_note) values ($1::uuid, $2::uuid, $3::uuid, 'prova')",
  // authenticated (danışman) olarak
  whoAmI: "select public.current_tenant_id()::text as tenant_id, public.current_profile_role() as role",
  approvalInsert:
    "insert into public.approval_requests (id, tenant_id, kind, title, status, requested_by) values ($4::uuid, $1::uuid, 'diger', 'prova talebi', $2, $3::uuid)",
  approvalSelfDecide: "update public.approval_requests set status = 'onaylandi' where id = $1::uuid",
  approvalStatus: "select status from public.approval_requests where id = $1::uuid",
  poolInsert:
    "insert into public.listing_pool_entries (tenant_id, property_id, source, status, created_by, claim_open_until) " +
    "values ($1::uuid, $2::uuid, 'manual', 'pending', $3::uuid, case when $4::boolean then now() + interval '30 days' else null end)",
  kvkkInsert:
    "insert into public.kvkk_requests (tenant_id, request_type, status, created_by) values ($1::uuid, $2, 'open', $3::uuid)",
  ownerInfoNote: "update public.property_owner_info set deed_note = 'prova-guncel' where property_id = $1::uuid",
  ownerInfoMove: "update public.property_owner_info set property_id = $2::uuid where property_id = $1::uuid",
  ownerInfoProperty: "select count(*)::int as n from public.property_owner_info where property_id = $1::uuid",
} as const;

/** Katalogdaki TÜM SQL metinleri (sözleşme testi ve statik ayrıştırma için). */
export function allCatalogSql(): string[] {
  const out: string[] = [
    ...Object.values(TX),
    ...Object.values(FN),
    ...Object.values(HELPERS),
    ...Object.values(SMOKE),
  ];
  for (const spec of Object.values(FILE_CHECKS)) {
    if (spec.pre) out.push(spec.pre.sql);
    for (const c of spec.post) out.push(c.sql);
  }
  // EF dosya kontrolleri FILE_CHECKS üzerinden zaten eklendi; burada yalnız EF smoke/RLS sorguları.
  for (const sql of allEfCatalogSql()) if (!out.includes(sql)) out.push(sql);
  return out;
}
