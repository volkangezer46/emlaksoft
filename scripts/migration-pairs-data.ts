/**
 * Yayin penceresi verisi: hangi migration hangi pencerede, hangileri BIRLIKTE uygulanir, etki sinifi.
 * Mantik: `migration-pairs.ts` (saf, testli). Kilavuz: `docs/runbooks/YAYIN_PENCERESI.md` (P1-P12) ve
 * `docs/runbooks/YAYIN_PENCERESI_2.md` (2026-10-05 terfi eden 13 migration + P12 en sonda).
 *
 * Yeni bir uygulanmamis migration eklenirse BURAYA da eklenmelidir (etki sinifi + pencere); aksi halde
 * `npm run check:migration-pairs` "etki-sinifi-yok / pencere-yok" hatasi verir. Bu dosya SQL'e dokunmaz.
 */
import type { GroupSpec } from "../src/lib/migration-pairs";

/**
 * Pencere modelinin TABANI: bundan buyuk surumler bu aracta "uygulanmamis" sayilir (etki sinifi/pencere zorunlu).
 * GERCEK CANLI DURUM (2026-10-05, docs/HAFIZA.md §2): 20260814000100..20260824001300 arasindaki 41 dosyanin 40'i
 * UYGULANDI (P1-P11b); yalniz 20260816000500 (P12, kazanc gizliligi) bekliyor. 20260825000100..001300 (2026-10-05
 * proposed/'dan terfi) HIC uygulanmadi. Taban bilerek 20260813000300'de birakildi: P12 dosyasi daha kucuk numarali
 * oldugu icin taban ilerletilirse bu arac onu "uygulanmis" sanar. Uygulanan pencereler basliklarinda isaretlidir;
 * kesin bekleyen listesi icin salt-okunur `npm run db:migrate -- --dry-run` esastir.
 * GUNCELLEME (sahip bildirimi): PB1..PB8 (20260825000100..001300) ve P12 (20260816000500) de CANLIDA UYGULANDI.
 * Bekleyen tek pencere PB9-ef-kontor (20260826000100..000300). Taban bu aracta bilerek ilerletilmedi (pencere
 * sirasi/bagimlilik denetimi gecmis pencereler icin de calismaya devam etsin); kesin liste yine --dry-run.
 */
export const APPLIED_HEAD = "20260813000300";

/** `scripts/validate-migrations.ts` icindeki donmus tarihsel cakismalar (uygulanmis ledger'lar). */
export const LEGACY_MIGRATION_VERSIONS = ["20260726000058", "20260727000108"] as const;

const F = {
  phone: "20260814000100_international_phone_constraints.sql",
  lossSeed: "20260815000100_loss_reason_stage_label_definitions.sql",
  earningsPerm: "20260816000100_earnings_all_permission_defaults.sql",
  splits: "20260816000200_commission_splits.sql",
  plans: "20260816000300_advisor_commission_plans.sql",
  payouts: "20260816000400_commission_payouts.sql",
  earningsPrivacy: "20260816000500_commission_earnings_privacy.sql",
  demandCols: "20260816000600_customer_demand_structured_columns.sql",
  demandRpc: "20260816000700_create_customer_with_demand_rpc.sql",
  targets: "20260816000800_targets_activity_goals.sql",
  assignRules: "20260816000900_assignment_rules.sql",
  profileScope: "20260816001000_profiles_title_visibility_scope.sql",
  campaignClaim: "20260816001100_campaign_claim_legacy_whatsapp_fix.sql",
  assignListing: "20260816001200_assignment_rules_listing_target.sql",
  advisorPrivate: "20260816001300_advisor_profiles_private.sql",
  advisorSpecialties: "20260816001400_advisor_specialties_regions.sql",
  listingPool: "20260816001500_listing_pool.sql",
  sampleScope: "20260816001600_sample_data_scope_extension.sql",
  tenantModules: "20260816001700_tenant_modules.sql",
  seo404: "20260816001790_seo_404_hits.sql",
  trialDays: "20260816010100_default_trial_days_setting.sql",
  revokeSessions: "20260816010200_platform_revoke_user_sessions.sql",
  planBusiness: "20260817000210_plan_business_and_pricing_support.sql",
  priceLock: "20260817000220_subscription_price_lock.sql",
  coupons: "20260817000230_coupons.sql",
  k5Subs: "20260819010500_k5_account_subscription_branches.sql",
  k5Kvkk: "20260819010600_k5_kvkk_requests.sql",
  ownerInfo: "20260819020100_property_owner_info.sql",
  poolFlags: "20260819020200_listing_pool_profile_flags.sql",
  oversight: "20260820000100_oversight_center.sql",
  neighborhood: "20260821000100_neighborhood_notes.sql",
  ledger: "20260821000200_compliance_ledger.sql",
  docRequests: "20260821000300_document_requests.sql",
  sec3Approval: "20260823000100_sec3_approval_requests_rls.sql",
  sec3Pool: "20260823000200_sec3_listing_pool_insert_claim_guard.sql",
  sec3Kvkk: "20260823000300_sec3_kvkk_requests_role_guard.sql",
  sec3Owner: "20260823000400_sec3_property_owner_info_update_scope.sql",
  sec3Advisor: "20260823000500_sec3_advisor_private_pii_format_guard.sql",
  sec3Coupon: "20260823000600_sec3_coupon_max_per_tenant.sql",
  p5Notes: "20260824001100_p5_neighborhood_notes_owner_scope.sql",
  p5DocReq: "20260824001200_p5_document_requests_write_scope.sql",
  p5Revoke: "20260824001300_p5_service_rpc_revoke_anon_authenticated.sql",
  k4IsDocument: "20260818000400_property_media_is_document.sql",
  // 2026-10-05: supabase/proposed/ taslaklarindan TERFI (eski ad -> yeni ad, YAYIN_PENCERESI_2.md tablosu).
  // Sira bagimliliga gore: fiyat butunlugu -> (koltuk kilidi) -> duraklatma/extra_seats (D'siz) -> koltuk satisi.
  ownerLink: "20260825000100_properties_owner_customer_link.sql", // eski 20261005000100
  geo: "20260825000200_geo_central_management.sql", // eski 20261005000600
  billingAmount: "20260825000300_billing_plan_amount_integrity.sql", // eski 20261005000500
  seatPriceLock: "20260825000400_subscription_seat_price_lock.sql", // eski 20261005000400
  billingPauseSeats: "20260825000500_billing_pause_proration_business_seats.sql", // eski 20261005000800 (D cikarildi)
  seatFulfillment: "20260825000600_seat_purchase_fulfillment.sql", // eski 20261005000900
  survey: "20260825000700_survey_module.sql", // eski 20260820010000
  growthReferral: "20260825000800_growth_referral_partner_attribution.sql", // eski 20260819000100
  growthClicks: "20260825000900_growth_click_counters.sql", // eski 20260822000100
  aiCredit: "20260825001000_ai_credit_metering.sql", // eski 20260820000300
  vitrinSettings: "20260825001100_tenant_vitrin_settings.sql", // eski 20260816060100
  vitrinSeo: "20260825001200_tenant_vitrin_sections_seo_optin.sql", // eski 20260819010700
  ownership: "20260825001300_ownership_transfers.sql", // eski 20261005000700
  // EmlakFiyati kontor kumesi (YAYIN_PENCERESI_2.md §7; prova: db:rehearse --ef). Hic UYGULANMADI.
  efWallet: "20260826000100_ef_credit_wallet.sql",
  efReports: "20260826000200_ef_reports.sql",
  efPack: "20260826000300_ef_credit_pack_fulfillment.sql",
  // TL hesap kredisi (birim try) + fatura odemesi. Hic UYGULANMADI; 000100'den (source CHECK refund/bonus) SONRA.
  tryWallet: "20260826000400_try_credit_wallet.sql",
  tryInvoice: "20260826000500_try_credit_invoice_payment.sql",
  growthEngine: "20260826000600_growth_referral_engine.sql",
  paymentCards: "20260826000700_payment_cards.sql",
  // Varsayilan program ayarlari (yalniz veri seed; sema yok). 000600 SONRASI.
  defaultProgram: "20260826000800_default_program_settings.sql",
  growthHotfix: "20260826000900_growth_hotfix.sql",
  // Ofis buyume RPC rol kapisi (owner/gm). 000600 SONRASI.
  growthDashboardRoles: "20260826001000_growth_dashboard_roles.sql",
  // Plan kontor degerleri (veri; yalniz dokunulmamis degerleri ceker). 000800 SONRASI.
  efPlanCreditValues: "20260826001100_ef_plan_credit_values.sql",
  // EF plan kontoru devir tavani (ef_credit_expire_plan) + hos geldin ayar seed'i. 000100 SONRASI.
  efPlanExpiry: "20260826001200_ef_plan_credit_expiry.sql",
  // EF mutabakat calistirma kaydi (yeni tablo; yalniz ek). 000100 SONRASI.
  efReconciliationRuns: "20260826001300_ef_reconciliation_runs.sql",
  // customer_lead_signals(uuid, uuid[]) asiri yuklemesi (yalniz ekler; eski imza kalir).
  leadSignalsByIds: "20260826001400_customer_lead_signals_by_ids.sql",
  // Bildirim dedupe anahtari (nullable kolon + kismi benzersiz indeks; yalniz ek).
  notificationsDedupeKey: "20260826001500_notifications_dedupe_key.sql",
  // Muhasebe rolu expenses VIEW varsayilani (yalniz VERI seed). permission_defaults'a bagli (temel).
  accountingExpensesView: "20260826001700_accounting_expenses_view.sql",
  // tenants.license_title / license_valid_until (yalniz iki nullable sutun).
  tenantLicenseDetails: "20260826001800_tenant_license_details.sql",
  // growth_my_dashboard B12 geri getirme (001000, 000900 duzeltmesini ezdi). 000900 + 001000 SONRASI.
  growthDashboardB12Reapply: "20260826001900_growth_dashboard_b12_reapply.sql",
  // Ayar Kayit Defteri: settings_history (append-only), tenant_settings, platform_settings guard (version + bypass tetikleyici), write_setting RPC.
  settingsHistory: "20260826002100_settings_history.sql",
  tenantSettings: "20260826002200_tenant_settings.sql",
  platformSettingsGuard: "20260826002300_platform_settings_guard.sql",
  writeSettingRpc: "20260826002400_write_setting_rpc.sql",
  // Portfoy-Ilan Yasam Dongusu ve Kayip/Kacak Denetimi (WP-2..7): portal ilan zinciri, kapsam yardimcilari, kontrol tablolari/RPC'leri.
  lcPortalChain: "20260826002000_lc_portal_listing_chain.sql",
  lcScopeHelpers: "20260826002010_lc_scope_helpers.sql",
  lcVerificationTables: "20260826002020_lc_verification_tables.sql",
  lcAnomalyTables: "20260826002030_lc_anomaly_tables.sql",
  lcControlState: "20260826002040_lc_property_control_state.sql",
  lcQueueRpcs: "20260826002050_lc_queue_and_check_rpcs.sql",
  lcAnomalyRpcs: "20260826002060_lc_anomaly_rpcs.sql",
  lcSummaryMarket: "20260826002070_lc_summary_rpcs_market_view.sql",
  // Ilan kontrol: tarayici destekli dogrulama RPC'leri (kullanici JWT'si) + olay gunlugu + Realtime yayini.
  lcWorkerEvents: "20260826002800_lc_worker_events_realtime.sql",
  // Zeka katmani (Insight Engine): icgoru kuyrugu (yeni tablo + set_state RPC), platform ikizi, olgu RPC/gorunum/temizlik.
  insights: "20260826002500_insights.sql",
  platformInsights: "20260826002600_platform_insights.sql",
  insightSupport: "20260826002700_insight_support.sql",
  // Takim modeli: teams + profiles.team_id + properties.assigned_at (ilan kontrol takim lideri kapsami/SLA alicisi).
  takimTeams: "20260826002900_takim_teams.sql",
  // H2/H3/H6 (Ekim 2026 ozellik arastirmasi): EIDS tasinmaz no, kiraci hatirlatma, kiralama-sozlesme baglantisi.
  propertyEidsNo: "20260826002950_property_eids_no.sql",
  rentReminders: "20260826002960_rent_reminders.sql",
  contractRentalLink: "20260826002970_contract_rental_link.sql",
  // Kurumsal rol tabanlı erişim kontrol + kapsam sistemi (danışman kısıtlaması, veri seviyesi kontrol).
  userScopes: "20261006000100_user_scopes.sql",
  scopeOverrides: "20261006000101_scope_overrides.sql",
  accessAuditLog: "20261006000102_access_audit_log.sql",
  hasScopeRpc: "20261006000103_has_permission_with_scope_rpc.sql",
} as const;

export const MIGRATION_GROUP_SPEC: GroupSpec = {
  appliedHead: APPLIED_HEAD,

  // (c) Etki sinifi: ek = yalniz ekler · davranis = mevcut davranisi/veriyi degistirir · siki = RLS/kisit sikilasir
  impact: {
    [F.phone]: "davranis", // CHECK gevser + public booking RPC yeniden tanimlanir
    [F.lossSeed]: "ek",
    [F.earningsPerm]: "ek",
    [F.splits]: "ek",
    [F.plans]: "ek",
    [F.payouts]: "ek",
    [F.earningsPrivacy]: "davranis", // KAZANC GIZLILIGI: komisyon gorunurlugu daralir
    [F.demandCols]: "ek",
    [F.demandRpc]: "ek",
    [F.targets]: "ek",
    [F.assignRules]: "ek",
    [F.profileScope]: "ek", // yeni sutun + kucuk guard trigger (yalniz kapsam sutunu)
    [F.campaignClaim]: "davranis", // bozuk WhatsApp kampanyalari failed olur + fonksiyon yeniden tanimi
    [F.assignListing]: "ek",
    [F.advisorPrivate]: "ek",
    [F.advisorSpecialties]: "ek",
    [F.listingPool]: "ek",
    [F.sampleScope]: "ek",
    [F.tenantModules]: "ek",
    [F.seo404]: "ek",
    [F.trialDays]: "davranis", // deneme gunu tek kaynak; kayit/demo donusumu fonksiyonlari etkilenir
    [F.revokeSessions]: "ek",
    [F.planBusiness]: "ek",
    [F.priceLock]: "ek",
    [F.coupons]: "ek",
    [F.k5Subs]: "ek",
    [F.k5Kvkk]: "ek",
    [F.ownerInfo]: "ek",
    [F.poolFlags]: "ek",
    [F.oversight]: "ek",
    [F.neighborhood]: "ek",
    [F.ledger]: "ek",
    [F.docRequests]: "ek",
    [F.sec3Approval]: "siki",
    [F.sec3Pool]: "siki",
    [F.sec3Kvkk]: "siki",
    [F.sec3Owner]: "siki",
    [F.sec3Advisor]: "siki", // CHECK kisitlari; mevcut satir uymuyorsa uygulama hata verir
    [F.sec3Coupon]: "siki",
    [F.p5Notes]: "siki", // mahalle notu sahip/yonetici kapsami; yonetici olmayan baskasinin notunu silemez
    [F.p5DocReq]: "siki", // evrak linki: authenticated UPDATE yalniz iptal (active -> revoked)
    [F.p5Revoke]: "siki", // increment_listing_view / increment_referral_click: anon+authenticated EXECUTE geri alinir
    [F.k4IsDocument]: "ek",
    // 2026-10-05 terfi edenler
    [F.ownerLink]: "ek", // nullable sutun + FK + ayni-ofis trigger'i (yalniz owner_customer_id yazilinca calisir)
    [F.geo]: "ek", // yeni geo_* tablolari/sutunlari + service_role RPC'leri; ofis bildirimi INSERT'i durum alanlarini kilitler
    [F.billingAmount]: "davranis", // fulfill/plan RPC tutarlari plan tanimindan; admin plan degisimi tutari korur
    [F.seatPriceLock]: "ek", // iki nullable sutun
    [F.billingPauseSeats]: "ek", // D bolumu CIKARILMIS halde: sutunlar + yeni RPC'ler + effective_seat_limit
    [F.seatFulfillment]: "davranis", // koltuk tetikleyicileri extra_seats'i sayar; fulfill extra_seats faturasini isler
    [F.survey]: "ek", // yeni anket tablolari + permission_defaults seed (on conflict do nothing)
    [F.growthReferral]: "ek", // yeni growth_* tablolari + hesap kredisi defteri (yazma yalniz service_role)
    [F.growthClicks]: "ek", // sayac tablosu + service_role RPC
    [F.aiCredit]: "ek", // defter sutun/kisit genisletme + service_role RPC; olcum kodda etkinlesir
    [F.vitrinSettings]: "ek", // varsayilanlar bugunku davranis (vitrin acik, telefon gorunur)
    [F.vitrinSeo]: "davranis", // sitemap opt-in kaynagi elle listeden sutuna gecer (hepsi false dogar)
    [F.ownership]: "ek", // yeni tablo + 3 service_role RPC (kod henuz yok)
    [F.efWallet]: "ek", // defter CHECK genisler ('ef' + kaynaklar) + nullable meta + rezerv tablosu + 7 service_role RPC; mevcut satir/davranis ayni
    [F.efReports]: "ek", // yeni tablo (yazma yalniz service_role, okuma kendi/owner-gm)
    [F.efPack]: "davranis", // fulfill + v2 tam govde yeniden tanimi: credit_pack faturasi islenir (taban govde bayt bayt korunur)
    [F.tryWallet]: "ek", // yalniz try satirlarini kisitlayan CHECK + rezerv tablosu + view + service_role RPC'ler; mevcut satir/davranis ayni
    [F.tryInvoice]: "ek", // yeni service_role fonksiyonlari (fulfill govdelerine DOKUNMAZ; icerden cagirir)
    [F.growthEngine]: "ek", // yeni tablolar + RPC; 000800 (uygulanmamis) tablolarinin tekillik/CHECK/sutunlarini genisletir; fulfill govdelerine DOKUNMAZ; bayraklar KAPALI
    [F.defaultProgram]: "davranis", // yalniz VERI seed: referans bayragi ACIK, hos geldin 300 TL, katalog kaydi, EF paketleri; mevcut admin degerleri korunur
    [F.growthHotfix]: "davranis", // yalniz fonksiyon govdeleri (CREATE OR REPLACE, md5 korumali) + seed kural satiri; sema/bayrak DEGISMEZ; acik programin guvenlik denetimi duzeltmeleri (B1-B3, B9-B12, B16)
    [F.efPlanCreditValues]: "davranis", // yalniz VERI: billing.plan_definitions icinde dokunulmamis efCreditsPerExtraSeat/efCreditsMonthly onerilene cekilir; admin degerleri korunur
    [F.accountingExpensesView]: "davranis", // yalniz VERI: accounting/expenses/view varsayilan izni (idempotent, kullanici istisnalarina dokunmaz)
    [F.tenantLicenseDetails]: "ek", // tenants'a 2 nullable sutun (yetki belgesi unvani/gecerlilik); kod sutunlar yokken zarifce atlar
    [F.efReconciliationRuns]: "ek", // yeni tablo (yazma yalniz service_role, okuma platform personeli); kod tablo yokken zarifce atlar
    [F.settingsHistory]: "ek", // yeni append-only tablo (settings_history); kod tablo yokken zarifce atlar
    [F.tenantSettings]: "ek", // yeni tablo (tenant_settings); kod tablo yokken zarifce atlar
    [F.platformSettingsGuard]: "davranis", // platform_settings: version/schema_version kolonlari + dogrudan yazimi settings_history'ye isleyen tetikleyici (deger ayni, yazim yolu degismez)
    [F.writeSettingRpc]: "ek", // yeni service_role RPC write_setting (atomik deger + gecmis); kod RPC yokken eski upsert yoluna duser
    [F.growthDashboardB12Reapply]: "davranis", // growth_my_dashboard: 000900 B12 govdesi + 001000 rol kapisi (owner/gm degilse NULL); partner_dashboard dokunulmaz (md5 korumali)
    [F.insights]: "ek", // yeni insights tablosu (RLS: alici kendi + owner/gm ofis; yazma yalniz service_role) + insight_set_state RPC; kod tablo yokken bos dizi doner
    [F.platformInsights]: "ek", // yeni platform_insights tablosu + platform_insight_set_state RPC (kod henuz uretmez; sema)
    [F.insightSupport]: "ek", // yalniz service_role olgu RPC'leri + insight_rule_quality gorunumu + temizlik fonksiyonu; tablo/veri degismez
    [F.growthDashboardRoles]: "davranis", // growth_my_dashboard/partner_dashboard yalniz owner/gm icin veri doner (digerlerine NULL); govdeler aksi ayni
    [F.leadSignalsByIds]: "ek", // yeni asiri yukleme customer_lead_signals(uuid, uuid[]); eski imza ve yetkiler ayni, istemci yoksa eskiye duser
    [F.efPlanExpiry]: "ek", // yeni service_role RPC (ef_credit_expire_plan) + source CHECK'e 'expire' + ayar seed'i; mevcut satir/davranis ayni
    [F.paymentCards]: "ek", // yeni 2 tablo + service_role RPC; kod tablolar yokken zarifce kapali (kart saklama + otomatik yenileme altyapisi)
    [F.notificationsDedupeKey]: "ek", // nullable dedupe_key kolonu + kismi benzersiz indeks; mevcut satir/davranis ayni, kod kolon yokken eski davranisa duser
    [F.lcPortalChain]: "davranis", // portal_listings: yeni kolonlar + (ofis, portal, ilan no) acik tekil indeksi (yinelenen canli satir varsa DURUR) + 'superseded' durumu + bind/rotate service_role RPC'leri
    [F.lcScopeHelpers]: "ek", // lc_row_visible/lc_current_*_id yardimcilari + oversight_settings.listing_control jsonb kolonu
    [F.lcVerificationTables]: "ek", // portal_listing_health, listing_verifications, listing_verification_jobs, verification_clients (yazma yalniz service_role)
    [F.lcAnomalyTables]: "ek", // listing_anomalies/actions, listing_sla_events, listing_matching_candidates (yazma yalniz service_role/RPC)
    [F.lcControlState]: "ek", // property_control_state (turetilmis asama/skor/KPI bayraklari)
    [F.lcQueueRpcs]: "ek", // kuyruk talep/hasat + supheli->onayli kayip durum makinesi RPC'leri (portal_listings'e YAZMAZ)
    [F.lcAnomalyRpcs]: "ek", // anomali esitleme/SLA yukseltme (service_role) + acikla/kapat (authenticated, JWT'den)
    [F.lcSummaryMarket]: "ek", // KPI/liste/dunden-beri RPC'leri (invoker) + property_status_history'ye 2 nullable kolon + anonim agregat gorunum (service_role)
    [F.takimTeams]: "ek", // teams (yeni tablo+RLS) + profiles.team_id / properties.assigned_at (nullable) + 2 tetikleyici; veri degismez
    [F.propertyEidsNo]: "ek", // properties'e 1 nullable sutun (eids_property_no) + format CHECK + kismi indeks
    [F.rentReminders]: "ek", // rent_reminder_settings (KAPALI dogar) + rent_reminders (dedupe) + customers'a opt-out sutunlari
    [F.contractRentalLink]: "ek", // contracts'a 3 nullable sutun (rental_id composite FK, artis maddesi) + kismi indeks
    [F.lcWorkerEvents]: "ek", // listing_control_events (yeni tablo, Realtime) + 3 tetikleyici (yalniz ilan kontrol tablolari) + 4 authenticated worker RPC
    [F.userScopes]: "ek", // user_scopes (yeni tablo, kapsam tanımı), scope_rules (RLS politikası)
    [F.scopeOverrides]: "ek", // scope_overrides (yeni tablo, istisna kayıtları)
    [F.accessAuditLog]: "ek", // access_audit_log (yeni tablo, denetim günlüğü)
    [F.hasScopeRpc]: "ek", // 4 RPC: current_user_scope, current_user_team_id, current_user_branch_id, has_permission_with_scope (yalniz ekler)
  },

  // Pencereler yayin sirasidir (order artan). Her pencere --only ile dosya dosya uygulanir.
  windows: [
    { id: "P1-duzeltme", order: 1, title: "(UYGULANDI) Davranis duzeltmesi: telefon CHECK + kampanya claim", files: [F.phone, F.campaignClaim] },
    { id: "P2-seed", order: 2, title: "(UYGULANDI) Seed: kayip nedeni + earnings_all izin varsayilani", files: [F.lossSeed, F.earningsPerm] },
    {
      id: "P3-komisyon-temel",
      order: 3,
      title: "(UYGULANDI) Komisyon/talep/atama temeli (yalniz ekler)",
      files: [F.splits, F.plans, F.payouts, F.demandCols, F.demandRpc, F.targets, F.assignRules, F.profileScope],
    },
    {
      id: "P4-altyapi",
      order: 4,
      title: "(UYGULANDI) Moduller, SEO 404, oturum kapatma, deneme gunu, plan/fiyat kilidi, ornek veri kapsami",
      files: [F.sampleScope, F.tenantModules, F.seo404, F.trialDays, F.revokeSessions, F.planBusiness, F.priceLock],
    },
    { id: "P5-kupon", order: 5, title: "(UYGULANDI) Kuponlar + kupon tenant siniri", files: [F.coupons, F.sec3Coupon] },
    { id: "P6-k5-kvkk", order: 6, title: "(UYGULANDI) K5 abonelik/sube + KVKK talepleri + rol kapisi", files: [F.k5Subs, F.k5Kvkk, F.sec3Kvkk] },
    {
      id: "P7-danisman-profil",
      order: 7,
      title: "(UYGULANDI) Danisman profili/ozel kimlik + PII bicim kisiti",
      files: [F.advisorPrivate, F.advisorSpecialties, F.sec3Advisor],
    },
    {
      id: "P8-ilan-havuzu",
      order: 8,
      title: "(UYGULANDI) Atama kurali ilan hedefi + ilan havuzu + insert/claim korumasi",
      files: [F.assignListing, F.listingPool, F.poolFlags, F.sec3Pool],
    },
    { id: "P9-ilan-sahibi", order: 9, title: "(UYGULANDI) Ilan sahibi bilgisi + guncelleme kapsami", files: [F.ownerInfo, F.sec3Owner] },
    { id: "P10-ofis-kontrol", order: 10, title: "(UYGULANDI) Ofis kontrol merkezi + onay istekleri RLS", files: [F.oversight, F.sec3Approval] },
    { id: "P11-f-modulleri", order: 11, title: "(UYGULANDI) Mahalle notlari, yasal kayit defteri, evrak linkleri", files: [F.neighborhood, F.ledger, F.docRequests, F.p5Notes, F.p5DocReq] },
    { id: "P11b-sayac-revoke", order: 11.5, title: "(UYGULANDI) Servis RPC sayaclari: anon/authenticated EXECUTE revoke", files: [F.p5Revoke] },
    { id: "PK4-is-document", order: 13, title: "K4 is_document (dal main'e girerse): migration KODDAN ONCE", files: [F.k4IsDocument] },
    // ---- 2026-10-05 terfi: YAYIN_PENCERESI_2.md sirasi (PB1..PB8 UYGULANDI; PB9 BEKLIYOR) ----
    { id: "PB1-malik-baglantisi", order: 14, title: "Malik-musteri baglantisi (properties.owner_customer_id, ikinci properties->customers FK)", files: [F.ownerLink] },
    { id: "PB2-cografya", order: 15, title: "Cografya tek merkez yonetimi (surum, alias, ofis bildirimi, birlestir/tasi RPC)", files: [F.geo] },
    {
      id: "PB3-faturalama-koltuk",
      order: 16,
      title: "Fiyat butunlugu -> koltuk fiyat kilidi -> duraklatma/extra_seats (D'siz) -> koltuk satisi fulfill",
      files: [F.billingAmount, F.seatPriceLock, F.billingPauseSeats, F.seatFulfillment],
    },
    { id: "PB4-anket", order: 17, title: "Anket modulu (anketor kuyrugu) + permission_defaults seed", files: [F.survey] },
    { id: "PB5-buyume", order: 18, title: "Organik buyume: referral/ortak/atif/hesap kredisi defteri + tiklama sayaci", files: [F.growthReferral, F.growthClicks] },
    { id: "PB6-ai-kredi", order: 19, title: "AI kredi olcumu (ayni hesap kredisi defteri)", files: [F.aiCredit] },
    { id: "PB7-vitrin", order: 20, title: "Vitrin ayarlari + bolumler/SEO opt-in (sitemap kaynagi degisir)", files: [F.vitrinSettings, F.vitrinSeo] },
    { id: "PB8-sahiplik-devri", order: 21, title: "Ofis sahipligi devri (tablo + service_role RPC)", files: [F.ownership] },
    {
      id: "PB9-ef-kontor",
      order: 22,
      title: "EmlakFiyati kontor: cuzdan (ef birimi + rezerv + RPC) -> ef_reports -> kontor paketi faturasi (fulfill/v2)",
      files: [F.efWallet, F.efReports, F.efPack],
    },
    {
      id: "PB10-tl-kredi",
      order: 23,
      title: "TL hesap kredisi: cuzdan (try birimi + rezerv + RPC) -> kredi ile fatura odemesi (fulfill/v2'yi icerden cagirir)",
      files: [F.tryWallet, F.tryInvoice],
    },
    {
      id: "PB11-referans-motoru",
      order: 24,
      title: "Referans/ortak motoru: talep uretimi, odul (TL kredi), clawback, inceleme kuyrugu, ortak komisyonu (bayraklar KAPALI)",
      files: [F.growthEngine],
    },
    { id: "PB12-kayitli-kart", order: 25, title: "Kayitli odeme karti (iyzico kart saklama; saglayici anahtari + maskeli alan)", files: [F.paymentCards] },
    { id: "PB13-varsayilan-program", order: 26, title: "Varsayilan program ayarlari seed (referans kurali/ayarlari, bayraklar, katalog kaydi, EF paketleri)", files: [F.defaultProgram] },
    {
      id: "PB14-buyume-hotfix",
      order: 27,
      title: "Buyume motoru guvenlik hotfix'i (ilk-N sayaci, bekleme/aktiflik kapisi, hos geldin kredisi ilk odemede, chargeback, kademe bonusu, panel gizliligi, davet onizleme)",
      files: [F.growthHotfix],
    },
    { id: "PB15-buyume-rol-kapisi", order: 28, title: "Ofis buyume RPC rol kapisi (growth_my_dashboard/partner_dashboard yalniz owner/gm)", files: [F.growthDashboardRoles] },
    { id: "PB17-ef-plan-kontor", order: 29, title: "Plan kontor degerleri (ek kullanici basi 5/6/6/6, Business 240; yalniz dokunulmamis kayit)", files: [F.efPlanCreditValues] },
    { id: "PB18-ef-plan-kontor-devir", order: 29.3, title: "EF plan kontoru devir tavani (ef_credit_expire_plan, source expire) + hos geldin ayar seed'i", files: [F.efPlanExpiry] },
    { id: "PB19-ef-mutabakat", order: 29.7, title: "EF kontor gunluk mutabakat kayitlari (ef_reconciliation_runs)", files: [F.efReconciliationRuns] },
    { id: "PB20-lead-signals-idler", order: 29.71, title: "customer_lead_signals(p_tenant_id, p_customer_ids) asiri yuklemesi (1000 satir kesilmesi duzeltmesi; eski imza kalir)", files: [F.leadSignalsByIds] },
    { id: "PB21-bildirim-dedupe", order: 29.72, title: "Bildirim dedupe anahtari (notifications.dedupe_key + kismi benzersiz indeks)", files: [F.notificationsDedupeKey] },
    { id: "PB22-muhasebe-gider-goruntuleme", order: 29.73, title: "Muhasebe rolu gider/aidat (expenses) goruntuleme varsayilani (permission_defaults seed)", files: [F.accountingExpensesView] },
    { id: "PB23-yetki-belgesi-alanlari", order: 29.74, title: "Ofis yetki belgesi unvani + gecerlilik tarihi (tenants, 2 nullable sutun)", files: [F.tenantLicenseDetails] },
    // Kullanici karari (2026-10-05): kazanc gizliligi SIRADA EN SONDA, ayri pencere.
    { id: "PB24-buyume-b12-geri-getirme", order: 29.75, title: "growth_my_dashboard B12 geri getirme (001000 ezmesi duzeltilir: money_visible + yuvarli davet tutari + rol kapisi)", files: [F.growthDashboardB12Reapply] },
    { id: "PB25-ayar-gecmisi", order: 29.76, title: "Ayar Kayit Defteri: settings_history (append-only gecmis)", files: [F.settingsHistory] },
    { id: "PB26-ofis-ayarlari", order: 29.77, title: "Ayar Kayit Defteri: tenant_settings (ofis/sube/kullanici ayar deposu)", files: [F.tenantSettings] },
    { id: "PB27-platform-ayar-korumasi", order: 29.78, title: "Ayar Kayit Defteri: platform_settings version + dogrudan yazim algilama tetikleyicisi", files: [F.platformSettingsGuard] },
    { id: "PB28-ayar-yazma-rpc", order: 29.79, title: "Ayar Kayit Defteri: write_setting RPC (atomik yazim + gecmis)", files: [F.writeSettingRpc] },
    { id: "PB29-ilan-kontrol-zincir", order: 29.80, title: "Ilan kontrol: portal ilan zinciri (supersedes, acik tekil indeks, bind/rotate RPC) + rol kapsami yardimcilari + ofis ayar kolonu", files: [F.lcPortalChain, F.lcScopeHelpers] },
    { id: "PB30-ilan-kontrol-tablolar", order: 29.81, title: "Ilan kontrol: saglik/sonuc/kuyruk/cihaz + anomali/SLA/eslestirme + portfoy kontrol ozeti tablolari", files: [F.lcVerificationTables, F.lcAnomalyTables, F.lcControlState] },
    { id: "PB31-ilan-kontrol-rpc", order: 29.82, title: "Ilan kontrol: kuyruk/durum makinesi + anomali RPC'leri + KPI/liste RPC'leri + anonim agregat gorunum", files: [F.lcQueueRpcs, F.lcAnomalyRpcs, F.lcSummaryMarket] },
    { id: "PB32-icgoru-temeli", order: 29.83, title: "Zeka katmani: icgoru kuyrugu (insights) + platform ikizi + set-tabanli olgu RPC'leri/kalite gorunumu/temizlik (cron insight-engine bunlari kullanir)", files: [F.insights, F.platformInsights, F.insightSupport] },
    { id: "PB33-ilan-kontrol-worker", order: 29.84, title: "Ilan kontrol: tarayici destekli dogrulama RPC'leri + olay gunlugu + Realtime (ana ekran sayaclari)", files: [F.lcWorkerEvents] },
    { id: "PB34-takim-modeli", order: 29.85, title: "Takim modeli: teams + profiles.team_id + properties.assigned_at (ilan kontrol SLA takim lideri alicisi)", files: [F.takimTeams] },
    { id: "PB37-eids-tasinmaz-no", order: 29.88, title: "EIDS tasinmaz kimlik no (properties.eids_property_no, nullable + format CHECK)", files: [F.propertyEidsNo] },
    { id: "PB38-kiraci-hatirlatma", order: 29.89, title: "Kiraci kira hatirlatma (ayar KAPALI dogar + hatirlatma kaydi/dedupe + opt-out)", files: [F.rentReminders] },
    { id: "PB39-kira-sozlesme-baglantisi", order: 29.90, title: "Kiralamadan kira sozlesmesi (contracts.rental_id + artis maddesi alanlari)", files: [F.contractRentalLink] },
    { id: "PB40-kurumsal-yetkilendirme", order: 29.91, title: "Kurumsal rol tabanlı erişim kontrol + kapsam sistemi (danışman kısıtlaması, veri seviyesi)", files: [F.userScopes, F.scopeOverrides, F.accessAuditLog, F.hasScopeRpc] },
    { id: "P12-kazanc-gizliligi", order: 30, title: "AYRI PENCERE (EN SON): kazanc gizliligi RLS", files: [F.earningsPrivacy], separate: true },
  ],

  // (b) Birlikte uygulanmasi gerekenler (duzeltici ana'dan sonra numaralanmis ve ayni pencerede).
  pairGroups: [
    { id: "onay-kapisi", title: "Ofis kontrol (oversight) + approval_requests RLS + onay kapisi", main: [F.oversight], fixes: [F.sec3Approval], window: "P10-ofis-kontrol" },
    { id: "ilan-havuzu", title: "Ilan havuzu + insert/claim korumasi", main: [F.listingPool], fixes: [F.sec3Pool], window: "P8-ilan-havuzu" },
    { id: "kvkk-talepleri", title: "kvkk_requests + rol kapisi", main: [F.k5Kvkk], fixes: [F.sec3Kvkk], window: "P6-k5-kvkk" },
    { id: "ilan-sahibi", title: "property_owner_info + guncelleme kapsami", main: [F.ownerInfo], fixes: [F.sec3Owner], window: "P9-ilan-sahibi" },
    { id: "danisman-ozel", title: "advisor_private + PII biçim kisiti", main: [F.advisorPrivate], fixes: [F.sec3Advisor], window: "P7-danisman-profil" },
    { id: "kuponlar", title: "coupons + max_per_tenant", main: [F.coupons], fixes: [F.sec3Coupon], window: "P5-kupon" },
    { id: "mahalle-notlari", title: "neighborhood_notes + sahip/yonetici kapsami", main: [F.neighborhood], fixes: [F.p5Notes], window: "P11-f-modulleri" },
    { id: "evrak-linkleri", title: "document_requests + yazma kapsami (yalniz iptal)", main: [F.docRequests], fixes: [F.p5DocReq], window: "P11-f-modulleri" },
    {
      id: "koltuk-satisi",
      title: "Fiyat butunlugu (fulfill tabani) + extra_seats/effective_seat_limit + koltuk satisi fulfill/tetikleyiciler",
      main: [F.billingAmount, F.billingPauseSeats],
      fixes: [F.seatFulfillment],
      window: "PB3-faturalama-koltuk",
      note: "20260825000600 on-kosul blogu 20260825000300 fulfill govde md5'ini (a69a7609...) ve 20260825000500 sutun/fonksiyonunu arar; eksikse hicbir sey yazmadan durur. Kod seat_purchase_ready() true olana dek koltuk satmaz.",
    },
    {
      id: "ef-kontor",
      title: "EF cuzdani + raporlar (ana) + kontor paketi fulfill (tamamlayici; ef_credit_grant'i cagirir)",
      main: [F.efWallet, F.efReports],
      fixes: [F.efPack],
      window: "PB9-ef-kontor",
      note: "20260826000300 on-kosulu ef_credit_grant'i ve canli fulfill/v2 govde md5'lerini (20260825000600: 0f5b4589... / 5fc1c655...) arar; eksik/sapma = hicbir sey yazmadan durur. ef_credit_ready() 'credit-pack:v1' isareti olmadan false: kod kontor akisini acmaz.",
    },
  ],

  // [bagimli, onkosul]: kaynak = dosya govdeleri + BIRLESIK_YOL_HARITASI §4.2.
  requires: [
    [F.plans, F.splits],
    [F.payouts, F.splits],
    [F.earningsPrivacy, F.earningsPerm],
    [F.earningsPrivacy, F.splits],
    [F.demandRpc, F.demandCols],
    [F.assignRules, F.splits],
    [F.advisorPrivate, F.splits],
    [F.advisorSpecialties, F.splits],
    [F.assignListing, F.assignRules],
    [F.listingPool, F.assignRules],
    [F.listingPool, F.assignListing],
    [F.listingPool, F.splits],
    [F.ownerInfo, F.splits],
    [F.sec3Pool, F.listingPool],
    [F.sec3Pool, F.assignRules],
    [F.sec3Kvkk, F.k5Kvkk],
    [F.sec3Owner, F.ownerInfo],
    [F.sec3Advisor, F.advisorPrivate],
    [F.sec3Coupon, F.coupons],
    [F.p5Notes, F.neighborhood],
    [F.p5DocReq, F.docRequests],
    // 20260825000300 basligindaki BAGIMLILIK (uygulanmamis olanlar; digerleri canlida). On-kosul blogu da denetler.
    [F.billingAmount, F.trialDays],
    [F.billingAmount, F.planBusiness],
    [F.billingAmount, F.priceLock],
    // Yayin sirasi: D bolumunun yerine gecen tam govde (000300) duraklatma/extra_seats'ten (000500) once.
    [F.billingPauseSeats, F.billingAmount],
    // 20260825000600: fulfill TABANI 000300, extra_seats + effective_seat_limit 000500 (D'siz)
    [F.seatFulfillment, F.billingAmount],
    [F.seatFulfillment, F.billingPauseSeats],
    // Buyume: tiklama sayaci ve AI kredi buyume migration'indan sonra (AI kredi ayni defter tablosunu genisletir).
    [F.growthClicks, F.growthReferral],
    [F.aiCredit, F.growthReferral],
    // Vitrin: bolumler/SEO opt-in, vitrin ayarlarinin tamamlayicisi.
    [F.vitrinSeo, F.vitrinSettings],
    // EF kontor: defter (000800 + 001000 feature/CHECK adlari) -> cuzdan -> raporlar (rezerv FK) -> paket fulfill
    // (ef_credit_grant + 20260825000600 govde tabani).
    [F.efWallet, F.growthReferral],
    [F.efWallet, F.aiCredit],
    [F.efReports, F.efWallet],
    [F.efPack, F.efWallet],
    [F.efPack, F.seatFulfillment],
    [F.efPlanExpiry, F.efWallet],
    [F.efReconciliationRuns, F.efWallet],
    // TL kredi: defter source CHECK'inde refund/bonus + meta (000100) -> cuzdan (000400) -> fatura odeme (000500).
    [F.tryWallet, F.efWallet],
    [F.tryWallet, F.growthReferral],
    [F.tryWallet, F.aiCredit],
    [F.tryInvoice, F.tryWallet],
    // Referans/ortak motoru: growth tablolari + tiklama sayaci + TL cuzdan (try_credit_grant/reverse/ready) SONRASI.
    [F.growthEngine, F.growthReferral],
    [F.growthEngine, F.growthClicks],
    [F.growthEngine, F.tryWallet],
    [F.growthEngine, F.tryInvoice],
    [F.defaultProgram, F.growthEngine],
    [F.growthHotfix, F.growthEngine],
    [F.growthHotfix, F.defaultProgram],
    [F.growthDashboardB12Reapply, F.growthHotfix],
    [F.growthDashboardB12Reapply, F.growthDashboardRoles],
    // Ayar Kayit Defteri: gecmis tablosu -> guard tetikleyicisi (gecmise yazar) -> RPC (ikisine de dayanir).
    [F.platformSettingsGuard, F.settingsHistory],
    [F.writeSettingRpc, F.settingsHistory],
    [F.writeSettingRpc, F.platformSettingsGuard],
    [F.writeSettingRpc, F.tenantSettings],
    // Ilan kontrol: zincir -> kapsam yardimcilari -> tablolar -> RPC'ler.
    [F.lcVerificationTables, F.lcPortalChain],
    [F.lcVerificationTables, F.lcScopeHelpers],
    [F.lcAnomalyTables, F.lcScopeHelpers],
    [F.lcControlState, F.lcScopeHelpers],
    [F.lcQueueRpcs, F.lcVerificationTables],
    [F.lcQueueRpcs, F.lcControlState],
    [F.lcAnomalyRpcs, F.lcControlState],
    [F.lcAnomalyRpcs, F.lcAnomalyTables],
    [F.lcSummaryMarket, F.lcControlState],
    [F.lcSummaryMarket, F.lcAnomalyTables],
    [F.lcSummaryMarket, F.lcVerificationTables],
    [F.lcWorkerEvents, F.lcQueueRpcs],
    [F.lcWorkerEvents, F.lcControlState],
    [F.lcWorkerEvents, F.lcAnomalyTables],
    // Icgoru destek RPC/gorunum/temizlik insights tablosuna baglidir (platform ikizi bagimsiz).
    [F.insightSupport, F.insights],
  ],

  externalPending: [
    {
      file: F.k4IsDocument,
      branch: "worktree-agent-aaa0895d41f425d97 (K4)",
      rule: "migration-once",
      note: "public medya sorgulari is_document sutununa bagli: migration KODDAN ONCE uygulanmali (kod once yayinlanirsa vitrinde gorsel kaybolur).",
    },
  ],
};
