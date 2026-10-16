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
 * GUNCELLEME (2026-10-06 sahip bildirimi): PB9-PB11 (20260826000100..000800), 000900/001000/001100 ve PB40/PB42/PB43/PB44
 * (20261006000100..000600) de CANLIDA. PB46 (20261007000200..000220) CANLIDA (koordinator bildirimi). Depoda bekleyen: PB45 (20261006000700..000720; kesin durum --dry-run), PB48 (20261007000100), PB49 (20261007000400). Taban bu aracta bilerek ilerletilmedi (pencere
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
  // Ofis Merkezi: office_center permission_defaults seed'i (4. kayit noktasi) + havuzdan atama gecmisi tablosu.
  officeCenterPerms: "20261006000500_office_center_permission_defaults.sql",
  poolAssignments: "20261006000510_pool_assignments.sql",
  // PB40 ile AYNI pencere, 000103'ten SONRA: access_audit_log INSERT politikasi (kullanici istemcisi gunluk yazabilsin).
  accessWritePolicies: "20261006000104_access_control_write_policies.sql",
  // PB42 kabuk/ana ekran hizi: tek-tur kabuk RPC'si + ana ekran anlik goruntu RPC'leri (hepsi SECURITY INVOKER, kod yoksa eski yola duser).
  appShellBootstrap: "20261006000400_app_shell_bootstrap_rpc.sql",
  dashboardSnapshotRpcs: "20261006000410_dashboard_snapshot_rpcs.sql",
  // PB44 self-servis kurulum: ornek veri tek-tus temizleme RPC'si + sihirbaz ofis profili sutunlari (tek dosya).
  purgeSampleRpc: "20261006000600_purge_sample_data_rpc.sql",
  // PB45 bekleyen isler: eski 9 arg fulfill overload temizligi, rapor/komisyon toplulastirmalarinda ornek veri kapsami,
  // ofis sahibinin kendi baslattigi sahiplik devri (JWT kimlikli atomik RPC + ayni islemde denetim kaydi).
  planSubscriptionAmount: "20261006000700_fix_plan_subscription_amount.sql",
  reportingSampleScope: "20261006000710_reporting_aggregates_sample_scope.sql",
  ownershipTransferRpc: "20261006000720_ownership_transfer_rpc.sql",
  // PB48 KVKK P0-9 kalici cozum: property_media.is_document + ad kurali SQL fonksiyonu + INSERT tetikleyicisi.
  // (Eski K4 dalindaki 20260818000400_property_media_is_document HIC main'e girmedi/uygulanmadi; bu dosya onun yerine.)
  mediaIsDocument: "20261007000100_property_media_is_document.sql",
  // PB46 ilan kontrol veri yollari: yasam dongusu gecis kaydi (append-only) -> envanter ice aktarma + eslesme kuyrugu
  // (JWT RPC) -> ilce kirilimi RPC'leri + SLA yeniden acilis duzeltmesi.
  lcLifecycleEvents: "20261007000200_lc_lifecycle_events.sql",
  lcInventoryMatching: "20261007000210_lc_inventory_matching.sql",
  lcDistrictSlaReset: "20261007000220_lc_district_sla_reset.sql",
  // PB47 CRM ozellik turu (2026-10-07): GOS anlasma alanlari.
  dealGosFields: "20261007000300_deal_gos_fields.sql",
  customFields: "20261007000310_custom_fields.sql",
  webhooksApiKeys: "20261007000320_webhooks_api_keys.sql",
  vitrinChatContext: "20261007000330_vitrin_chat_context.sql",
  // PB49 anket sistemi (2026-10-07): kitle x tetik matrisi, otomatik gonderim izi, dusuk puan zinciri, ekip nabzi.
  surveyMatrix: "20261007000400_survey_matrix_channels.sql",
  // PB51 persona turu (2026-10-07): webhook kuyrugu izin kapisi (dogrudan RPC acigi).
  webhookEnqueueGate: "20261007000600_webhook_enqueue_gate.sql",
  // PB51: potansiyel kayip tek kaynak (kayipli kapanis -> closure_loss anomalisi; tetikleyici + uzlastirma).
  closureLossAnomalies: "20261007000610_closure_loss_anomalies.sql",
  // PB51: musteri tek portali yazma kapisi (token'li teklif / randevu erteleme / bakim talebi; anon DEFINER RPC).
  customerPortalRequests: "20261007000620_customer_portal_requests.sql",
  // PB52 kalan isler turu (2026-10-07): gider fisi dosya yukleme turu (yukleme hatti RPC'leri tam govde).
  expenseReceiptUploads: "20261007000700_expense_receipt_uploads.sql",
  // PB52: kira ice aktarma atomik RPC'si (anlasma won + komisyon + aktif kira tek transaction).
  importRentalWithDeal: "20261007000710_import_rental_with_deal.sql",
  // PB52: imza hatirlatmasi kisa baglanti + token acmayan RPC'ler.
  contractSignerReminder: "20261007000720_contract_signer_reminder.sql",
  // PB53 hiz: proxy kapi okumalari (profil + platform personeli + ofis durumu) tek INVOKER RPC.
  proxyGateSnapshot: "20261007000900_proxy_gate_snapshot.sql",
  // Konsey D1 persona KRITIK: vitrin talep formu tokeni her ofiste (varsayilan + NULL doldurma).
  leadCaptureTokenDefault: "20261008000200_lead_capture_token_default.sql",
  // Gorsel QA: giderler aylik trend ay ekseni tarih (UTC kaymasi).
  expenseTrendMonthAxis: "20261008001900_expense_trend_month_axis.sql",
  // Canli hata: 001500/001800 tablo yetkisi yok (tapu sureci adimi yazilamiyor, portal okuyamiyor).
  grantsDealStepsListingAnalyses: "20261009000300_grants_deal_steps_listing_analyses.sql",
  // DB hiz turu (2026-10-09): RLS politikalarinda (select fn()) initplan sarmasi + 11 kopya indeks dususu + rental_kpi_snapshot RPC.
  dbPerfRlsInitplanKpi: "20261009000400_db_perf_rls_initplan_kpi.sql",
  // Ilan kontrol gunluk eklenti taramasi (2026-10-10): tam liste kaniti (expected/read) + aday detayi + lc_inventory_import 12 saat kurali.
  lcDailySync: "20261010000500_listing_control_daily_sync.sql",
  // Konsey #53 (2026-10-11): danisman csv/paste kaynagi assisted, acik kacak sinyali present ile kapanmaz, tam liste kaniti her kaynakta.
  lcInventorySourceHardening: "20261011000700_lc_inventory_import_source_hardening.sql",
  // Hiz turu 2 (2026-10-10): kabuk RPC kisisel gizli modulleri tasir (bir sunucu turu az) + arama icin pg_trgm GIN indeksleri.
  appShellHiddenModules: "20261010000100_app_shell_hidden_modules.sql",
  searchTrgmIndexes: "20261010000200_search_trgm_indexes.sql",
  securityCalendarTokenAuditLogs: "20261010000400_security_calendar_token_audit_logs.sql",
  // Canli hata: {1,512} regex PostgreSQL tekrar siniri (255) asiyor -> esdeger gecerli ifade.
  fixRegexRepetitionLimit: "20261008000900_fix_regex_repetition_limit.sql",
  // Profil fotografi / hazir avatar: profiles + platform_staff sutunlari, avatars kovasi, set_my_avatar RPC.
  profileAvatar: "20261008000500_profile_avatar.sql",
  // Gelir/gider turu (2026-10-08): kategori butcesi + tekrarlayan gider + portal gideri eslemesi.
  expenseBudgetsRecurring: "20261008000700_expense_budgets_recurring_portal.sql",
  // PB53 perf turu 3 (2026-10-07): RLS yardimci fonksiyonlari SQL -> plpgsql (govde birebir, plan onbellegi) + customer_demands indeksi.
  perfIndexesRpc: "20261007001100_perf_indexes_rpc.sql",
  // PB53 guvenlik/rapor turu (2026-10-07): properties fiyat dusurme DB kapisi + price_history salt-okunur; Giderler ornek veri kapsami.
  propertiesPriceDropGuard: "20261007000800_properties_price_drop_db_guard.sql",
  expenseSampleScope: "20261007000810_expense_aggregates_sample_scope.sql",
  // PB55 ilan kontrol eklentisi (2026-10-08): ayristirici telemetri sayaclari (portal/surum/sinif; kisisel veri yok) + yazma RPC.
  lcParserTelemetry: "20261008000400_lc_parser_telemetry.sql",
  // PB53 oransal paket yukseltme + abonelik duraklatma (2026-10-08; her ikisi de VARSAYILAN KAPALI bayrakli).
  subscriptionPause: "20261007001000_subscription_pause_and_plan_change.sql",
  // PB53: fulfill + v2 TAM govde (000300 tabanindan; plan_upgrade faturasi). 001000 sutunlarina bakar.
  planUpgradeFulfillment: "20261007001010_plan_upgrade_fulfillment.sql",
  // Lig 2.0 (2026-10-08): ofis ayarli puan kurallari + meydan okuma tablolari (yeni tablo, varsayilan davranis degismez).
  leagueV2: "20261008000600_league_v2.sql",
  // MOD1 (2026-10-08): danismanin kisisel modul gizlemesi (yeni tablo, yalniz gorunurluk).
  userModulePrefs: "20261008001200_user_module_prefs.sql",
  // P1 fiyatlandirma (2026-10-08): plan_monthly_amount yedek fiyatlari + dokunulmamis EF kontor seed ayarlari. billing.plan_definitions ve abonelik satirlari DEGISMEZ.
  planPricesEfTariff: "20261008001000_plan_prices_ef_credit_tariff.sql",
  // TR1 (2026-10-08): portfoy yetki (EIDS) durumu sutunlari + kuyruk indeksi.
  propertyAuthorityStatus: "20261008001300_property_authority_status.sql",
  // M1 Mulk yonetimi omurgasi (2026-10-08): kira tahsilat kaydi + yonetim sozlesmesi + mulk sahibi hakedis defteri.
  propertyManagementCore: "20261008001100_property_management_core.sql",
  // /admin kontrol paneli toplulastirmalari (2026-10-08): audit/aktivasyon/deneme/iptal/defter sayimlari tek service_role RPC.
  platformDashboardRollups: "20261008001400_platform_dashboard_rollups.sql",
  // Tapu sureci adim takibi (2026-10-08): deal_process_steps (yeni tablo + RLS; kod tablo yokken bolumu etkin degil der).
  dealProcessSteps: "20261008001500_deal_process_steps.sql",
  // M2 Bina & site yonetimi (2026-10-08): bina/daire + donemlik toplu aidat tahakkuku + ortak gider paylastirma + tahsilat + daire cari.
  buildingManagement: "20261008001700_building_management.sql",
  // Finans Paket A (2026-10-10): finance_accounts + cash_entries (kasa/banka/kisisel hesap + para hareket defteri, yazma yalniz RPC).
  financeAccountsCashEntries: "20261010000600_finance_accounts_cash_entries.sql",
  // Ilan analizi (2026-10-08): listing_analyses onbellek tablosu (yeni tablo + RLS; kod tablo yokken analizi "etkin degil" der, kontor dusmez).
  listingAnalyses: "20261008001800_listing_analyses.sql",
  // e-Fatura (2026-10-10, Paket D): einvoice_connections (sifreli kimlik, sutun bazli SELECT) + einvoices + 2 DEFINER RPC; kod tablo yokken bolumu "etkin degil" der.
  einvoice: "20261010000700_einvoice.sql",
  // e-Fatura butunlugu (2026-10-11, Konsey P2): durum makinesi + atomik talep RPC'leri; dogrudan yazma yetkisi kapanir.
  einvoiceStateMachine: "20261011000600_einvoice_state_machine.sql",
  // e-Fatura belirsiz sonuc kurtarma (Konsey Tur 3): issue_stage isareti + kurtarma RPC'leri; 000600'den SONRA.
  einvoiceRecovery: "20261012000100_einvoice_recovery.sql",
  // Finans Paket B (2026-10-10): recurring_rules + recurring_occurrences (duzenli odeme/gelir, idempotent uretim) + recurring_* RPC; kira-tahakkuk cron adimi recurring_run_due'yu cagirir (kod sema yokken adimi atlar).
  recurringRules: "20261010000900_recurring_rules.sql",
  // Finans Paket C (2026-10-11): banka ekstresi taslak tablolari + mutabakat (cash_entries.reconciled_at) + finance_statement_* RPC; kod sema yokken "Ekstre yukle" gizlenir.
  bankStatementImport: "20261011001200_bank_statement_import.sql",
  // Ilan havuzu yeni ofiste varsayilan ACIK + kaynak extension (2026-10-10).
  poolDefaultOn: "20261010000800_listing_pool_default_on.sql",
  // Ana ekran hizi (2026-10-11): home_snapshot (ben/ofis kapsamli ilk ekran okumalari tek tur); kod RPC yokken eski sorgulara duser.
  homeSnapshotRpc: "20261011000200_home_snapshot_rpc.sql",
  // Once goster sonra tazele: cekirdek tablolar supabase_realtime yayinina (ekip degisikligi acik sayfayi tazeler).
  realtimeCoreTables: "20261011000800_realtime_publication_core_tables.sql",
  // Komisyon taraf kimligi (profile_id) + serbest metin esleme + commission_splits esitleme; kasa maas bakiye gizliligi + iptal audit.
  commissionSplitProfile: "20261011001000_commission_split_profile.sql",
  financeSalaryPrivacy: "20261011001100_finance_salary_privacy_void_audit.sql",
  // Konsey Tur 2 P2 (2026-10-11): finance_statement_apply govdesi: recurring eylemi (duzenli odeme tek gerçek) + komisyon tahsil edildi ayni işlemde.
  statementApplyRecurringCommission: "20261011001400_statement_apply_recurring_commission.sql",
  // Konsey Tur 2 #38+#39: komisyon/rapor toplulastirmasi earnings_all kapisi + ekstre satiri hesap/maas suzgeci.
  earningsStatementPrivacy: "20261011001300_earnings_statement_privacy.sql",
  // Konsey Tur 3 (2026-10-12): portal istekleri v2 - gosterim talebi, arayis guncelleme istegi, kiraci "Odedim" bildirimi + malik haftalik rapor anahtari.
  portalRequestsV2: "20261012000200_portal_requests_v2.sql",
  // Konsey #19 (2026-10-12): recurring_run_due hata dizisi (errors) dondurur; cron heartbeat nedeni gorur. 20261010000900 govdesi uzerine yazar.
  recurringRunErrors: "20261012000300_recurring_run_errors.sql",
  // Konsey ertelenen #14+#15 (2026-10-12): finans tablolarina is_sample (hesap, hareket, duzenli odeme kurali, butce) - Gercek kullanima gec temizligi.
  financeIsSample: "20261012000400_finance_is_sample.sql",
  // Analiz dili (2026-10-12): ef.packs seed paket adlari "... kontor" -> "... TL" (yalniz dokunulmamis adlar; veri modeli ayni).
  efPackNamesTl: "20261012000600_ef_pack_names_tl.sql",
  einvoiceServerOnlyWrites: "20261012001000_einvoice_server_only_writes.sql",
  // ARGE-1 (2026-10-12): arama/iletisim kaydi girilince call_priority onerisi aninda kapanir (SECURITY DEFINER RPC; yalniz valid_until).
  insightCloseOnContact: "20261012001600_insight_close_on_contact.sql",
  // HIZ (2026-10-12): liste sayimlari tek RPC (portfolio_counts/task_counts), gorev+belge trigram indeksleri, detay okuma RPC'leri.
  portfolioCountsRpc: "20261012002200_portfolio_counts_rpc.sql",
  searchTrgmTasksDocs: "20261012002210_search_trgm_tasks_docs.sql",
  detailReadRpcs: "20261012002220_detail_read_rpcs.sql",
  // Canli veri (2026-10-12): teklif, kira tahakkuku/odemesi ve anahtar tablolari realtime yayinina eklenir.
  realtimePublicationMore: "20261012002300_realtime_publication_more.sql",
  // FSBO (2026-10-12): Sahibinden ilanlar (portfoy avi) tablolari + prospecting izin varsayilanlari.
  fsboLeads: "20261012002400_fsbo_leads.sql",
  fsboPermissionDefaults: "20261012002410_fsbo_permission_defaults.sql",
  fsboRealtime: "20261012002500_fsbo_realtime.sql",
  fsboRlsScope: "20261012002600_fsbo_rls_scope.sql",
  automationTriggerFsbo: "20261012002510_automation_trigger_fsbo.sql",
  // Portal ice/disa aktarim (2026-10-12): eklentiyle yardimli doldurma oturum kaydi + JWT RPC'leri.
  portalTransferSessions: "20261012002700_portal_transfer_sessions.sql",
  fsboSelectScope: "20261012002800_fsbo_select_scope.sql",
  financeOwnerPayoutSource: "20261012002900_finance_owner_payout_source.sql",
  // DB konseyi (2026-10-13, WP1): RLS InitPlan sarmasi (fsbo/staff/destek), kopya indeks + tenant_id indeksleri,
  // hazirlik yoklamalari pg_catalog. ACL onarimi migration DEGIL (tek seferlik /root/backups/acl-onarim.sql;
  // denetim `npm run check:acl`), bu yuzden 20261013000100 bilerek bos.
  rlsInitplanFsboStaff: "20261013000200_rls_initplan_fsbo_staff.sql",
  tenantIndexesDedupe: "20261013000300_tenant_indexes_dedupe.sql",
  readyProbesPgCatalog: "20261013000400_ready_probes_pg_catalog.sql",
  // AP7 (2026-10-13): platform MRR gunluk anlik goruntusu (yeni tablo; yalniz public.tenants'a FK).
  platformMrrDaily: "20261013001000_platform_mrr_daily.sql",
  // Ogrenen eklenti 0.6.0 (2026-10-13): surumlu imzali kural setleri, oneriler/oylar, gozlem tablolari + JWT/servis RPC'leri.
  portalRulesCore: "20261013002000_portal_rules_core.sql",
  portalRulesRpcs: "20261013002010_portal_rules_rpcs.sql",
  portalRulesLearn: "20261013002020_portal_rules_learn.sql",
  // SP1 (2026-10-13): Buyume Kokpiti birlesik bulgu kuyrugu + optimize edici islem kaydi (yeni tablolar; yalniz service_role).
  siteIssues: "20261013003000_site_issues.sql",
  // SP2 (2026-10-13): platform AI kotasi (SEO AI onerisi + platform danismani; yeni tablo + atomik RPC).
  platformAiQuota: "20261013003100_platform_ai_quota.sql",
  // SP3 (2026-10-13): birinci taraf olcum (cerezsiz sayac + hiz histogrami), kayit atfi genisletmesi, huni RPC'si.
  publicMeasurement: "20261013003200_public_measurement.sql",
  signupAttributionExt: "20261013003210_signup_attribution_ext.sql",
  growthFunnel: "20261013003220_growth_funnel.sql",
  // SP4 (2026-10-13): hiz merkezi laboratuvar olcumleri (yeni tablo; FK yok, yalniz service_role).
  perfLabRuns: "20261013003300_perf_lab_runs.sql",
  // SP6 (2026-10-13): site medya kutuphanesi (ozel site-media kovasi + site_media tablosu; yalniz service_role).
  siteMedia: "20261013003500_site_media.sql",
  // AD7 (2026-10-13): e-posta gonderim gunlugu + saglayici olaylari + bastirma listesi (yalniz service_role) + budama RPC.
  emailLog: "20261013004600_email_log.sql",
  // Onarim (2026-10-13): push_subscriptions defterde var, canlida yoktu; idempotent yeniden kurulum.
  pushSubscriptionsRepairFirst: "20261013006000_push_subscriptions_repair.sql",
  // AD10 (2026-10-13): operasyon ve uyari merkezi (uyari kanal/kural/olay, cron_runs + duraklatma, host_metrics,
  // hata triyaji sutunlari, record_error_occurrence p_release, salt-okunur DB konsolu RPC'leri) + push_subscriptions onarimi.
  opsAlerts: "20261013004900_ops_alerts.sql",
  pushSubscriptionsRepair: "20261013004910_push_subscriptions_repair.sql",
  // AD11 (2026-10-13): denetim izi append-only + ip/ua/once/sonra, destek erisimi gecmisi, yedek/tatbikat, personel oturumlari.
  ad11SecurityHardening: "20261013005000_ad11_security_hardening.sql",
  // AD12 (2026-10-13): surumlu yasal belgeler + yeniden onay kayitlari + tarihli mevzuat sabitleri + yardim merkezi makale/oy tablolari.
  legalHelpContent: "20261013005100_legal_help_content.sql",
  // DG6 (2026-10-14): platform KVKK veri sahibi basvurulari (platform_kvkk_requests; yalniz service_role) + AD10 kvkk_sla uyari kurali.
  platformKvkkRequests: "20261014006000_platform_kvkk_requests.sql",
  // EP1 (2026-10-13): portal uyeliginin tek kaynagi tenant_portal_accounts + eklenti giris sonucu RPC'si + portal_name kucuk harf.
  tenantPortalAccounts: "20261013007000_tenant_portal_accounts.sql",
  // EP1 duzeltme: portal_name her yazimda lower(btrim()) (tetikleyici + CHECK); initcap gecen eski RPC'ler zararsizlasir.
  portalListingsNameNormalize: "20261013007010_portal_listings_name_normalize.sql",
  // EP2 (2026-10-13): EIDS yetki defteri (yalniz eklenir) + genisletilmis yetki durumu + tek yazma noktasi RPC'leri + aday on suzgeci.
  eidsAuthorityLedger: "20261013007100_eids_authority_ledger.sql",
  // EP4 (2026-10-13): EIDS aksiyon motoru: tasks.kind/priority genislemesi, tasks.dedupe_key/escalated_at, eids_takedown_items,
  // kaldirma gorevi kapanis kapisi + eklenti "kalkti" tetigi, authority_reminder_channel 'email'.
  eidsActions: "20261013007300_eids_actions.sql",
  // FN1 (2026-10-14): Finans v2 mini muhasebe: cari, acik kalem/vade, ekler, ofis kategorisi, kural, ay kilidi, butce, ayar, kayitli
  // gorunum + cash_entries KDV/stopaj/cari kolonlari + birlesik defter/acik kalem gorunumleri (001000), v2 RPC'ler (001100), veri tasima (001200).
  financeLedgerV2: "20261014001000_finance_ledger_v2.sql",
  financeLedgerV2Rpc: "20261014001100_finance_ledger_v2_rpc.sql",
  financeLedgerV2Backfill: "20261014001200_finance_ledger_v2_backfill.sql",
  // DG1 (2026-10-14): personel ozel rolleri (platform_custom_roles + platform_staff.custom_role_id) ve dort goz onay kuyrugu.
  platformCustomRolesFourEyes: "20261014001300_platform_custom_roles_four_eyes.sql",
  // FN3 (2026-10-13): Muhasebe > Hareketler: toplu elle mutabakat RPC (finance_entries_set_reconciled; yalniz reconciled_at).
  financeEntriesManualReconcile: "20261013008200_finance_entries_manual_reconcile.sql",
  // FN6 (2026-10-13): duzenli odeme kuralina cari/KDV/stopaj yazan ayri RPC (sutunlar FN1 20261014001000_finance_ledger_v2).
  financeRecurringRuleTerms: "20261013008600_finance_recurring_rule_terms.sql",
  // DG2 (2026-10-14): plan katalog motoru: billing_plans kayit defteri (FK), eklenen paket fiyati, 4 fonksiyonda plan listesi -> billing_plan_known.
  planCatalogEngine: "20261014002000_plan_catalog_engine.sql",
  // DG5 (2026-10-14): Kanal ROI pazarlama harcamasi (marketing_spend), /durum olay/bakim kayitlari ve deploy surum gecmisi (yalniz service_role).
  channelRoiStatusPage: "20261014005000_channel_roi_status_page.sql",
  // DG7 (2026-10-14): ofis guvenlik politikalari: ofis sahibinin aktif oturum listesi + tekil kapatma (2 service_role RPC).
  officeSecuritySessions: "20261014007000_office_security_sessions.sql",
  // SP5 (2026-10-13): Google baglanti merkezi veri tablolari (GSC gunluk, URL Inspection, Ads gunluk) + budama/ozet RPC.
  googleData: "20261013003400_google_data.sql",
  // FN5 (2026-10-13): Muhasebe > Belgeler: {tenant}/ledger/ nesneleri icin JWT kimlikli depolama politikalari + e-Fatura okuma (expenses:view).
  financeAttachmentStorage: "20261013008400_finance_attachment_storage.sql",
  // AD1 (2026-10-13): abonelik operasyon konsolu: ofise ozel limit istisnasi + cozucu, taahhut/iptal kodu, tahsil hata metni.
  subscriptionOps: "20261013004000_subscription_ops_entitlement_overrides.sql",
  // AD5 (2026-10-13): ofis CRM katmani (etiket, sorumlu, asama, not, gorev, gunluk saglik skoru, admin kayitli gorunum; yalniz service_role).
  platformCrm: "20261013004400_platform_crm.sql",
  // AD8 (2026-10-13): duyuru merkezi (kanal/segment/zamanlama sutunlari, teslim satirlari, banner, Yenilikler) + okundu tetikleyicisi.
  announcementCenter: "20261013004700_platform_announcement_center.sql",
  // AD9 (2026-10-13): destek masasi 2.0 (SLA matrisi + is saatleri + tatil, otomatik atama, etiket, makro eylemleri, bekleyen bilet otomasyonu).
  supportDeskV2: "20261013004800_support_desk_v2.sql",
  // B7 (PA-3/7/8/9/10): platform raporu ay sonu MRR, talep birlestirme, destek presence, saptirma olcumu, oneri-yenilik bagi.
  b7PlatformMrrMonthEnd: "20261019070000_platform_mrr_month_end.sql",
  b7SupportTicketMerge: "20261019070001_support_ticket_merge.sql",
  b7TicketDeskPresence: "20261019070002_ticket_desk_presence.sql",
  b7FeatureRequestChangelog: "20261019070003_feature_request_changelog_link.sql",
  b7SupportArticleDeflections: "20261019070004_support_article_deflections.sql",
  // AD2 (2026-10-13): fatura satirlari + numarali alacak dekontu (iade tetikleyicisi) + elle fatura taslak RPC'si.
  invoiceLinesCreditNotes: "20261013004100_invoice_lines_credit_notes.sql",
  // AD3 (2026-10-13): tahsilat (dunning) olay gunlugu (yeni tablo; tenants/invoices FK, yalniz service_role).
  dunningEvents: "20261013004200_dunning_events.sql",
  // AD6 (2026-10-13): platform uye aramasi (e-posta/son giris/2FA/sube suzgeci) tek turluk salt-okunur RPC (yalniz service_role).
  platformMemberSearch: "20261013004500_platform_member_search.sql",
  storageCleanupReceipts: "20261012001800_storage_cleanup_receipts.sql",
  // EVDS (2026-10-12): TCMB EVDS piyasa oranlari (konut kredisi faizi) icin yeni tablo.
  marketRates: "20261012002000_market_rates.sql",
  // Davet kodu duzeltmesi (2026-10-12): admin client ile yazilan tablolarda service_role eksik INSERT/UPDATE yetkileri.
  serviceRoleWriteGrants: "20261012002100_service_role_write_grants.sql",
  rentNoticeReceipt: "20261012000900_rent_notice_receipt.sql",
  // Kabuk zinciri (2026-10-11): app_shell_bootstrap yanitina aktif platform personeli satiri (ayri platform_staff turu kalkar).
  appShellPlatformStaff: "20261012001100_app_shell_platform_staff.sql",
  // Konsey ertelenen #7 (2026-10-12): fiyat revizyonu onerisi + mulk sahibi (token) onayi; guard_property_list_price_drop govdesi bir erken donus kazanir.
  propertyPriceProposals: "20261012000800_property_price_proposals.sql",
  // GUVENLIK paketi (2026-10-12): fiyat onerisi ofis onay kapisini asamaz; kira tahakkuku finansal sutunlari yalniz RPC; kasa hareketi kaynak tutar tavani; komisyon paylasimi butunlugu.
  priceProposalOversightGate: "20261012001200_price_proposal_oversight_gate.sql",
  rentChargesFinancialGuard: "20261012001300_rent_charges_financial_guard.sql",
  financeEntrySourceAmountGuard: "20261012001400_finance_entry_source_amount_guard.sql",
  commissionSplitsIntegrity: "20261012001500_commission_splits_integrity.sql",
  // Kapali portfoy sizintisi (2026-10-08): vitrin_chat_context govdesi ayni, yalniz kapali portfoy suzgeci eklenir (000330'a bagli).
  vitrinChatClosedListing: "20261008001810_vitrin_chat_closed_listing.sql",
  // SURELI KONTOR (2026-10-10): kontor partileri (ef_credit_lots) + FIFO harcama + yanma RPC'si; ef_credit_balance/commit/grant yeniden tanimlanir,
  // eski suresiz bakiyeler 12 aylik partiye doner. fulfill govdelerine DOKUNMAZ (sure fatura meta'sindan okunur). Kod sema yokken eski akisa duser; paket satisi kapali kalir.
  efCreditLots: "20261010000300_ef_credit_lots_expiry.sql",
  // EP3 (2026-10-13): Bakanlik (EIDS) e-postalari: ofise ozel alma adresi + islenmis e-posta kayitlari (yalniz service_role yazar).
  eidsInbound: "20261013007200_eids_inbound.sql",
  // DG4 (2026-10-14): rapor merkezi kayitli gorunumleri + zamanlanmis rapor abonelikleri + teslim gunlugu (ofis RLS, platform yalniz service_role).
  reportSubscriptions: "20261014004000_report_subscriptions.sql",
  // DG8 (2026-10-14): ozellik bayragi hedefleme kurallari + urun ici NPS anketi + ozellik istek panosu (yalniz service_role).
  flagRulesProductFeedback: "20261014008000_feature_flag_rules_product_feedback.sql",
  clAppCanonicalLinks: "20261014009000_cl_app_canonical_links.sql",
  // GP1 (2026-10-14): danisman carisi kapsami (P12) RLS + finance_party_* RPC; finance_aging vadesiz kovasi.
  financePartyAdvisorScope: "20261014011000_finance_party_advisor_scope.sql",
  // GP2 (2026-10-14): otomatik faturada gecerlilik tarihli KDV: fulfill faturanin meta.vatRate oranini okur (sabit %20 yerine).
  billingVatRateInvoices: "20261014012000_billing_vat_rate_invoices.sql",
  // GP4 (2026-10-14): herkese acik randevu bildirimleri (online randevu, teyit yaniti) tek randevuyu acar (?randevu=<id>).
  appointmentNotificationDeepLinks: "20261014014000_appointment_notification_deep_links.sql",
  // SN1 (2026-10-14): hareket satirinda danisman carisi kapsami (cash_entries RLS) + duzenli odeme hareketine cari/KDV/stopaj.
  financeEntriesAdvisorScopeRecurringTerms: "20261014021000_finance_entries_advisor_scope_recurring_terms.sql",
  // SN1 (2026-10-14): platform_staff_can (DG1 ozel rol matrisi) + rol adina bakan SQL kapilari matrise.
  platformStaffCanGates: "20261014021010_platform_staff_can_gates.sql",
  // SN2 (2026-10-14): uyari motoru nabiz kurali (engine_stalled; sunucu betigi error-watch/alert-send degerlendirir).
  alertEnginePulseRule: "20261014022000_alert_engine_pulse_rule.sql",
  // SN3 (2026-10-14): SMS ve WhatsApp gonderim/teslim gunlugu message_sends (yalniz service_role) + message_log_prune.
  messageLog: "20261014023000_message_log.sql",
  // SN5 (2026-10-14): ofis bazinda kurulum ilerlemesi olgulari (salt-okunur service_role fonksiyonu).
  tenantOnboardingFacts: "20261014025000_platform_tenant_onboarding_facts.sql",
  // KQ5 (2026-10-15): danisman basina musteri/portfoy sayimi tek tur (advisor_counts) + kurulum olgulari tek tur (onboarding_snapshot).
  advisorCountsRpc: "20261015020000_advisor_counts_rpc.sql",
  onboardingSnapshotRpc: "20261015021000_onboarding_snapshot_rpc.sql",
  // KQ6 (2026-10-15): bildirim gurultusu tek seferlik veri temizligi (anahtarsiz portal teyit kopyalari + gelecek tarihli satirlar).
  notificationsDedupeCleanup: "20261015030000_notifications_dedupe_cleanup.sql",
  // YD1 (2026-10-15): demo kiracinin gece sifirlamasi (yalniz slug=demo-ofis; taban tablosu + service_role fonksiyonu).
  demoTenantNightlyReset: "20261015041000_demo_tenant_nightly_reset.sql",
  // YD5 (2026-10-15): urun turu ve davet karti kapatma durumu sunucuda (profiles.ui_state + profile_ui_state_mark).
  profilesUiState: "20261015045000_profiles_ui_state.sql",
  // YD4 (2026-10-15): saha kullanimi — property_media.width/height + cevrimdisi kuyruk istek kimligi (client_submissions).
  yd4FieldCapture: "20261015044000_field_capture.sql",
  // YD8 (2026-10-15): CSP rapor modu satirlari (error_logs source 'csp') hata patlamasi sayacina girmez + yasal sayfalar statik sunuma.
  yd8ErrorLogsCspSource: "20261015048000_error_logs_csp_source.sql",
  yd8StaticLegalPagesOn: "20261015048010_static_legal_pages_on.sql",
  // SK8 (2026-10-16): herkese acik musteri yuzeyleri — malike gorunen teklif aciklamasi + atomik paylasim sayaci.
  sk8PublicSurfaces: "20261016080000_public_surfaces.sql",
  // P4 (2026-10-16): musteri belgesi gecerlilik tarihi (customer_files.valid_until + kismi indeks).
  p4CustomerFilesValidUntil: "20261016110200_customer_files_valid_until.sql",
  // KQ2 (2026-10-15): RLS maliyeti ve DB yuzeyi (komisyon/ilan kontrol/ekstre politikalari InitPlan, kimlik islem ici onbellegi,
  // tek gecisli metrik ozeti, indeks hijyeni, agent-photos sinirlari, anon RPC daraltma, Realtime yayin listesi).
  kq2CommissionsRls: "20261015010000_commissions_rls_initplan.sql",
  kq2LcFinanceRls: "20261015011000_lc_finance_rls_initplan.sql",
  kq2IdentityCache: "20261015012000_identity_txn_cache.sql",
  kq2MetricsSinglePass: "20261015013000_metrics_snapshot_single_pass.sql",
  kq2IndexHygiene: "20261015014000_index_hygiene.sql",
  kq2AgentPhotosLimits: "20261015015000_agent_photos_bucket_limits.sql",
  kq2RevokeAnonRpcs: "20261015016000_revoke_anon_definer_rpcs.sql",
  kq2RealtimeTrim: "20261015017000_realtime_publication_trim.sql",
  // SK2 (2026-10-16): ofis ekranlarinda canli veri — deyim duzeyinde Broadcast (tenant:<ofis> / inbox:<kullanici>, PII yok)
  // + supabase_realtime yayin kirpma (okuma politikalari kurulana dek ertelenir; scripts/sunucu/realtime-policies.sql).
  sk2TenantBroadcast: "20261016020000_tenant_broadcast_changes.sql",
  sk2RealtimeTrim: "20261016020100_realtime_publication_trim.sql",
  // YD2 (2026-10-15): sunumda ilan bazinda musteri geri bildirimi (ilgileniyorum/degil + not; yalniz service_role yazar).
  presentationFeedback: "20261015042000_presentation_feedback.sql",
  // YD3 (2026-10-15): musteriye randevu teyit/hatirlatma SMS izi (appointments 2 nullable sutun).
  appointmentCustomerMessages: "20261015043000_appointment_customer_messages.sql",
  // YD7 (2026-10-15): veritabani isletim sertlestirmesi (rol zaman asimlari, geo sayim materialized view'lari, toplu sayim RPC'leri).
  yd7RoleTimeouts: "20261015047000_db_role_timeouts.sql",
  yd7GeoStatsMv: "20261015047010_geo_stats_materialized.sql",
  yd7BatchCountRpcs: "20261015047020_batch_count_rpcs.sql",
  // SK1 (2026-10-16): oturum dogrulamada ag turu sifir + Supabase yigini ayarlari (HIZ-1).
  sk1FinanceFxInline: "20261016010000_finance_fx_inline.sql",
  sk1PgrstWatchScope: "20261016010100_pgrst_ddl_watch_scope.sql",
  sk1ProxyGateSessionAlive: "20261016010200_proxy_gate_session_alive.sql",
  sk1PlatformNotificationFeed: "20261016010300_platform_notification_feed.sql",
  // SK4 (2026-10-16): admin paneline canli veri (personel ozel Broadcast konulari), ofis ek mesaji durumu korur (v3),
  // admin komut paleti uye e-posta aramasi.
  sk4AdminStaffBroadcast: "20261016040000_admin_staff_broadcast.sql",
  sk4ReplySupportTicketV3: "20261016040100_reply_support_ticket_v3.sql",
  sk4AdminSearchMembers: "20261016040200_admin_search_members.sql",
  // SK5 (2026-10-16): bildirim okunma durumu kisi basina (notification_reads) + komisyon is_sample anlasmadan turer.
  sk5NotificationReads: "20261016050000_notification_reads.sql",
  sk5CommissionsInheritSample: "20261016050100_commissions_inherit_sample.sql",
  // SK6 (2026-10-16): finans, rapor ve platform MRR dogrulugu (alti dosya, tek pencere, dosya sirasiyla).
  sk6ReportingLocalAxis: "20261016060000_reporting_aggregates_local_axis.sql",
  sk6FinancePnlVatFix: "20261016060100_finance_pnl_vat_fix.sql",
  sk6RentalKpiOverdue: "20261016060200_rental_kpi_overdue.sql",
  sk6CommissionSplitsDeriveRate: "20261016060300_commission_splits_derive_rate.sql",
  sk6TenantIsInternal: "20261016060400_tenant_is_internal.sql",
  sk6PlatformReportingLocalAxis: "20261016060500_platform_reporting_local_axis.sql",
  // SK7 (2026-10-16): musteri arama cekirdegi (Turkce katlamali search_fold + phone_digits uretilmis sutunlari, trigram indeksleri, maskeli arayan tanima RPC'si).
  sk7CustomerSearchFold: "20261016070000_customer_search_fold.sql",
  // SK9 (2026-10-16): portfoy para birimi kolonu + yayin kapisi DB kopyasi / aktif satilik stok sayimi / portalda varlik tanimi.
  sk9PropertyCurrency: "20261016090000_property_currency.sql",
  sk9PublishGateCounts: "20261016090100_publish_gate_portfolio_counts.sql",
  // SK10 (2026-10-16): yetki ve veri erisimi guvenligi (kapsam RLS, modul yazma politikalari, rol matrisi korumasi, havuz sube siniri).
  sk10ScopeRls: "20261016100000_scope_rls.sql",
  sk10ModuleWritePolicies: "20261016100100_rls_module_write_policies.sql",
  sk10TrpGmGuardReadonlySupport: "20261016100200_trp_gm_guard_readonly_support.sql",
  sk10PoolBranchGuard: "20261016100300_pool_branch_guard.sql",
  // P2 (2026-10-16): kampanya hedef kitlesi tag/district/advisor filtreleri (create_campaign_with_recipients).
  p2CampaignAudienceFilters: "20261016110100_campaign_audience_filters.sql",
  // P5 (2026-10-16): /app/franchise sube rollup'i tek GROUP BY turunda (branch_rollup, SECURITY INVOKER).
  p5BranchRollupRpc: "20261016110300_branch_rollup_rpc.sql",
  // B1 (2026-10-16): ekip is yuku devri tek transaction'da (team_handoff_workload, SECURITY DEFINER; fsbo + havuz atamasi dahil).
  b1TeamHandoffWorkload: "20261016120100_team_handoff_workload.sql",
  // B4 (2026-10-16): ofis vitrini elle SEO basligi/aciklamasi (tenants.vitrin_seo_title / vitrin_seo_description).
  b4TenantVitrinSeoMeta: "20261016120400_tenant_vitrin_seo_meta.sql",
  // M3 (2026-10-16): demo gece sifirlamasi notification_reads (okunma izi) satirlarini da temizler (fonksiyon govdesi yeniden tanimlanir).
  m3DemoResetNotificationReads: "20261016150301_demo_reset_notification_reads.sql",
  // Finans entegrasyonu WP1 (2026-10-17): kayit cekirdegi (finance_post / finance_reverse) + acik kalem gorunumu v3.
  wp1FinancePostingCore: "20261017010000_finance_posting_core.sql",
  wp1FinanceOpenItemsV3: "20261017010100_finance_open_items_v3.sql",
  // Finans entegrasyonu WP2 (2026-10-17): tahakkuk tetikleyicileri + cari/geri doldurma + K/Z v3 (p_basis tahakkuk|nakit).
  wp2FinanceAccrualTriggers: "20261017010200_finance_accrual_triggers.sql",
  wp2FinancePartiesBackfill: "20261017010300_finance_parties_backfill.sql",
  wp2FinancePnlV3: "20261017010400_finance_pnl_v3.sql",
  // WP4 (2026-10-17): tekil mulk aidati acik kaleme (due:{id}), property_dues salt okunur, iptal, depozito emaneti, kiraci/malik carisi.
  wp4PropertyDuesOpenItems: "20261017010500_property_dues_open_items.sql",
  // WP5 (2026-10-17): e-Fatura -> defter (resmilesen fatura kaynak alacagina baglanir / serbest faturada invoice.issued alacagi; iptal = ters kayit).
  wp5EinvoiceLedgerLink: "20261017010600_einvoice_ledger_link.sql",
  // A1 (2026-10-18): kayit birlestirme v2 — merge_customers tum FK'ler + alan secimi; portfoy birlestirme (merge_properties).
  a1MergeCustomersV2: "20261018010000_merge_customers_v2.sql",
  a1MergeProperties: "20261018010001_merge_properties.sql",
  // CRM-G4 (2026-10-18): talep x portfoy eslesme durumu (onerildi/gonderildi/uygun degil; gizlenen cift tekrar onerilmez).
  crmG4DemandPropertyMatches: "20261018020000_demand_property_matches.sql",
  // A3 CRM-G11 (2026-10-18): musteri iletisim tercihi (kanal, uygun zaman dilimi, dil).
  a3CustomerContactPrefs: "20261018030030_customer_contact_prefs.sql",
  ga14AppointmentOutcomeNoshow: "20261018040000_appointment_outcome_noshow.sql",
  // A5/GA-08 (2026-10-18): bildirim konusu (notifications.topic + baglantidan tureten tetikleyici + my_notification_counts 'topics').
  ga08NotificationsTopic: "20261018050000_notifications_topic.sql",
  // A6 (2026-10-18): kampanya raporu (durum sayilari + 7 gun atif) ve sunucu sayfali alici listesi; gelen kutusu konusmalari.
  a6CampaignReportRpc: "20261018060000_campaign_report_rpc.sql",
  a6InboxConversationState: "20261018060100_inbox_conversation_state.sql",
  a6CommunicationsBodyTrgm: "20261018060200_communications_body_trgm.sql",
  // A7 (2026-10-18): otomasyon iletisim tetikleyicileri + takip dizileri + WhatsApp gelen medya kovasi + anket Google yorum izi.
  a7AutomationTriggerInbound: "20261018070000_automation_trigger_inbound.sql",
  a7MessageSequences: "20261018070001_message_sequences.sql",
  a7InboundMediaBucket: "20261018070002_inbound_media_bucket.sql",
  a7SurveyReviewClick: "20261018070003_survey_review_click.sql",
  // A8 (2026-10-18): anlasma asama gecmisi + satis hizi, takim/sube/cagri hedefi, donem/kapsam raporu + satis hunisi.
  a8DealStageHistory: "20261018080000_deal_stage_history.sql",
  a8TargetsScopeCalls: "20261018080001_targets_scope_calls.sql",
  a8ReportPeriodFunnel: "20261018080002_report_period_funnel.sql",
  // A9 (2026-10-18): giris kisitlayici (hesap + IP kovalari), ofis authenticator 2FA + kurtarma kodlari, KVKK veri sahibi dokumu.
  a9AuthLoginThrottle: "20261018090000_auth_login_throttle.sql",
  a9OfficeTotp: "20261018090100_office_totp_two_factor.sql",
  a9KvkkSubjectExports: "20261018090200_kvkk_subject_exports.sql",
  // B1 (2026-10-19): vitrin sunucu suzgeci + gercek sayfalama (RPC), ilan cevresi (danisman girdisi).
  b1VitrinListingSearch: "20261019010000_vitrin_listing_search.sql",
  b1PropertyNearbyPlaces: "20261019010001_property_nearby_places.sql",
  // B3 (2026-10-19): portfoy medyasi oda etiketi + aciklama + kat plani (room_tag = kat_plani).
  b3PropertyMediaRoomTag: "20261019030000_property_media_room_tag_caption.sql",
  // B4 (2026-10-19): teklif kosullari + malik karsi teklifi, sozlesme-anlasma bagi, imza kaniti, kira stopaji + kiralik surec, defter otomatik kaynak.
  b4OfferTerms: "20261019040000_offer_terms_owner_counter.sql",
  b4ContractsDealLink: "20261019040001_contracts_deal_link.sql",
  b4ContractEvidence: "20261019040002_contract_signature_evidence.sql",
  b4RentalWithholding: "20261019040003_rental_withholding_handover.sql",
  b4LedgerAutoSource: "20261019040004_compliance_ledger_auto_source.sql",
  // B5 (2026-10-19): proje daire fiyat gecmisi + toplu zam/geri al + fiyat listesi aktarimi; proje paylasim sayfasi + galeri.
  b5ProjectUnitPricing: "20261019050000_project_unit_pricing.sql",
  b5ProjectPublicPage: "20261019050001_project_public_page.sql",
  // B6 (2026-10-19): musteri basarisi oyun kitaplari (platform_tasks kaynak/tekrar anahtari) + aktivasyon durtme defteri;
  // limit kullanimi (genisleme sinyali) ve deger sayimi RPC'leri + genisleme icgoru turu.
  b6CsPlaybooksNudges: "20261019060000_platform_cs_playbooks_nudges.sql",
  b6TenantUsageRpcs: "20261019060001_platform_tenant_usage_rpcs.sql",
  // B8 (2026-10-19): ofis TV eslestirme, nobet cizelgesi, birebir kocluk, onay vekili.
  b8TvDevices: "20261019080000_tv_devices.sql",
  b8DutyShifts: "20261019080001_duty_shifts.sql",
  b8CoachingSessions: "20261019080002_coaching_sessions.sql",
  b8ApprovalDelegate: "20261019080003_approval_delegate.sql",
  b9InsightStalledDealsStage: "20261019090000_insight_stalled_deals_stage.sql",
  c0FinanceHrefs: "20261020000000_finance_hrefs.sql",
  // C1 (2026-10-20): CRM derinligi — ek iletisim bilgileri, iliskili kisiler, sabit not + anma, davranissal isi, birlestirme v3.
  c1CustomerContacts: "20261020010000_customer_contacts.sql",
  c1CustomerRelations: "20261020010001_customer_relations.sql",
  c1CommPinMention: "20261020010002_communications_pin_mention.sql",
  c1HeatEngagement: "20261020010003_customer_heat_engagement.sql",
  c1MergeContacts: "20261020010004_merge_customers_contacts.sql",
  // C2 (2026-10-20): kiraci basvurusu + kefil (SP5), teslim/tahliye tutanagi + kalemli depozito kesintisi (SP6).
  c2RentalApplications: "20261020020001_rental_applications.sql",
  c2RentalInspections: "20261020020002_rental_inspections.sql",
  c3BuildingBudgetAnnouncements: "20261020030033_building_budget_announcements.sql",
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
    // 2026-10-05 terfi edenler
    [F.ownerLink]: "ek", // nullable sutun + FK + ayni-ofis trigger'i (yalniz owner_customer_id yazilinca calisir)
    [F.geo]: "ek", // yeni geo_* tablolari/sutunlari + service_role RPC'leri; ofis bildirimi INSERT'i durum alanlarini kilitler
    [F.billingAmount]: "davranis", // fulfill/plan RPC tutarlari plan tanimindan; admin plan degisimi tutari korur
    [F.seatPriceLock]: "ek", // iki nullable sutun
    [F.billingPauseSeats]: "ek", // D bolumu CIKARILMIS halde: sutunlar + yeni RPC'ler + effective_seat_limit
    [F.seatFulfillment]: "davranis", // koltuk tetikleyicileri extra_seats'i sayar; fulfill extra_seats faturasini isler
    [F.survey]: "ek", // yeni anket tablolari + permission_defaults seed (on conflict do nothing)
    [F.surveyMatrix]: "davranis", // CHECK genisler + guard yeniden (anketor icin sikilasir) + soru metni 1-10 -> 0-10
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
    [F.officeCenterPerms]: "ek", // yalniz VERI seed: office_center izin varsayilani (owner/gm ALL, branch_manager view+edit, team_lead view); idempotent
    [F.poolAssignments]: "ek", // yeni tablo pool_assignments + RLS (okuma: office_center view / atanan; yazma: office_center edit); mevcut davranis degismez
    [F.accessWritePolicies]: "ek", // access_audit_log INSERT politikasi (owner/gm/branch_manager, kendi ofisi, created_by = auth.uid()) + grant insert
    [F.appShellBootstrap]: "ek", // yalniz 1 yeni invoker RPC (app_shell_bootstrap): profil+tenant+ham izin satirlari+modul+kullanim+rozet sayimi tek JSON; tablo/politika degismez
    [F.dashboardSnapshotRpcs]: "ek", // yalniz 3 yeni invoker RPC (get_insights/tasks/metrics_snapshot); p_tenant_id/p_user_id JWT ile eslesmezse NULL; tablo/politika degismez
    [F.planSubscriptionAmount]: "davranis", // 9 argumanli ESKI fulfill_billing_payment overload DROP (kod cagirmaz); 9 argumanli cagri artik 10 argumanli dogru tanima cozulur
    [F.reportingSampleScope]: "davranis", // tenant_commission/reporting_aggregates imzasina p_sample_threshold (varsayilan 5); esik ustu ofiste ornek kayitlar toplamlardan DUSER
    [F.ownershipTransferRpc]: "ek", // yeni authenticated RPC'ler ownership_transfer_request/accept/resolve (JWT kimligi, ayni islemde audit_logs); mevcut 3 service_role RPC degismez
    [F.mediaIsDocument]: "davranis", // public gorunurluk daralir: is_document=true medya hicbir public yuzeyde/serviste yok; belge adli mevcut satirlar true; INSERT tetikleyicisi belge adini isaretler + kapak yapmaz
    [F.lcLifecycleEvents]: "ek", // yeni append-only tablo lc_lifecycle_events + property_control_state AFTER tetikleyicisi (yalniz olay yazar, hata yutulur)
    [F.lcInventoryMatching]: "ek", // yeni tablo listing_inventory_imports + 2 authenticated RPC (lc_inventory_import, lc_match_decide) mevcut service_role cekirdeklerini sarar
    [F.lcDistrictSlaReset]: "davranis", // 2 yeni invoker RPC (ilce kirilimi) + listing_anomalies tetikleyicisi: yeniden acilan uyarinin eski SLA asama kayitlarini siler (yukseltme bastan isler)
    [F.vitrinChatContext]: "ek", // yeni anon DEFINER RPC vitrin_chat_context (ofis ayari acik + ilan yayinda ise yalniz public ilan alanlari)
    [F.expenseReceiptUploads]: "davranis", // direct_file_uploads kisitlari + claim/finalize/enqueue tam govde (3. tur expense_receipt), yeni expense_receipt_files + ozel kova expense-receipts, outbox kova izin listesi genisler
    [F.importRentalWithDeal]: "ek", // yeni authenticated DEFINER RPC import_rental_with_deal (yetki icerde; guard'lar yalniz kendi transaction'inda service_role kimligiyle gecilir)
    [F.proxyGateSnapshot]: "ek", // yeni salt-okunur SECURITY INVOKER RPC proxy_gate_snapshot (RLS eski okumalarla ayni; kod RPC yokken eski yola duser)
    [F.lcParserTelemetry]: "ek", // yeni tablo + yeni RPC; mevcut ilan kontrol govdeleri degismez
    [F.expenseBudgetsRecurring]: "ek", // yeni expense_budgets tablosu (RLS) + expenses.recurrence/portal_key null'lanabilir sutunlari; mevcut satirlar degismez
    [F.leadCaptureTokenDefault]: "davranis", // NULL tokenli ofislerde vitrin talep formu acilir (lead_capture_enabled degismez)
    [F.appShellHiddenModules]: "ek", // app_shell_bootstrap govdesi birebir + yeni hidden_modules alani (CREATE OR REPLACE); tablo/politika/veri degismez
    [F.searchTrgmIndexes]: "ek", // customers(full_name,phone,email) + properties(title,property_code,address_line) GIN trigram indeksleri; veri degismez
    [F.securityCalendarTokenAuditLogs]: "davranis", // B2-B5: calendar_token ayri tabloya (profiles sutunu kalkar), audit_logs/error_logs okuma sinirlari, public tablolarda TRUNCATE/TRIGGER/REFERENCES geri alinir
    [F.dbPerfRlsInitplanKpi]: "davranis", // 57 RLS politikasinin ifade metni (select fn()) ile sarilir (anlam ayni, sorgu basina tek cagri) + 11 kopya indeks duser + yeni invoker KPI RPC; veri/sutun degismez
    [F.lcDailySync]: "davranis", // lc_inventory_import govdesi degisir (eklenti tam liste kaniti + "ilan kalkti" icin 12 saat araligi) + 3 nullable/default kolon; yeni tablo ve anomali turu yok
    [F.lcInventorySourceHardening]: "siki", // lc_inventory_import govdesi: scope=mine csv/paste assisted sayilir, acik kayip sinyali present ile kapanmaz (yonetici onayi), tam liste kaniti her kaynakta; imza/ACL ayni
    [F.expenseTrendMonthAxis]: "davranis", // trend etiketleri ve ay toplamlari dogru aya yazilir
    [F.grantsDealStepsListingAnalyses]: "davranis", // RLS politikalariyla uyumlu tablo yetkileri; anon yetkisi kaldirilir
    [F.fixRegexRepetitionLimit]: "davranis", // kampanya kuyrugu ve WhatsApp sablonlu kayitlar yeniden calisir (anlam ayni)
    [F.profileAvatar]: "ek", // profiles/platform_staff'a 2 nullable sutun + public avatars kovasi + sahip-yolu storage politikalari + kendi satirina yazan DEFINER RPC set_my_avatar; mevcut davranis degismez
    [F.subscriptionPause]: "ek", // subscriptions'a duraklatma/planli dusurme sutunlari + 4 authenticated JWT RPC + 2 service_role cron RPC + hazirlik yoklamasi; bayraklar SQL'de de kontrol edilir, mevcut davranis degismez (bayrak KAPALI)
    [F.userModulePrefs]: "ek", // yeni tablo user_module_prefs (RLS: yalniz kendi satiri); kod tablo yokken hicbir sey gizlemez
    [F.efCreditLots]: "davranis", // kontor partileri: bakiye/harcama/yukleme RPC govdeleri degisir + eski bakiyeler 12 aylik partiye doner + yeni tablo
    [F.planPricesEfTariff]: "davranis", // yeni abonelik/yenileme liste fiyati (SQL yedek) + yalniz dokunulmamis ef.* seed ayarlari; abonelik/fatura satiri ve plan override'i degismez
    [F.propertyAuthorityStatus]: "ek", // properties'e 6 nullable/varsayilanli yetki durumu sutunu + kisit + kismi indeks; mevcut satir/RLS degismez
    [F.propertyManagementCore]: "davranis", // rent_charges durum CHECK'i 'partial' ile genisler + paid_amount; yeni tahsilat/sozlesme/odeme tablolari + 4 DEFINER RPC; eski 'odendi' tahakkuklar icin tek seferlik legacy tahsilat dolgusu
    [F.financeAccountsCashEntries]: "ek", // yeni finance_accounts/cash_entries tablolari (RLS: kisisel hesap yalniz sahibine) + 12 finance_* RPC; mevcut tablo/davranis degismez, kod tablolar yokken eski Giderler akisina duser
    [F.buildingManagement]: "davranis", // yeni bina/daire/tahakkuk/tahsilat tablolari + 5 DEFINER RPC + KPI RPC; owner_charge_links kind CHECK'i 'unit_charge' ile genisler, silme politikasi daralir (mahsup elle silinemez)
    [F.platformDashboardRollups]: "ek", // yeni salt-okunur service_role RPC platform_dashboard_rollups (tablo/politika/veri degismez; RPC yokken ilgili paneller "okunamadi" gosterir, uydurma sifir yok)
    [F.recurringRules]: "ek", // yeni recurring_rules/recurring_occurrences tablolari (RLS: kisisel kural yalniz sahibine, maas kurali yalniz owner/gm) + recurring_* RPC; mevcut tablo/davranis degismez (kurala cevir yalniz expenses.recurrence'i bosaltir, kullanici eylemiyle)
    [F.bankStatementImport]: "ek", // yeni finance_statement_* tablolari (RLS: hesap gorunurlugu) + 5 DEFINER RPC + cash_entries'e nullable reconciled_at; mevcut satir/davranis degismez
    [F.poolDefaultOn]: "davranis", // tenants.listing_pool_enabled sutun varsayilani true (yalniz YENI ofisler; mevcut satirlar degismez) + havuz kaynak CHECK genisler
    [F.realtimeCoreTables]: "ek", // yalniz yayina tablo ekler; tablo/politika/veri degismez
    [F.commissionSplitProfile]: "davranis", // commission_splits'e 2 sutun + commissions.splits yazimini normallestiren BEFORE/AFTER tetikleyici; mevcut paylasim kayitlari ad->profil eslenir (jsonb'ye profile_id/kind eklenir), tablo esitlenir
    [F.financeSalaryPrivacy]: "davranis", // finance_account_balances: yetkisiz rol icin maas hareketleri bakiyeden haric; finance_void_source_entries audit_logs yazar (imza/ACL degismez)
    [F.statementApplyRecurringCommission]: "davranis", // finance_statement_apply govdesi: yeni "recurring" eylemi + komisyon kaynakli hareket komisyonu tahsil edildi yapar; imza/ACL degismez
    [F.earningsStatementPrivacy]: "siki", // tenant_commission/reporting_aggregates earnings_all yoksa yalniz kendi kayitlari (advisors=[]); finance_statement_lines/imports/mappings SELECT politikalari hesap + maas suzgeci (imza/ACL ayni)
    [F.homeSnapshotRpc]: "ek", // yalniz 1 yeni invoker RPC (home_snapshot); RLS cagiranin yetkisiyle, tablo/politika/veri degismez
    [F.einvoice]: "ek", // yeni einvoice_connections + einvoices tablolari (RLS ofis kapsamli, yazma commissions.create/settings.edit) + 2 DEFINER RPC; mevcut tablo/politika degismez
    [F.einvoiceRecovery]: "davranis", // einvoices.issue_stage + 6 fonksiyon imzasiz yeniden tanim + service_role EXECUTE daralir; veri degismez
    [F.einvoiceStateMachine]: "davranis", // einvoices'te authenticated INSERT/UPDATE/DELETE kapanir (yazma yalniz DEFINER RPC); guard durum matrisi eklenir; veri degismez
    [F.listingAnalyses]: "ek", // yeni listing_analyses tablosu (RLS: okuma ofis, yazma valuation.create); mevcut tablo/politika degismez
    [F.vitrinChatClosedListing]: "davranis", // vitrin_chat_context govdesi yeniden tanimi: kapali portfoy artik sohbet baglamina GIRMEZ (govde+ACL baska degismez)
    [F.dealProcessSteps]: "ek", // yeni deal_process_steps tablosu (RLS: okuma ofis, yazma commissions.edit); mevcut tablo/politika degismez
    [F.leagueV2]: "ek", // yeni tablolar league_settings + league_challenges (RLS: okuma ofis, yazma targets izni); mevcut tablo/politika degismez
    [F.planUpgradeFulfillment]: "davranis", // fulfill + v2 tam govde yeniden tanimi: plan_upgrade faturasi islenir (taban 000300 govdesi bayt bayt korunur); bayrak kapaliyken kimse bu turde fatura kesmez
    [F.contractSignerReminder]: "ek", // contract_signers'a short_code/reminder_count/last_reminded_at + 2 DEFINER RPC (hatirlatma yuku: tam token donmez; kisa kod cozumu anon)
    [F.perfIndexesRpc]: "davranis", // current_session_two_factor_satisfied/is_platform_staff/support_is_ticket_staff dili sql->plpgsql (govde+ACL birebir; sorgu basi ~360us ayristirma biter) + idx_customer_demands_tenant_created
    [F.propertiesPriceDropGuard]: "siki", // properties BEFORE UPDATE OF list_price tetikleyicisi (kural acikken esik ustu dusus onay ister; yalniz authenticated) + property_price_history authenticated icin yalniz SELECT
    [F.expenseSampleScope]: "davranis", // tenant_expense_aggregates imzasina p_sample_threshold (varsayilan 5); esik ustu ofiste ornek giderler toplamlardan DUSER
    [F.financeIsSample]: "ek", // finance_accounts/cash_entries/recurring_rules/expense_budgets: is_sample boolean default false (sabit varsayilan; mevcut satirlar degismez)
    [F.einvoiceServerOnlyWrites]: "siki", // e-Fatura sonuc-yazan 5 RPC authenticated/service_role EXECUTE kapanir; yeni *_srv RPC yalniz service_role; veri/tablo degismez
    [F.rentNoticeReceipt]: "ek", // rent_payment_notices'e 6 nullable dekont sutunu + CHECK (yalniz bos/gecerli) + ozel rent-receipts kovasi + 1 anon-okur token cozucu RPC; mevcut satir/davranis degismez
    [F.propertyPriceProposals]: "davranis", // yeni tablo + 3 RPC (biri anon) + guard_property_list_price_drop govdesi (onayli oneri mesru gerekce)
    [F.priceProposalOversightGate]: "siki", // guvenlik/para: mulk sahibi onayi yonetici onayinin yerine gecmez (kural acik ofiste esik-ustu oneri awaiting_manager); status CHECK + tekil indeks genisler; price_drop_check + 2 yeni DEFINER RPC; guard govdesi
    [F.rentChargesFinancialGuard]: "siki", // guvenlik/para: rent_charges BEFORE UPDATE/DELETE tetikleyicileri (authenticated istemci tutar/durum/odeme alanlarini degistiremez, odemeli tahakkuku silemez); RPC/service_role/cron etkilenmez; veri degismez
    [F.financeEntrySourceAmountGuard]: "siki", // guvenlik/para: kasa hareketi kaynak tutar tavani (Paket 2)
    [F.commissionSplitsIntegrity]: "siki", // guvenlik/para: komisyon paylasimi butunlugu (Paket 2)
    [F.efPackNamesTl]: "ek", // platform_settings ef.packs: yalniz seed paket adlarinda "kontor" -> "TL" metin degisimi (sema/fonksiyon yok)
    [F.portfolioCountsRpc]: "ek", // 2 yeni SECURITY INVOKER sayim RPC'si (portfolio_counts, task_counts); tablo/politika/veri degismez
    [F.searchTrgmTasksDocs]: "ek", // tasks/customer_files/property_media/contracts/deal_checklist_items GIN trigram indeksleri (8); veri degismez
    [F.realtimePublicationMore]: "ek", // 4 tabloyu supabase_realtime yayinina ekler (idempotent); tablo/politika/veri degismez
    [F.fsboLeads]: "ek", // 4 yeni tablo (fsbo_leads, fsbo_lead_observations, fsbo_lead_activities, fsbo_do_not_call; RLS + acik grant) + tasks.fsbo_lead_id nullable sutun; mevcut satir/politika degismez, kod tablo yokken bos duruma duser
    [F.fsboPermissionDefaults]: "ek", // yalniz VERI seed: prospecting izin varsayilani (owner/gm/branch_manager/team_lead ALL, advisor/call_center view+create+edit, readonly view); idempotent
    [F.automationTriggerFsbo]: "ek", // yalniz enum degeri ekler (new_fsbo_lead, fsbo_no_contact_days; idempotent); tablo/politika/veri degismez
    [F.fsboRlsScope]: "siki", // fsbo_leads UPDATE politikasi kendi+sahipsiz kapsama, sutun UPDATE yetkisi daralir, insert is_sample=false; iki kapatma RPC'si izin kapisi alir; veri degismez
    [F.fsboSelectScope]: "siki", // fsbo_leads/observations/activities SELECT politikasi danisman kapsamina daralir; assigned_to/deleted_at kullanici UPDATE yetkisi kalkar (fsbo_assign_lead/fsbo_archive_lead RPC); fsbo_find_existing dar okuma RPC; veri degismez
    [F.financeOwnerPayoutSource]: "siki", // finance_record_entry/finance_void_source_entries gövdeleri + cash_entries.source_type CHECK listesine owner_payout; veri degismez, hesap secilmezse davranis ayni
    [F.rlsInitplanFsboStaff]: "davranis", // 24 politikada satir-bagimsiz yardimci cagrilari (select fn()) ile sarilir (InitPlan); anlam/rol/komut ayni, plan degisir
    [F.tenantIndexesDedupe]: "ek", // 11 kopya indeks dusurulur (benzersiz kisit ikizleri) + 12 tabloya tenant_id indeksi; veri/politika degismez
    [F.readyProbesPgCatalog]: "davranis", // plan_upgrade_ready/subscription_pause_ready sutun sayimi information_schema yerine pg_attribute; imza/ACL/sonuc ayni
    [F.perfLabRuns]: "ek", // yeni tablo perf_lab_runs (RLS acik, politika yok, yalniz service_role); mevcut nesnelere dokunmaz, kod tablo yokken "migration bekliyor" / cron "atlandi"
    [F.platformMrrDaily]: "ek", // yeni tablo platform_mrr_daily (RLS: platform personeli billing/reports rolleri SELECT; yazma yalniz service_role); mevcut nesnelere dokunmaz, kod tablo yokken "veri yok"
    [F.portalRulesCore]: "ek", // 8 yeni tablo (RLS: platform tablolari pt_rules_is_operator, kiraci tablolari lc_parser_telemetry deseni; dogrudan yazma yok) + yayin degismezlik tetikleyicisi + SQL icerik dogrulayici; mevcut tablo/politika/veri degismez
    [F.portalRulesRpcs]: "ek", // yeni JWT SECURITY DEFINER RPC'ler (pt_rules_current, pt_report_form_feedback, pt_rules_admin_*; yayin/geri alma yalniz super_admin); mevcut fonksiyonlara dokunmaz, pt_complete_session degismez
    [F.portalRulesLearn]: "ek", // yalniz service_role fonksiyonlari (pt_rules_learn, pt_rules_publish_system, pt_learning_retention); kod fonksiyon yokken cron adimini 'skipped' gecer
    [F.siteIssues]: "ek", // yeni tablolar site_issues + site_optimizer_actions (RLS acik, politika yok, yalniz service_role) + site_issues_prune RPC; mevcut nesnelere dokunmaz, kod tablo yokken Kokpit "kurulum bekliyor"
    [F.platformAiQuota]: "ek", // yeni tablo platform_ai_quota (RLS acik, politika yok, yalniz service_role) + SECURITY DEFINER platform_ai_quota_take; mevcut nesnelere dokunmaz, kod tablo yokken AI onerisi kapali kalir
    [F.publicMeasurement]: "ek", // 2 yeni tablo (public_pageviews_daily, web_vitals_daily; RLS acik, politika yok, yalniz service_role) + analytics_ingest/analytics_prune/analytics_vitals_summary RPC'leri; mevcut nesnelere dokunmaz, kod tablo yokken 10 dk arayla yeniden dener
    [F.signupAttributionExt]: "ek", // signup_attributions'a 6 nullable sutun (channel, src_host, utm_term, utm_content, first_touch, last_touch) + uzunluk/desen CHECK'leri (landing_path dahil); gclid YOK; tablo 0 satir, geriye donuk doldurma yok
    [F.growthFunnel]: "ek", // yeni salt-okunur SECURITY DEFINER RPC platform_growth_funnel (yalniz service_role; platform_dashboard_rollups deseni); tablo/politika/veri degismez
    [F.opsAlerts]: "davranis", // 7 yeni tablo (RLS+FORCE, REVOKE; yalniz service_role) + error_logs'a 5 sutun (status varsayilan 'open', geri doldurma: cozulmusler 'resolved') + status/resolved_at esitleme tetikleyicisi + record_error_occurrence p_release (DEFAULT null; eski 9 argumanli cagri ayni) ve dakikalik sayac + 2 salt-okunur service_role RPC (ops_db_overview, ops_slow_queries); kod tablolar yokken "kurulum bekliyor", hata kaydi eski imzaya duser
    [F.pushSubscriptionsRepair]: "ek", // canlida eksik push_subscriptions tablosu (ledger'da 20260722000013 uygulanmis gorunuyor) idempotent yeniden kurulur; politika current_tenant_id() + WITH CHECK; baska nesneye dokunmaz
    [F.eidsActions]: "siki", // tasks CHECK genisler (kind +eids_publish/eids_takedown, priority +urgent) + 2 nullable sutun + kismi tekil indeks; yeni tablo eids_takedown_items (RLS: gorev yetkisiyle oku/isaretle, ekleme/silme yalniz service_role); kaldirma gorevi bekleyen kalemle TAMAMLANAMAZ (tetik); portal_listing_health confirmed_missing kalemi isaretler; authority_reminder_channel +email
    [F.ad11SecurityHardening]: "siki", // platform_audit_logs append-only tetik (UPDATE/DELETE/TRUNCATE yasak; FK set-null istisnasi) + 4 nullable kolon; platform_impersonation_sessions'a 3 nullable kolon; yeni tablolar (platform_impersonation_history, backup_runs, restore_drills; yalniz service_role) + 2 service_role RPC; kod tablolar yokken eski yola duser
    [F.eidsAuthorityLedger]: "davranis", // properties.authority_eids_status CHECK genisler (eski 3 deger gecerli) + varsayilan 'pending' -> 'unknown' (mevcut satirlar degismez) + 5 nullable sutun; yeni yalniz-eklenir eids_authority_events (RLS yalniz SELECT portals:view; INSERT hicbir role verilmez) + SECURITY DEFINER acik denetimli eids_apply/undo_authority_event (kiraci=JWT, portals:edit, properties:edit, override yalniz owner) + pg_trgm varsa eids_authority_candidates + rakam anahtari ifade indeksi ve SECURITY INVOKER eids_properties_by_no_key; kod tablo/RPC yokken eski dogrudan yazima duser
    [F.siteMedia]: "ek", // yeni ozel kova site-media (raster mime, 8 MB) + site_media tablosu (RLS+FORCE, REVOKE; yalniz service_role); mevcut nesnelere dokunmaz, kod tablo yokken "kurulum bekliyor" + gorselsiz ana sayfa
    [F.portalListingsNameNormalize]: "davranis", // portal_listings BEFORE INSERT/UPDATE OF portal_name tetikleyicisi lower(btrim()) + CHECK (NOT VALID + VALIDATE); yalniz harf/bosluk
    [F.tenantPortalAccounts]: "davranis", // yeni tablo tenant_portal_accounts (RLS: ofis okur, owner/gm yazar) + portal_account_report_login (JWT SECURITY DEFINER; seri 3'te owner'a tek seferlik bildirim) + portal_listings.portal_name lower(btrim()) veri duzeltmesi (yalniz harf/bosluk); kod tablo yokken oneriye duser
    [F.pushSubscriptionsRepairFirst]: "ek", // tablo yoksa 20260722000013 tanimiyla kurulur (if not exists + politika varsa atla); varsa degisiklik yok
    [F.eidsInbound]: "ek", // 2 yeni tablo eids_inbound_addresses/eids_inbound_messages (RLS: ofis ici okuma, yazma yalniz service_role); mevcut nesnelere dokunmaz, kod tablolar yokken "kurulum bekliyor"
    [F.emailLog]: "ek", // 3 yeni platform tablosu email_sends/email_events/email_suppressions (RLS acik, politika yok, yalniz service_role) + email_log_prune RPC; mevcut nesnelere dokunmaz, kod tablolar yokken gonderim surer ve gunluk atlanir
    [F.supportDeskV2]: "davranis", // 5 yeni tablo (yalniz service_role) + support_tickets.tags + ticket_macros eylem/sayac kolonlari; SLA hedefi IS SAATINE gore (support_set_derived_ticket_fields degisir), BEFORE INSERT otomatik atama tetikleyicisi, billing rolu destek personeli sayilir; kod tablolar yokken eski davranis
    [F.b7PlatformMrrMonthEnd]: "ek", // yeni salt-okunur SECURITY DEFINER platform_mrr_month_end (yalniz service_role; ofis x ay sonu MRR); veri degismez
    [F.b7SupportTicketMerge]: "ek", // support_tickets.merged_into_id/merged_at (+ kolon bazli authenticated SELECT) + yalniz service_role support_merge_tickets RPC'si; mevcut RPC/tetikleyicilere dokunmaz
    [F.b7TicketDeskPresence]: "ek", // realtime.messages uzerinde yalniz 'ticket-desk:<uuid>' presence okuma/yazma politikalari (aktif personel); diger konulara dokunmaz
    [F.b7FeatureRequestChangelog]: "ek", // product_feature_requests.changelog_entry_id (nullable FK, on delete set null) + kismi indeks
    [F.b7SupportArticleDeflections]: "ek", // yeni tablo support_article_deflections (RLS+FORCE, yalniz service_role); kod tablo yokken olcum yazmaz
    [F.financeLedgerV2]: "ek", // 9 yeni tablo (RLS: tenant + expenses:view; yazma yalniz RPC, kayitli gorunum kendi satiri) + cash_entries 8 / recurring_rules 3 nullable kolon + 2 security_invoker gorunum + ay kilidi ve acik kalem tetikleri (kilit tablosu bos dogar) + realtime yayini; mevcut satir/davranis degismez
    [F.financeLedgerV2Rpc]: "ek", // ~30 yeni SECURITY DEFINER finance_* RPC (v2 kayit/guncelleme eski RPC'leri sarar; eski imza ve govdeler degismez)
    [F.platformCustomRolesFourEyes]: "ek", // 2 yeni platform tablosu (ozel rol: aktif personel okur, yazma service_role; onay kuyrugu yalniz service_role) + platform_staff nullable custom_role_id (FK restrict, super admin CHECK); mevcut satirlar null kalir, sabit rol davranisi degismez
    [F.financeLedgerV2Backfill]: "davranis", // karsi taraf metinlerinden cari + cash_entries.party_id (tutar/tarih/hesap degismez, bakiye ayni), expense_budgets -> finance_budgets kopyasi, permission_defaults muhasebe expenses create+edit; idempotent
    [F.planCatalogEngine]: "davranis", // yeni billing_plans (RLS, yalniz service_role; 5 taban kimlik seed) + tenants/subscriptions(plan, pending_plan)/plan_entitlements CHECK listesi -> FK (mevcut satirlar ayni); plan_monthly_amount taban davranisi ayni, eklenen paket belgeden; 4 fonksiyonda yalniz plan listesi kontrolu billing_plan_known'a cevrilir (canli govde, eslesme sayisi dogrulanir)
    [F.channelRoiStatusPage]: "ek", // 4 yeni platform tablosu marketing_spend/status_incidents/status_incident_updates/release_history (RLS+FORCE, politika yok, yalniz service_role); mevcut nesnelere dokunmaz, kod tablolar yokken harcama yalniz Google Ads, /durum yalniz olculen erisilebilirlik, deploy.sh satir yazmayi atlar
    [F.officeSecuritySessions]: "ek", // yalniz 2 yeni service_role RPC (office_list_sessions / office_revoke_session; profiles.tenant_id siniri); mevcut nesne/veri degismez, kod RPC yokken oturum listesi "kurulum bekliyor"
    [F.flagRulesProductFeedback]: "ek", // 5 yeni tablo (feature_flag_rules, platform_nps_surveys/responses, product_feature_requests/votes; RLS+FORCE, politika yok, yalniz service_role) + service_role RPC platform_nps_mark_shown + oy sayaci tetikleyicisi; mevcut nesne/veri degismez, kod tablolar yokken bayraklar genel durumla calisir
    [F.billingVatRateInvoices]: "davranis", // fulfill_billing_payment canli govdesinde yalniz 4 `round(v_amount_try * 0.20, 2)` -> faturanin orani (meta.vatRate yoksa 0.20: mevcut faturalar ayni), growth_cash_net bolen ayni kural; yeni billing_invoice_vat_rate + billing_vat_rate_ready (service_role); veri degismez
    [F.clAppCanonicalLinks]: "davranis", // portal_account_report_login govdesi AYNI, yalniz bildirim href'i yeni Entegrasyonlar sayfasina; notifications/insights.href eski /app yollarindan kanonik yollara (yalniz href, idempotent); kod yayiniyla ayni pencerede
    [F.financePartyAdvisorScope]: "siki", // finance_parties/finance_open_items SELECT politikasi + 8 finance_* RPC govdesi: earnings_all olmayan kullanici baska danismanin carisini goremez/yazamaz; finance_aging ek "vadesiz" kova satiri (imza ayni)
    [F.financeEntriesAdvisorScopeRecurringTerms]: "siki", // cash_entries SELECT politikasi: earnings_all olmayan kullanici baska danismanin carisine bagli hareketi goremez (finance_ledger_v / finance_cash_summary devralir); yeni recurring_post_occurrence 4 arg (cari/KDV/stopaj, eski 3 arg ona devreder: kosulsuz kuralda ayni); finance_statement_apply canli govdesinde yalniz duzenli odeme cagrisi nakit kipine (eslesme sayisi dogrulanir)
    [F.platformStaffCanGates]: "davranis", // yeni platform_staff_can / platform_fixed_role_actions; 7 fonksiyon + 2 politikada rol adi -> modul x eylem (sabit rollerde sonuc ayni; ozel rolde matris); 2 buyuk govde canli tanim uzerinden tek ifade
    [F.yd4FieldCapture]: "ek", // property_media'ya 2 nullable sutun (width/height + CHECK) + yeni client_submissions (RLS: yalniz kendi kiraci+kullanici satiri); mevcut veri/davranis degismez, kod tablo/sutun yokken cift kayit frenini atlar ve boyutu yazmaz
    [F.advisorCountsRpc]: "ek", // yalniz yeni SECURITY INVOKER sayim fonksiyonu advisor_counts (RLS gecerli); kod fonksiyon yokken eski tek-tarama sayimina duser
    [F.profilesUiState]: "ek", // yalniz yeni nullable-olmayan varsayilanli profiles.ui_state ('{}') + SECURITY INVOKER profile_ui_state_mark (kendi satiri, RLS); kod sutun/fonksiyon yokken yalniz localStorage ile calisir
    [F.onboardingSnapshotRpc]: "ek", // yalniz yeni SECURITY INVOKER fonksiyon onboarding_snapshot (kurulum olgulari jsonb); kod fonksiyon yokken eski ayri sayimlara duser
    [F.kq2CommissionsRls]: "davranis", // commissions_select yeniden yazimi: anlam ayni (can_view_commission_earnings ile esdeger, pgTAP), satir basina DEFINER cagrisi yerine InitPlan + korelasyonsuz IN; plan degisir
    [F.kq2LcFinanceRls]: "davranis", // 6 ilan kontrol + 2 ekstre SELECT politikasi: anlam ayni (lc_row_visible / finance_account_access ile esdeger, pgTAP); 4 yeni INVOKER kapsam yardimcisi (yalniz authenticated)
    [F.kq2IdentityCache]: "davranis", // current_active_tenant_id / current_profile_role / has_effective_permission sonuc islem-yerel onbellek (app.ctx_*); mantik ayni; 8 kimlik tablosuna AFTER STATEMENT nesil tetikleyicisi
    [F.kq2MetricsSinglePass]: "davranis", // get_metrics_snapshot govdesi tablo basina tek gecis (count FILTER); cikti sozlesmesi ayni (eski govdeyle anahtar anahtar esit, pgTAP)
    [F.kq2IndexHygiene]: "davranis", // 1 yeni kismi indeks (commission_splits commission_id, profile_id) + 2 kesin yinelenen indeks (idx_customers_tenant, idx_demands_tenant_status) dusurulur; kapsayan indeks dogrulanir
    [F.kq2AgentPhotosLimits]: "siki", // agent-photos kovasi: 3 MB + jpeg/png/webp (uygulama zaten ayni siniri uygular); mevcut nesneler etkilenmez
    [F.kq2RevokeAnonRpcs]: "siki", // anon/PUBLIC EXECUTE geri alinir: aidat_kpi, tcmb_rate_on, increment_template_usage (+ tetikleyici fonksiyonlari); anon cagiran yok, authenticated/service_role korunur
    [F.kq2RealtimeTrim]: "davranis", // supabase_realtime yayininda kodda abone olunmayan tablo DROP (canlida 21/21 abone listesinde: hicbir tablo cikmaz); iz yayin yorumunda
    [F.sk2TenantBroadcast]: "davranis", // 2 yeni DEFINER tetikleyici fonksiyonu (rt_emit_tenant_change deyim duzeyi, rt_emit_notification satir duzeyi) + 30 tabloda AFTER INSERT/UPDATE/DELETE FOR EACH STATEMENT + notifications AFTER INSERT; tetikleyici hatasi yazimi DUSURMEZ (WARNING); realtime.messages okuma politikalari yalniz sahibi rolde (yoksa NOTICE, supabase_admin adimi); tablo/veri degismez
    [F.sk2RealtimeTrim]: "davranis", // supabase_realtime yayinindan sayfa tablolari cikar (kalan: support_ticket_messages/attachments, personel gorunumu); Broadcast okuma politikalari YOKSA hicbir sey yapmaz; geri alma statik listeyi geri ekler
    [F.tenantOnboardingFacts]: "ek", // yalniz yeni salt-okunur service_role fonksiyonu platform_tenant_onboarding_facts (ofis bazinda kurulum olgulari); mevcut nesne/veri degismez, kod fonksiyon yokken kurulum ilerlemesi "kurulum bekliyor", saglik skoru kurulum girdisiz
    [F.appointmentNotificationDeepLinks]: "davranis", // create_public_booking_atomic / respond_appointment_confirmation_atomic govdeleri AYNI, yalniz bildirim href'i /app/randevular?randevu=<id>; mevcut bildirim satirlari degismez
    [F.appointmentCustomerMessages]: "ek", // appointments'a 2 nullable sutun (customer_confirm_sent_at, customer_reminded_at); mevcut satir/davranis ayni, kod sutunlar yokken musteri hatirlatma adimini atlar
    [F.yd7RoleTimeouts]: "davranis", // rol ayari: anon 3s / authenticated 8s / authenticator 8s statement_timeout (canlidaki Supabase varsayilani, gevsemez) + service_role 60s (PostgREST taklidinde authenticator'in 8s'i yerine; sunucu/cron yollari kisalmaz) + 4 rolde idle_in_transaction 60s; superuser ise veritabani log_min_duration_statement 1s (degilse NOTICE, supabase_admin ile elle); tablo/veri degismez
    [F.yd7GeoStatsMv]: "davranis", // geo_province_stats / geo_district_stats duz gorunumden AYNI ad ve kolonlarla materialized view'a (+ yeni geo_level_counts, refresh_geo_stats yalniz service_role); sayim son yenilemedeki durum (cron gunluk + /admin/geo yazimi sonrasi), anon/authenticated okuma izni kalkar (kodda okuyan yok); veri degismez
    [F.sk6ReportingLocalAxis]: "davranis", // tenant_reporting/commission_aggregates eksen Istanbul yerel ayi + 'ym'; ofis geneli RPC kullanicidan bagimsiz (kiraci onbellegi), izleyene gore degisen komisyon/gider yeni tenant_reporting_viewer_aggregates'ten; gider serisi yalniz expenses:view (yoksa null)
    [F.sk6FinancePnlVatFix]: "davranis", // finance_pnl komisyon geliri = matrah - dis paylar (KDV yalniz bilgi); finance_vat_summary acik kalem KDV'sini duzenleme ayinda sayar; finance_open_item_settle tahsilata oransal KDV yazar; yeni finance_budget_vs_actual_for (yalniz service_role); imza/ACL ayni
    [F.sk6RentalKpiOverdue]: "ek", // rental_kpi_snapshot'a period_overdue + period_total anahtarlari; eski anahtarlar ve anlamlari ayni (SECURITY INVOKER, ACL ayni)
    [F.sk6CommissionSplitsDeriveRate]: "davranis", // commission_normalize_splits: oran yoksa pct/tutardan turetilir, 'Ofis' etiketi office, tutarsiz oran/tutar 23514; yalniz demo 1be1a3b9 kaydi yeniden yazilir (gercek ofis verisi degismez)
    [F.sk6TenantIsInternal]: "davranis", // tenants.is_internal (varsayilan false, tablo yeniden yazilmaz) + yalniz e2e-test/admin/demo-ofis true + bayragi yalniz sunucu degistirir (BEFORE INSERT/UPDATE OF is_internal tetikleyicisi 42501); gercek ofis verisi degismez
    [F.sk6PlatformReportingLocalAxis]: "davranis", // platform_reporting_aggregates ic ofisleri dislar, p_from/p_to ve ay/hafta ekseni Istanbul, plan ekseni gizli paketleri kapsar, mrr_trend platform_mrr_daily ay sonu anlik goruntusunden (goruntusuz ay satir yok), summary.missing_subscription_count/internal_count; imza/ACL ayni
    [F.sk9PropertyCurrency]: "davranis", // properties.currency (TRY|USD|EUR, not null default TRY, CHECK) + features.currency'den backfill + doviz kayitlarinda turetilmis price_health temizligi (gece tazelemesi/duzenleme ₺ karsiligiyla yeniden yazar)
    [F.sk9PublishGateCounts]: "siki", // transition_property_status_atomic 'live' icin il/ilce + tamamlanmis ilan sahibi kaydi ister (publish_blocked); portfolio_counts ciktisina sale_stock_value/sale_stock_fx/rent_monthly_total eklenir (imza ayni); property_portal_presence yeni saf fonksiyon
    [F.b1TeamHandoffWorkload]: "ek", // yalniz yeni SECURITY DEFINER fonksiyon team_handoff_workload (team:edit + kapsam modulu edit, aktif ofis siniri, audit ayni transaction'da; yalniz authenticated); kod fonksiyon yokken eski tablo tablo devre duser
    [F.p5BranchRollupRpc]: "ek", // yalniz yeni salt-okunur fonksiyon branch_rollup (SECURITY INVOKER, yalniz authenticated, RLS gecerli); kod fonksiyon yokken eski sayfali taramaya duser
    [F.yd7BatchCountRpcs]: "ek", // yalniz 5 yeni salt-okunur fonksiyon: offer_counts / demand_counts / target_activity_counts (SECURITY INVOKER, yalniz authenticated, RLS gecerli) + kvkk_customer_related_counts / ef_credit_balances (yalniz service_role); kod fonksiyon yokken eski ayri sorgulara duser
    [F.sk1FinanceFxInline]: "davranis", // finance_fx ayni sonuc, SET search_path kalkar + nitelikli isleçler: cagiran sorguya inline (yalniz plan); grant'lar korunur
    [F.sk1PgrstWatchScope]: "davranis", // extensions.pgrst_*_watch yalniz public/storage/graphql_public DDL'inde NOTIFY; fonksiyon sahibi (supabase_admin) degilse no-op (scripts/sunucu/pgrst-watch-scope.sh)
    [F.sk1ProxyGateSessionAlive]: "davranis", // proxy_gate_snapshot'a session_alive (auth.sessions; cikis/iptal edilen oturum bir sonraki istekte reddedilir) + staff_access (admin modul kapisi proxy'de); session_alive SECURITY DEFINER yalniz cagiranin kendi oturumu
    [F.sk1PlatformNotificationFeed]: "ek", // yeni salt-okunur fonksiyon (SECURITY INVOKER, yalniz authenticated, RLS: staff_id = auth.uid()); kod fonksiyon yokken eski iki sorguya duser
    [F.sk4AdminStaffBroadcast]: "ek", // yeni DEFINER tetikleyici fonksiyonlari (rt_emit_staff_change deyim duzeyi, rt_emit_staff_notification satir duzeyi) 5 admin tablosu + platform_notifications'a AFTER tetikleyici; realtime.send ile yalniz kimlik iceren <=200 B olay (kisisel veri yok) + realtime.messages'a yalniz aktif personel SELECT politikasi ('admin:staff', 'staff:<uid>'); mevcut veri/RLS degismez, realtime semasi yoksa gonderim sessiz gecer
    [F.sk4ReplySupportTicketV3]: "davranis", // yeni reply_support_ticket_v3 (ofis public yaniti open/in_progress durumunu korur, waiting -> ilk yanita gore open/in_progress); v2 ayni imzayla v3'e devreder; TEK SEFERLIK veri duzeltmesi in_progress + ilk yanitsiz + atanmamis -> open (canlida 1 satir; geri alinmaz)
    [F.sk4AdminSearchMembers]: "ek", // yalniz yeni salt-okunur DEFINER fonksiyon admin_search_members (yalniz service_role; ad + auth.users e-posta); kod fonksiyon yokken uyeyi yalniz adla arar
    [F.sk7CustomerSearchFold]: "ek", // customers'a 2 GENERATED STORED sutun (search_fold = fold_tr(ad + e-posta), phone_digits) + 3 indeks + lookup_customer_by_phone (SECURITY DEFINER, kiraci + customers:view sartli, yalniz ad / maskeli telefon / danisman adi); mevcut satir ve davranis ayni, birlestirme yok
    [F.sk10ScopeRls]: "siki", // kapsam fonksiyonlari (scope_context/scope_owner_ids/scope_enforced/scope_allows, GUC onbellekli) + 6 ana tablonun SELECT/UPDATE/DELETE politikasina kapsam ve silinmis kayit kosulu; 'office.access.scope_enforcement' KAPALIYKEN sonuc kumesi degismez (bayrak hicbir ofiste acik degil), owner/gm her zaman ofis geneli
    [F.sk10ModuleWritePolicies]: "siki", // 26 tablonun yalniz-kiraci yazma politikasina modul izni (uygulama eylem kapisiyla ayni) + 4 cron tablosunda authenticated/anon yazma REVOKE; okuma politikalari birebir korunur
    [F.sk10TrpGmGuardReadonlySupport]: "davranis", // gm kendi rol satirini ve kimse owner satirini yazamaz; readonly support:view; profile_ui_state_mark SECURITY DEFINER (salt okunur tur durumu kaydedilir; readonly tetikleyicisi degismez)
    [F.sk10PoolBranchGuard]: "siki", // assign_pool_entry: sube muduru yalniz kendi subesindeki ilani kendi subesindeki kisiye atar; subesiz sube muduru atayamaz
    [F.notificationsDedupeCleanup]: "davranis", // yalniz veri: dedupe_key NULL 'Portal teyit gecikti' satirlari ilan basina en yeniye, gelecek tarihli anahtarsiz kopyalar en yeniye iner, kalan gelecek created_at now(); sema/fonksiyon degismez, geri alma islem yapmaz (PITR)
    [F.demoTenantNightlyReset]: "ek", // yeni demo_reset_state tablosu + demo_tenant_nightly_reset (service_role); kod fonksiyon yokken adimi atlar; fonksiyon yalniz slug=demo-ofis kiracisinda calisir
    [F.yd8ErrorLogsCspSource]: "davranis", // record_error_occurrence govdesi AYNI, yalniz dakikalik hata sayaci kosuluna p_source <> 'csp'; imza/yetki ayni; kod migration yokken de yazar (yalniz CSP satirlari sayaca girer)
    [F.p2CampaignAudienceFilters]: "davranis", // create_campaign_with_recipients filtre izin listesi genisler (tag/district/advisor); kiraci/kara liste/telefon kapilari ve imza/ACL ayni; all|type:* davranisi ayni
    [F.yd8StaticLegalPagesOn]: "davranis", // yalniz ayar satiri: statik.routes YOKSA 8 yasal sayfa acik yazilir (varsa dokunulmaz); proxy 30 sn icinde yasal sayfalari JS'siz statik sunar, donusum basarisizsa normal HTML yedegi
    [F.sk8PublicSurfaces]: "ek", // offers.owner_visible_note (nullable, <=2000) + increment_share_view(text) SECURITY DEFINER yalniz service_role; veri degismez; kod sutun/RPC yokken aciklamayi gostermez/yazmaz, paylasim sayaci atlanir
    [F.a3CustomerContactPrefs]: "ek", // yalniz uc sutun (nullable / bos dizi varsayilanli) + CHECK; RLS/yetki ayni; kod sutunlar yokken tercih karti "kurulum bekliyor", NBA tercihsiz
    [F.p4CustomerFilesValidUntil]: "ek", // yalniz nullable sutun + kismi indeks; RLS/yetki ayni; kod sutun yokken tarihsiz listeye duser
    [F.b4TenantVitrinSeoMeta]: "ek", // yalniz iki nullable sutun + uzunluk CHECK'i; RLS/yetki ayni; kod sutunlar yokken SEO kalibina duser
    [F.m3DemoResetNotificationReads]: "ek", // yalniz demo_tenant_nightly_reset govdesi (create or replace): demo kiracinin notification_reads satirlari da silinir; slug kapisi ve yetkiler ayni; tablo yoksa adim atlanir
    [F.wp1FinancePostingCore]: "davranis", // cash_entries/finance_open_items posting_key (kiraci basina tekil) + event_type + reversal_of, finance_open_items.invoice_id, cash_entries.source_type CHECK genisler, eski kaynak tekilligi yalniz posting_key'siz satirlara; finance_posting_rules (yalniz definer okur); finance_post/finance_reverse (authenticated, modul izni + owner/gm + P12) ve ic surumleri (yalniz service_role); acik kalem odeme hesabi ayna kayitlari isaretli sayar (mevcut satirlarda sonuc ayni); audit_logs tetikleyicileri
    [F.wp1FinanceOpenItemsV3]: "davranis", // finance_open_items_v kolonlari ayni: komisyon alacagi brut+KDV-net tahsilat (eskisi KDV kadar eksik), posting_key'li kalemi olan kaynak tekrar etmez, bina/aidat/hakedis kollari + cari cozumu; finance_v2_source_visible 'payout' commissions:view
    [F.wp2FinanceAccrualTriggers]: "davranis", // commissions/commission_splits/commission_payouts/building_charges AFTER tetikleyicileri finance_post_internal ile YALNIZ tahakkuk yazar (commission:{id}, split:{id}, payout:{id}:approved, building_charge:{id}); tutar degisimi ters kayit + :r{n} surumu, iptal/silme ters kayit; tahsil edilmis kalem degistirilemez (kaynak yazimi durur); finance_open_items.offbook_amount (kasa disi) + recompute tabani; eski yol tahsilat hareketi (commission/building) kaleme baglanir
    [F.wp2FinancePartiesBackfill]: "davranis", // tek seferlik idempotent geri doldurma: danisman/musteri/kiraci/malik carileri (ON CONFLICT DO NOTHING) + tahakkuk kalemleri + eski hareketlerin open_item_id bagi + kasa disi taban; nakit yazmaz
    [F.wp2FinancePnlV3]: "davranis", // finance_pnl/finance_vat_summary (p_from, p_to, p_basis default 'tahakkuk'): iki parametreli surum DUSER (cagiranlar ayni kolonlari alir); komisyon brut + danisman pay gider satiri (net ayni), emanet kategorileri haric, ayna kayitlar eksi, KDV fatura ayinda
    [F.a1MergeCustomersV2]: "davranis", // merge_customers 4 arg -> 5 arg (p_overrides jsonb varsayilanli; eski cagri calisir): tasima listesi pg_constraint'ten dinamik (customers(id)'ye FK veren TUM sutunlar, benzersiz anahtarda cakisan satir kopyada kalir), farkli telefon/e-posta + kopya notlari ana kaydin notuna; yeni merge_fk_refs (yalniz service_role) + merge_preview_counts (authenticated; ofis + customers|properties:delete govdede)
    [F.a1MergeProperties]: "ek", // yeni SECURITY DEFINER merge_properties (authenticated; oturum + ofis + properties:delete govdede; tum properties(id) FK'leri + share_links + medya kapak/sira + soft delete + audit); mevcut nesnelere dokunmaz
    [F.crmG4DemandPropertyMatches]: "ek", // yeni tablo demand_property_matches (RLS: ofis + matching izni + talebi gorebilme; silme yalniz cascade); mevcut nesnelere dokunmaz, kod tablo yokken bos durum kumesiyle calisir
    [F.ga14AppointmentOutcomeNoshow]: "ek", // appointments_outcome_check genisler ('gelmedi' eklenir); RLS/yetki ayni, mevcut satirlar gecerli
    [F.a8DealStageHistory]: "davranis", // deals'e stage_changed_at/expected_close_date/closed_at + eklemeli deal_stage_events (tek yazar AFTER UPDATE OF stage tetikleyicisi; authenticated yalniz okur, RLS kiraci + anlasma gorunurlugu) + audit_logs'tan geri doldurma; transition_deal_stage_atomic yeni surum (islem yapani GUC'a yazar, govde ayni); deal_stage_velocity + rapor yardimcilari (SECURITY INVOKER)
    [F.a8TargetsScopeCalls]: "davranis", // targets.team_id/branch_id (en cok bir kapsam CHECK) + target_calls; olu target_demands kolonu DUSER; cift yoksa kapsam+donem benzersiz indeksleri; target_progress_counts (SECURITY INVOKER)
    [F.a8ReportPeriodFunnel]: "ek", // yalniz yeni SECURITY INVOKER fonksiyonlar: report_period_overview (donem + onceki donem, sube/takim/danisman kapsami) ve report_sales_funnel (kohort huni, kaynak maliyeti); komisyon earnings_all, gider expenses:view kapili
    [F.wp5EinvoiceLedgerLink]: "davranis", // einvoices.party_id + open_item_id; einvoices durum tetigi: issued -> kaynak (komisyon) alacagina bag ya da serbest faturada invoice.issued alacagi (finance_post_internal), cancelled/error -> finance_reverse_internal; komisyon alacagi acilinca faturaya bag; resmilesmis faturalara cari + bag geri doldurmasi (gecmise alacak acilmaz); fonksiyonlar yalniz service_role
    [F.a6CampaignReportRpc]: "ek", // campaign_report + campaign_recipient_page (SECURITY INVOKER, kiraci kosullu); tablo degismez
    [F.a6InboxConversationState]: "ek", // communications/calls.resolved_at + resolved_by (nullable) + inbox_conversations (SECURITY INVOKER)
    [F.a6CommunicationsBodyTrgm]: "ek", // yalniz GIN trigram indeksleri (communications.body/contact_address, calls.phone)
    [F.a7AutomationTriggerInbound]: "ek", // yalniz enum degeri ekler (inbound_message, lead_form_submitted; idempotent); tablo/politika/veri degismez
    [F.a7MessageSequences]: "ek", // yeni tablolar (message_sequences/_steps/_enrollments/_step_runs) + RLS; mevcut tablo degismez
    [F.a7InboundMediaBucket]: "ek", // ozel storage kovasi inbound-media (politika eklenmez; yalniz service_role)
    [F.a7SurveyReviewClick]: "ek", // surveys.review_clicked_at nullable sutun + kismi indeks
    [F.a9AuthLoginThrottle]: "ek", // auth_login_throttle (opak kova) + peek/fail/clear RPC yalniz service_role; kod RPC yokken eski sabit pencereye duser
    [F.a9OfficeTotp]: "davranis", // profiles.two_factor_method + yontem surum tetigi + two_factor_recovery_codes; current_session_two_factor_satisfied TOTP+AAL2 oturumu da kabul eder
    [F.c2RentalApplications]: "ek", // rental_application_links/rental_applications/rental_application_files + rentals.guarantor_* nullable + saklama RPC'si (yalniz service_role); public yazma yalniz service_role
    [F.c2RentalInspections]: "davranis", // rental_inspections/photos/deposit_deductions + rental_deposit_post govdesi (imza ayni): iade hareketi depozito - kesintiler; kesinti yokken davranis ayni
    [F.c3BuildingBudgetAnnouncements]: "ek", // yeni building_budgets + building_announcements (RLS) + building_charge_batches.budget_id nullable sutun + 3 RPC (SECURITY DEFINER, search_path '', yetki iceride); mevcut tahakkuk akisi degismez
    [F.b9InsightStalledDealsStage]: "davranis", // insight_stalled_deals DROP + CREATE (donus tablosuna stage_changed_at/expected_close_date/close_overdue_days; hareketsizlik asamada gecen gunden; beklenen kapanisi gecmis acik anlasma da aday); SECURITY DEFINER + search_path '' ayni, yalniz service_role
    [F.c0FinanceHrefs]: "davranis", // WP6 rota tasima: finance_open_items_v / finance_party_statement / recurring_notify / fulfill_billing_payment / notification_topic_from_href yeni href'lerle (govdeler ayni, SECURITY DEFINER + search_path ayni); notifications/insights/saved_views href donusumu; finance_saved_views.tab duzenli->tekrarlayan
    [F.c1CustomerContacts]: "davranis", // yeni tablo customer_contacts (RLS: ofis + customers:view/edit + musteri gorunur) + customers.contacts_fold (tetikleyici) + lookup_customer_by_phone ek numaralara da bakar + KVKK silme tetigi
    [F.c1CustomerRelations]: "ek", // yeni tablo customer_relations (iki musteri de gorunur olmali) + KVKK temizligi iliskileri de siler
    [F.c1CommPinMention]: "davranis", // communications.pinned_at/pinned_by/mentioned_user_ids/origin + customers.notes serbest metninin "Onceki notlar" kopyasi (kaynak metin degismez)
    [F.c1HeatEngagement]: "davranis", // customer_heat_signals DROP + CREATE (dijital ilgi kolonlari) + aktarilan eski not son temas sayilmaz; customer_lead_signals ayni kuralla
    [F.c1MergeContacts]: "davranis", // merge_customers v3: farkli telefon/e-posta nota degil customer_contacts'a; iliskiler satir satir tasinir
    [F.a9KvkkSubjectExports]: "ek", // kvkk_subject_exports (degismez dokum, yazma yalniz service_role, okuma compliance:view, 90 gun)
    [F.b1VitrinListingSearch]: "ek", // yalniz yeni salt-okur RPC'ler (vitrin_listing_search/_facets, vitrin_json_number), EXECUTE yalniz service_role; kod RPC yokken eski sorguya duser
    [F.b1PropertyNearbyPlaces]: "ek", // properties.nearby_places jsonb (varsayilan bos dizi) + sekil CHECK; mevcut veri degismez
    [F.b3PropertyMediaRoomTag]: "ek", // property_media.room_tag + caption (nullable, CHECK); RLS/veri degismez, kod sutunlar yokken alanlari gizler
    [F.b4OfferTerms]: "ek", // offers'a nullable kosul sutunlari + malik karsi teklif sutunlari + owner_counter_offer_atomic (yalniz service_role, outbox bildirimi); teklif durumu/tutari degismez
    [F.b4ContractsDealLink]: "davranis", // contracts.deal_id/offer_id (bilesik FK, set null) + tek adayli eslesmelerin bir kerelik geri doldurmasi
    [F.b4ContractEvidence]: "davranis", // contracts.body_sha256/verify_code + imzaci kanit sutunlari; ozet yazildiktan sonra baslik/govde kilit tetigi
    [F.b4RentalWithholding]: "davranis", // rentals.usage/withholding_rate/handover_steps + rent_charges.withholding_amount; oran > 0 ise yeni tahakkuk NET yazilir (BEFORE INSERT tetigi); varsayilan oran 0 = bugunku davranis
    [F.b4LedgerAutoSource]: "ek", // compliance_ledger_entries.source (manual|auto) + otomatik satir tekillik indeksi; mevcut satirlar 'manual'
    [F.b5ProjectUnitPricing]: "ek", // project_unit_price_history (yalniz tetik yazar, okuma projects:view) + liste fiyati AFTER UPDATE tetigi + bulk_reprice/undo/import RPC (DEFINER, kiraci + projects yetkisi; satilmis/odeme planli daire degismez)
    [F.b5ProjectPublicPage]: "ek", // projects.share_token/share_enabled/share_show_prices/shared_at (varsayilan kapali) + project_media (ekleme yalniz service_role) + ozel project-media kovasi
    [F.b6CsPlaybooksNudges]: "ek", // platform_tasks'a nullable source_rule/dedupe_key + varsayilanli priority (UNIQUE) ve yeni tenant_lifecycle_nudges (yalniz service_role); mevcut veri degismez
    [F.b6TenantUsageRpcs]: "ek", // yeni INVOKER RPC'ler (yalniz service_role) + platform_insights.kind CHECK genisler (revenue_opportunity); mevcut veri degismez
    [F.b8TvDevices]: "ek", // yeni tablolar tv_devices (okuma yonetici + reports:view, token_hash kolonu kapali) + tv_pairing_codes (yalniz service_role) + tv_device_pair/tv_device_revoke (SECURITY DEFINER, denetim kaydi)
    [F.b8DutyShifts]: "ek", // yeni tablo duty_shifts (okuma ofis, yazma team:edit, nobetci ayni ofisin aktif uyesi tetigi); mevcut nesnelere dokunmaz
    [F.b8CoachingSessions]: "ek", // yeni tablolar coaching_sessions/_commitments + coaching_can_view (danisman, yonetici, owner/gm, ayni sube muduru) + danisman yalniz done_at tetigi
    [F.b8ApprovalDelegate]: "davranis", // approval_actor_can_decide genisler: eski kosul VEYA suresi dolmamis vekil onaylayici; yeni approval_delegations (owner/gm + settings:edit yazar) + approval_actor_is_delegate
    [F.wp4PropertyDuesOpenItems]: "davranis", // property_dues -> finance_open_items (source_type due, tek seferlik geri doldurma, odenmis = kasa disi) + property_dues authenticated yazma REVOKE; finance_due_* RPC (iptal, silme yok) + aidat_kpi acik kalemden; rental_deposit_post/unpost (depozito kategorisi); cash_entries kaynak carisi tetigi + geri doldurma (yalniz party_id); owner_charge_links 'due' politikasi acik kalemi dogrular
    [F.messageLog]: "ek", // yeni platform tablosu message_sends (RLS acik, politika yok, yalniz service_role) + message_log_prune RPC; mevcut nesnelere dokunmaz, kod tablo yokken gonderim surer ve gunluk atlanir
    [F.financeRecurringRuleTerms]: "ek", // yalniz yeni RPC recurring_rule_set_terms (security definer, recurring_rule_access edit kapisi; eski recurring_* imzalari ve recurring_run_due degismez); govde FN1 sutunlarini calisma aninda cozer, kod RPC/sutun yokken kural yine kaydedilir
    [F.alertEnginePulseRule]: "ek", // alert_rules CHECK mevcut tanimdan genisler (engine_stalled) + tek tohum satiri (acik, 20 dk, 60 dk); mevcut veri degismez, kod satir yokken varsayilanla calisir
    [F.platformKvkkRequests]: "ek", // yeni platform_kvkk_requests (RLS+FORCE, politika yok, yalniz service_role) + alert_rules CHECK mevcut tanimdan genisler (kvkk_sla) ve tek tohum satiri; mevcut veri degismez, kod tablo yokken form "e-posta ile yazin" der
    [F.legalHelpContent]: "ek", // 5 yeni tablo (legal_documents/consents/constants, help_articles/votes; RLS+FORCE, REVOKE; yalniz service_role); mevcut nesnelere dokunmaz, kod tablolar yokken koddaki icerikle calisir
    [F.financeEntriesManualReconcile]: "ek", // yeni DEFINER RPC finance_entries_set_reconciled (hesap edit erisimi + maas gizliligi; yalniz cash_entries.reconciled_at yazar); mevcut veri degismez, kod RPC yokken "kurulum bekliyor" der
    [F.financeAttachmentStorage]: "davranis", // storage.objects'e 3 politika (yalniz expense-receipts {tenant}/ledger/ yollari, expenses izni) + yardimci fonksiyon; einvoices/einvoice_connections OKUMA politikasina expenses:view eklenir (yazma degismez); mevcut veri degismez
    [F.googleData]: "ek", // 3 yeni platform tablosu (RLS acik, politika yok, yalniz service_role) + google_data_prune/seo_gsc_summary (service_role); mevcut nesnelere dokunmaz, kod tablolar yokken "veri yok"
    [F.subscriptionOps]: "davranis", // kapasite tetikleyicileri + effective_seat_limit ofise ozel istisnayi sayar (istisna yokken sonuc ayni); yeni tablo tenant_entitlement_overrides (RLS+FORCE, personel okur, service_role yazar) + 4 nullable sutun
    [F.platformCrm]: "ek", // 7 yeni platform tablosu (RLS+FORCE, politika yok, yalniz service_role; FK tenants/platform_staff) + salt-okunur platform_tenant_health_inputs (service_role); mevcut nesnelere dokunmaz, kod tablolar yokken "CRM kurulumu bekliyor"
    [F.announcementCenter]: "ek", // platform_announcements'a varsayilanli sutunlar + audience listesi genisler; 5 yeni tablo (RLS; ofis yalniz kendi hedefli banner/yayinlanmis yenilik okur) + notifications uzerinde WHEN (meta ? 'pad') kosullu okundu tetikleyicisi + service_role RPC'ler; mevcut veri degismez, kod tablolar yokken eski anlik duyuruya duser
    [F.invoiceLinesCreditNotes]: "davranis", // 2 yeni tablo (invoice_lines geriye donuk tek satirla dolar; credit_notes) + invoices uzerinde YALNIZ meta.refund ilk yazildiginda dekont yazan AFTER UPDATE tetikleyicisi + service_role RPC platform_create_manual_invoice; odeme akislari degismez, kod tablolar yokken satiri faturadan turetir
    [F.dunningEvents]: "ek", // yeni tablo dunning_events (RLS acik, politika yok, yalniz service_role; tenants/invoices FK cascade); mevcut nesnelere dokunmaz, kod tablo yokken yalniz uygulama ici kademe (bugunku davranis)
    [F.platformMemberSearch]: "ek", // yeni salt-okunur SECURITY DEFINER RPC platform_member_search (yalniz service_role; platform_growth_funnel deseni); tablo/politika/veri degismez, kod RPC yokken eski profil sorgusuna duser
    [F.portalTransferSessions]: "ek", // yeni tablo portal_transfer_sessions (RLS + acik grant) + 6 JWT SECURITY DEFINER RPC (pt_*; lc_bind_portal_listing sarilir); mevcut tablo/politika/veri degismez, kod tablo yokken sistem guncellemesi bekleniyor durumuna duser
    [F.fsboRealtime]: "ek", // fsbo_leads realtime yayinina eklenir (idempotent) + dar SECURITY DEFINER RPC insight_close_fsbo_lead (yalniz valid_until); tablo/politika/veri degismez
    [F.detailReadRpcs]: "ek", // 2 yeni SECURITY INVOKER okuma RPC'si (deal_side_reads, property_region_days); tablo/politika/veri degismez
    [F.marketRates]: "ek", // yeni market_rates tablosu (authenticated SELECT, service_role yazma); mevcut nesnelere dokunmaz
    [F.serviceRoleWriteGrants]: "ek", // yalniz eksik GRANT (insert/update); delete yok, tablo/politika/veri degismez
    [F.storageCleanupReceipts]: "ek", // rent-receipts outbox kova izni + dekont yolu silinince/degisince tetikleyici + kismi indeks; mevcut veri/govde degismez
    [F.insightCloseOnContact]: "ek", // yeni dar SECURITY DEFINER RPC (insight_close_call_priority; yalniz valid_until); tablo/politika/veri degismez
    [F.appShellPlatformStaff]: "ek", // app_shell_bootstrap govdesi birebir + yeni platform_staff alani (CREATE OR REPLACE); tablo/politika/veri degismez
    [F.portalRequestsV2]: "davranis", // portal_customer_request govdesi genisler (3 yeni tur) + kind CHECK genisler; 2 yeni istek tablosu + owner_portal_tokens.weekly_report_enabled
    [F.recurringRunErrors]: "davranis", // recurring_run_due govdesi ayni; donusune errors dizisi (en cok 20: rule_id, step, code, message) eklenir
    [F.customerPortalRequests]: "ek", // yeni portal_customer_requests (iz) + anon/authenticated DEFINER RPC portal_customer_request (token icerde dogrulanir; yalniz taslak teklif/gorev/bakim yazar) + portal_customer_request_ready
    [F.closureLossAnomalies]: "davranis", // listing_anomalies.type CHECK'ine closure_loss; listing_closures AFTER tetikleyicisi + tek seferlik uzlastirma (yalniz 'explained' satir, SLA yok); lc_closure_loss_ready yoklamasi
    [F.webhookEnqueueGate]: "siki", // webhook_enqueue modul izni + 30 sn tekrar freni; webhook_mark_delivery yalniz kuyruga yazan + ilk deneme; webhook_deliveries.enqueued_by
    [F.webhooksApiKeys]: "ek", // yeni api_keys/webhook_endpoints/webhook_deliveries + RLS (ayarlar:edit) + 3 DEFINER RPC (api_v1_list anon'a acik, yalniz anahtar ozetiyle okur)
    [F.customFields]: "ek", // yeni custom_field_defs/values + RLS (okuma ust kayit gorunurlugu, yazma modul edit) + 2 INVOKER yardimci fonksiyon
    [F.dealGosFields]: "ek", // deals'a 2 nullable kolon (gos_reference_no + CHECK, title_deed_appointment_at) + kismi indeks; politika degismez
    [F.reportSubscriptions]: "ek", // 3 yeni tablo (report_saved_views, report_subscriptions, report_subscription_runs; ofis satirlari tenant+sahip RLS, platform satirlari yalniz service_role) + abonelik tavan/zaman tetikleyicisi ve alici cikis RPC (report_subscription_leave); mevcut nesnelere dokunmaz, kod tablolar yokken "kurulum bekliyor"
    [F.presentationFeedback]: "ek", // yeni tablo presentation_feedback (RLS: ofis + properties:view okur; yazma yalniz service_role, bilesik FK ofis siniri); mevcut nesnelere dokunmaz, kod tablo yokken bildirim yine gider, kayit atlanir
    [F.purgeSampleRpc]: "ek", // yeni SECURITY DEFINER RPC purge_tenant_sample_data (owner/gm veya service_role; yalniz is_sample=true + tenant_id satirlari) + tenants'a 3 nullable sihirbaz sutunu; kod RPC/sutun yokken eski yola duser
    [F.ga08NotificationsTopic]: "ek", // nullable topic kolonu + CHECK + BEFORE INSERT tetikleyicisi (baglantidan turetir) + gecmis satir geri doldurma + indeks; my_notification_counts govdesine 'topics' anahtari (INVOKER, RLS ayni); kod kolon/kirilim yokken tur ciplerine duser
    [F.sk5NotificationReads]: "siki", // yeni notification_reads (RLS: yalniz kendi satiri) + my_notification_counts / mark_my_notifications_read (INVOKER) + 'reads:<uid>' yayin tetikleyicisi ve realtime.messages politikasi; authenticated'in notifications UPDATE yetkisi + notifications_tenant_update politikasi KALKAR; kisisel read_at tasinir; kod tablo/RPC yokken eski sorguya duser
    [F.sk5CommissionsInheritSample]: "davranis", // commissions BEFORE INSERT/UPDATE OF deal_id: is_sample anlasmadan turer (ayni kiraci) + tek seferlik uyusmaz duzeltme (canli: yalniz demo-ofis 5 satir); geri alma veriyi geri almaz
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
    { id: "PB29-ilan-kontrol-zincir", order: 29.8, title: "Ilan kontrol: portal ilan zinciri (supersedes, acik tekil indeks, bind/rotate RPC) + rol kapsami yardimcilari + ofis ayar kolonu", files: [F.lcPortalChain, F.lcScopeHelpers] },
    { id: "PB30-ilan-kontrol-tablolar", order: 29.81, title: "Ilan kontrol: saglik/sonuc/kuyruk/cihaz + anomali/SLA/eslestirme + portfoy kontrol ozeti tablolari", files: [F.lcVerificationTables, F.lcAnomalyTables, F.lcControlState] },
    { id: "PB31-ilan-kontrol-rpc", order: 29.82, title: "Ilan kontrol: kuyruk/durum makinesi + anomali RPC'leri + KPI/liste RPC'leri + anonim agregat gorunum", files: [F.lcQueueRpcs, F.lcAnomalyRpcs, F.lcSummaryMarket] },
    { id: "PB32-icgoru-temeli", order: 29.83, title: "Zeka katmani: icgoru kuyrugu (insights) + platform ikizi + set-tabanli olgu RPC'leri/kalite gorunumu/temizlik (cron insight-engine bunlari kullanir)", files: [F.insights, F.platformInsights, F.insightSupport] },
    { id: "PB33-ilan-kontrol-worker", order: 29.84, title: "Ilan kontrol: tarayici destekli dogrulama RPC'leri + olay gunlugu + Realtime (ana ekran sayaclari)", files: [F.lcWorkerEvents] },
    { id: "PB34-takim-modeli", order: 29.85, title: "Takim modeli: teams + profiles.team_id + properties.assigned_at (ilan kontrol SLA takim lideri alicisi)", files: [F.takimTeams] },
    { id: "PB37-eids-tasinmaz-no", order: 29.88, title: "EIDS tasinmaz kimlik no (properties.eids_property_no, nullable + format CHECK)", files: [F.propertyEidsNo] },
    { id: "PB38-kiraci-hatirlatma", order: 29.89, title: "Kiraci kira hatirlatma (ayar KAPALI dogar + hatirlatma kaydi/dedupe + opt-out)", files: [F.rentReminders] },
    { id: "PB39-kira-sozlesme-baglantisi", order: 29.9, title: "Kiralamadan kira sozlesmesi (contracts.rental_id + artis maddesi alanlari)", files: [F.contractRentalLink] },
    { id: "PB40-kurumsal-yetkilendirme", order: 29.91, title: "Kurumsal rol tabanlı erişim kontrol + kapsam sistemi (danışman kısıtlaması, veri seviyesi); 000100-104 CANLIDA", files: [F.userScopes, F.scopeOverrides, F.accessAuditLog, F.hasScopeRpc, F.accessWritePolicies] },
    { id: "PB42-kabuk-rpc", order: 29.93, title: "Kabuk/ana ekran hizi: app_shell_bootstrap (tek tur kabuk) + get_insights/tasks/metrics_snapshot RPC'leri (kod RPC yoksa eski yola duser)", files: [F.appShellBootstrap, F.dashboardSnapshotRpcs] },
    { id: "PB43-ofis-merkezi", order: 29.94, title: "Ofis Merkezi: office_center permission_defaults seed'i -> pool_assignments (atama gecmisi + RLS)", files: [F.officeCenterPerms, F.poolAssignments] },
    { id: "PB44-self-servis-kurulum", order: 29.95, title: "Self-servis kurulum: ornek veri tek-tus temizleme RPC'si (purge_tenant_sample_data) + sihirbaz ofis profili sutunlari", files: [F.purgeSampleRpc] },
    { id: "PB45-bekleyen-isler", order: 29.96, title: "Bekleyen isler: eski 9 arg fulfill overload DROP -> rapor/komisyon ozetleri ornek veri kapsami -> sahiplik devri JWT RPC'leri", files: [F.planSubscriptionAmount, F.reportingSampleScope, F.ownershipTransferRpc] },
    { id: "PB46-ilan-kontrol-veri-yollari", order: 29.97, title: "Ilan kontrol veri yollari: yasam dongusu gecis kaydi -> envanter ice aktarma + eslesme kuyrugu (JWT RPC) -> ilce kirilimi + SLA yeniden acilis duzeltmesi", files: [F.lcLifecycleEvents, F.lcInventoryMatching, F.lcDistrictSlaReset] },
    { id: "PB47-crm-ozellikleri", order: 29.98, title: "CRM ozellik turu: GOS anlasma alanlari -> ozel alanlar -> API anahtari + giden webhook -> vitrin AI sohbet baglami", files: [F.dealGosFields, F.customFields, F.webhooksApiKeys, F.vitrinChatContext] },
    { id: "PB49-anket-sistemi", order: 29.99, title: "Anket sistemi: kitle x tetik matrisi (rent_renewal/tenant_annual/advisor_pulse + advisor kitlesi) + otomatik gonderim izi + dusuk puan zinciri RPC + ekip nabzi RPC; kod yokken eski davranis", files: [F.surveyMatrix] },
    { id: "PB48-medya-belge-isareti", order: 29.985, title: "KVKK P0-9: property_media.is_document (belge public'e cikmaz) + ad kurali fonksiyonu + INSERT tetikleyicisi; kod sutun yokken ad kuralina duser (sira serbest)", files: [F.mediaIsDocument] },
    { id: "PB51-persona-turu", order: 29.997, title: "Persona turu: webhook kuyrugu izin kapisi (dogrudan RPC acigi kapanir) -> potansiyel kayip tek kaynak (kapanis kaybi anomaliye) -> musteri tek portali yazma kapisi", files: [F.webhookEnqueueGate, F.closureLossAnomalies, F.customerPortalRequests] },
    { id: "PB52-kalan-isler", order: 29.998, title: "Kalan isler turu: gider fisi dosya yukleme (yukleme hatti RPC'leri) -> kira ice aktarma atomik RPC -> imza hatirlatmasi kisa baglanti", files: [F.expenseReceiptUploads, F.importRentalWithDeal, F.contractSignerReminder] },
    { id: "PB53-proxy-hiz", order: 29.999, title: "Hiz: proxy kapi okumalari tek INVOKER RPC (proxy_gate_snapshot)", files: [F.proxyGateSnapshot] },
    { id: "PB53-perf-rls-yardimcilari", order: 29.9995, title: "Perf turu 3: RLS yardimci fonksiyonlari plpgsql (tenant cozumu ~420->~60us/cagri) + customer_demands tenant/created_at indeksi", files: [F.perfIndexesRpc] },
    { id: "PB55-ilan-kontrol-eklenti", order: 29.9998, title: "Ilan kontrol eklentisi: ayristirici telemetri sayaclari (lc_parser_telemetry + lc_parser_report JWT RPC); kod yokken telemetri atlanir (sira serbest)", files: [F.lcParserTelemetry] },
    { id: "PB55-gider-butce-tekrar-portal", order: 29.99988, title: "Gider butcesi + tekrarlayan gider + portal gideri eslemesi (sira serbest, ek)", files: [F.expenseBudgetsRecurring] },
    { id: "PB54-vitrin-talep-tokeni", order: 29.9997, title: "Vitrin talep formu tokeni: varsayilan + NULL ofislere uretim (sira serbest)", files: [F.leadCaptureTokenDefault] },
    { id: "PB58-yetki-tapu-ilan-analizi", order: 29.9999855, title: "Tapu sureci adimlari + ilan analizi tablo yetkileri (sira serbest)", files: [F.grantsDealStepsListingAnalyses] },
    { id: "PB60-kabuk-gizli-moduller", order: 29.999987, title: "Kabuk RPC: kisisel gizli moduller tek turda (sira serbest, ek)", files: [F.appShellHiddenModules] },
    { id: "PB61-arama-trigram", order: 29.999988, title: "Musteri/portfoy ilike aramasi icin pg_trgm GIN indeksleri (sira serbest, ek)", files: [F.searchTrgmIndexes] },
    { id: "SEC-rol-duman-2026-10", order: 29.999989, title: "Rol duman testi guvenlik duzeltmeleri: takvim token tablosu, audit_logs/error_logs okuma siniri, gereksiz tablo yetkileri (sira serbest)", files: [F.securityCalendarTokenAuditLogs] },
    { id: "PB59-db-hiz-rls-initplan", order: 29.999986, title: "DB hiz turu: RLS initplan sarmasi + kopya indeks temizligi + kiralama KPI RPC (sira serbest)", files: [F.dbPerfRlsInitplanKpi] },
    { id: "PB60-ilan-kontrol-gunluk-tarama", order: 29.9999875, title: "Ilan kontrol gunluk eklenti taramasi: tam liste kaniti + aday detayi + lc_inventory_import (000210 sonrasi)", files: [F.lcDailySync] },
    { id: "PB62-ilan-kontrol-kaynak-sertlestirme", order: 29.9999876, title: "Ilan kontrol envanter kaynak sertlestirme: danisman csv/paste assisted + acik kayip sinyali yonetici onayi (000500 sonrasi)", files: [F.lcInventorySourceHardening] },
    { id: "PB58-gider-trend-ay-ekseni", order: 29.999985, title: "Giderler aylik trend ay ekseni tarih (UTC kaymasi duzeltmesi; sira serbest)", files: [F.expenseTrendMonthAxis] },
    { id: "PB56-regex-tekrar-siniri", order: 29.99995, title: "Gecersiz {1,512} regex duzeltmesi (kampanya claim/onay/olusturma + 2 kisit; sira serbest)", files: [F.fixRegexRepetitionLimit] },
    { id: "PB53-guvenlik-gider-ornek", order: 29.9985, title: "Guvenlik/rapor turu: properties fiyat dusurme DB kapisi + fiyat tarihcesi salt-okunur -> Giderler ornek veri kapsami", files: [F.propertiesPriceDropGuard, F.expenseSampleScope] },
    { id: "PB53-abonelik-duraklatma-yukseltme", order: 29.9992, title: "Abonelik duraklatma + planli dusurme (sutun + RPC) -> oransal paket yukseltme faturasi (fulfill/v2 tam govde)", files: [F.subscriptionPause, F.planUpgradeFulfillment] },
    { id: "PB55-profil-avatar", order: 29.99982, title: "Profil fotografi / hazir avatar (sutun + avatars kovasi + set_my_avatar RPC; sira serbest)", files: [F.profileAvatar] },
    { id: "TR1-yetki-durumu", order: 29.99986, title: "Portfoy yetki (EIDS) durumu sutunlari (kod sutun yokken kuyrugu 'olculemedi' gosterir; sira serbest, ek)", files: [F.propertyAuthorityStatus] },
    { id: "PB55-lig-2", order: 29.99985, title: "Lig 2.0: ofis ayarli puan kurallari + meydan okuma tablolari (kod tablo yokken varsayilan kurallara duser)", files: [F.leagueV2] },
    { id: "MOD1-kisisel-modul-gizleme", order: 29.99987, title: "Kisisel modul gizleme tablosu (yalniz gorunurluk; sira serbest, ek)", files: [F.userModulePrefs] },
    { id: "PB60-sureli-kontor", order: 29.9999868, title: "Sureli kontor: ef_credit_lots (parti) + FIFO harcama + yanma RPC'si + eski bakiyeler 12 aylik partiye; 20261008001000 (tarife/katalog seed) ONCE; kod sema yokken paket satisini kapali tutar", files: [F.efCreditLots] },
    { id: "P1-fiyat-2026-10", order: 29.999861, title: "Fiyatlandirma 2026-10: plan_monthly_amount yedek fiyatlari (2790/5490/14900) + dokunulmamis EF kontor tarife/paket/hos geldin seed'i (admin override'ina dokunmaz; sira serbest)", files: [F.planPricesEfTariff] },
    { id: "PB57-tapu-sureci", order: 29.999862, title: "Tapu sureci adim takibi: deal_process_steps tablosu (kod tablo yokken bolumu etkin degil der; sira serbest)", files: [F.dealProcessSteps] },
    { id: "FIN-B-duzenli-odemeler", order: 29.9998685, title: "Finans: duzenli odemeler/gelirler (recurring_rules + donem basina tek uretim; kira-tahakkuk cron adimi; 000600'den SONRA; kod sema yokken sekmeyi gizler)", files: [F.recurringRules] },
    { id: "FIN-C-banka-ekstresi-mutabakat", order: 29.99986855, title: "Finans: banka ekstresi ice aktarma + mutabakat (finance_statement_* + cash_entries.reconciled_at; 000600'den SONRA; kod sema yokken Ekstre yukle gizlenir; sira serbest, ek)", files: [F.bankStatementImport] },
    { id: "PB60-e-fatura", order: 29.9998671, title: "e-Fatura entegrasyonu: baglanti (sifreli kimlik) + fatura tablolari (kod tablo yokken bolumu etkin degil der; sira serbest, ek)", files: [F.einvoice] },
    { id: "PB62-e-fatura-durum-makinesi", order: 29.9998674, title: "e-Fatura durum makinesi + atomik resmilestirme talebi (000700'den SONRA; yazma yalniz RPC; sira serbest)", files: [F.einvoiceStateMachine] },
    { id: "KONSEY3-e-fatura-kurtarma", order: 29.99986751, title: "e-Fatura belirsiz sonuc kurtarma: issue_stage + kurtarma RPC'leri (000600'den SONRA; sira serbest)", files: [F.einvoiceRecovery] },
    { id: "PB60-havuz-varsayilan-acik", order: 29.9998672, title: "Ilan havuzu yeni ofiste varsayilan acik + kaynak CHECK genislemesi (listing_pool 001500 sonrasi; sira serbest)", files: [F.poolDefaultOn] },
    { id: "PB61-realtime-cekirdek-tablolar", order: 29.99986745, title: "Realtime yayinina cekirdek tablolar (portfoy, talep, randevu, gorev, havuz, kasa; sira serbest, ek)", files: [F.realtimeCoreTables] },
    { id: "KONSEY-komisyon-taraf-kimligi", order: 29.99986746, title: "Komisyon paylasimi taraf kimligi: profile_id esleme + commission_splits esitleme (20260816000200 ve 000400 sonrasi; sira serbest)", files: [F.commissionSplitProfile] },
    { id: "KONSEY-kasa-maas-gizliligi", order: 29.99986747, title: "Kasa: maas hareketleri bakiyeden yetkisiz rol icin haric + kaynak bagli iptal audit (20261010000600 sonrasi; sira serbest)", files: [F.financeSalaryPrivacy] },
    { id: "KONSEY-ekstre-duzenli-komisyon", order: 29.99986748, title: "Ekstre uygulama: duzenli odeme tek gercek + komisyon tahsil edildi (001200 ve 000900 sonrasi; sira serbest)", files: [F.statementApplyRecurringCommission] },
    { id: "KONSEY-kazanc-ekstre-gizliligi", order: 29.99986749, title: "Kazanc gizliligi: komisyon/rapor toplulastirmasi earnings_all kapisi + ekstre satiri maas/hesap suzgeci (20260816000200, 20261011001000 ve 001200 sonrasi; sira serbest)", files: [F.earningsStatementPrivacy] },
    { id: "KONSEY3-finans-is-sample", order: 29.9999892, title: "Finans tablolarina is_sample (hesap, hareket, duzenli odeme, butce; 20261010000600/000900 ve 20261008000700 sonrasi; sira serbest, ek)", files: [F.financeIsSample] },
    { id: "KONSEY-fiyat-onerisi", order: 33, title: "Fiyat revizyonu onerisi + mulk sahibi onayi (20261007000800 fiyat kapisi SONRASI; sira serbest)", files: [F.propertyPriceProposals] },
    {
      id: "GUVENLIK-para-butunlugu",
      order: 40,
      title: "Guvenlik/para turu (ayni pencere, bu sirayla): fiyat onerisi ofis onay kapisi (000800 + 20261007000800 SONRASI) -> kira tahakkuku finansal sutun kapisi (20261008001100 SONRASI) -> kasa hareketi kaynak tutar tavani -> komisyon paylasimi butunlugu",
      files: [F.priceProposalOversightGate, F.rentChargesFinancialGuard, F.financeEntrySourceAmountGuard, F.commissionSplitsIntegrity],
    },
    { id: "ANALIZ-paket-adlari-tl", order: 32, title: "ef.packs seed paket adlari: kontor -> TL (analiz bakiyesi dili; 20261008001000 SONRASI, sira serbest, ek)", files: [F.efPackNamesTl] },
    { id: "HIZ-liste-sayim-rpc", order: 49, title: "Portfoy/gorev KPI sayimlari tek RPC (portfolio_counts, task_counts; kod RPC yokken eski head-count sorgularina duser; sira serbest, ek)", files: [F.portfolioCountsRpc] },
    { id: "HIZ-arama-trigram-gorev-belge", order: 49.1, title: "Gorev ve belge ilike aramasi icin pg_trgm GIN indeksleri (20261010000200 ile ayni desen; sira serbest, ek)", files: [F.searchTrgmTasksDocs] },
    { id: "HIZ-realtime-yayin-ek", order: 50, title: "Realtime yayinina teklif/kira tahakkuku/kira odemesi/anahtar tablolari (kod tablo yayinda degilken yalniz o kanal sessiz kalir; sira serbest, ek)", files: [F.realtimePublicationMore] },
    { id: "HIZ-detay-okuma-rpc", order: 49.2, title: "Anlasma teklif+randevu sayimi ve portfoy bolge istatistigi okuma RPC'leri (kod RPC yokken eski yola duser; sira serbest, ek)", files: [F.detailReadRpcs] },
    { id: "FSBO-sahibinden-ilanlar", order: 51, title: "Sahibinden ilanlar (portfoy avi): fsbo_* tablolari + tasks.fsbo_lead_id (RLS has_effective_permission('prospecting') kullanir; kod tablo yokken bos duruma duser; sira serbest, ek)", files: [F.fsboLeads] },
    { id: "FSBO-izin-varsayilanlari", order: 51.1, title: "prospecting permission_defaults seed'i (20261012002400 SONRASI; seed olmadan RLS izin vermez; sira serbest, ek)", files: [F.fsboPermissionDefaults] },
    { id: "FSBO-otomasyon-tetikleyici", order: 53, title: "automation_trigger enum: new_fsbo_lead + fsbo_no_contact_days (sira serbest, ek; kod enum yokken FSBO kurali kaydetmez)", files: [F.automationTriggerFsbo] },
    { id: "FSBO-rls-kapsami", order: 54, title: "fsbo_leads RLS kapsami + sutun yetkisi + kapatma RPC izin kapisi (20261012002400 ve 002500 SONRASI; sira serbest, siki)", files: [F.fsboRlsScope] },
    { id: "FSBO-realtime-kapatma", order: 52, title: "fsbo_leads realtime yayini + insight_close_fsbo_lead RPC (20261012002400 SONRASI; kod yayin/RPC yokken sessiz; sira serbest, ek)", files: [F.fsboRealtime] },
    { id: "FSBO-select-kapsami", order: 57, title: "fsbo_leads SELECT kapsami (danisman kendi+sahipsiz+olusturdugu) + fsbo_find_existing/fsbo_assign_lead/fsbo_archive_lead RPC'leri + assigned_to/deleted_at sutun yetkisi kaldirma (20261012002600 SONRASI; kodla birlikte yayinlanir; siki)", files: [F.fsboSelectScope] },
    { id: "FINANS-hakedis-kasa", order: 58, title: "Mulk sahibi hakedis odemesi kasada cikis (owner_payout kaynagi; 20261008001100, 20261010000600, 20261011001100 ve 20261012001400 SONRASI; kodla birlikte yayinlanir; siki)", files: [F.financeOwnerPayoutSource] },
    // order 59 bilerek bos: ACL onarimi migration degil (tek seferlik betik + npm run check:acl).
    { id: "DB1-rls-initplan-fsbo-staff", order: 60, title: "RLS InitPlan sarmasi: fsbo_*, platform personeli ve destek v2 politikalari (20261012002800 SONRASI; anlam ayni, davranis)", files: [F.rlsInitplanFsboStaff] },
    { id: "DB3-indeks-hijyeni", order: 61, title: "11 kopya indeks dususu + 12 tabloya tenant_id indeksi (CONCURRENTLY yok, kucuk veri; sira serbest, ek)", files: [F.tenantIndexesDedupe] },
    { id: "SP3-birinci-taraf-olcum", order: 67, title: "Birinci taraf olcum: sayac/hiz tablolari + ingest/prune RPC, kayit atfi sutunlari, huni RPC'si (003220, 003200 ve 003210 SONRASI; KOD YAYININDAN ONCE uygulanir; kod tablo/sutun yokken eski yola duser; ek)", files: [F.publicMeasurement, F.signupAttributionExt, F.growthFunnel] },
    { id: "SP4-hiz-laboratuvari", order: 68, title: "Hiz merkezi laboratuvar olcumleri perf_lab_runs (bagimsiz yeni tablo; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablo yokken 'migration bekliyor'; sira serbest, ek)", files: [F.perfLabRuns] },
    { id: "AP7-platform-mrr-gunluk", order: 63, title: "Platform MRR gunluk anlik goruntusu platform_mrr_daily (yalniz public.tenants'a bagli, o da temel tablo; KOD YAYININDAN ONCE uygulanir, kod tablo yokken 'veri yok'; sira serbest, ek)", files: [F.platformMrrDaily] },
    { id: "SP1-buyume-kokpiti", order: 65, title: "Buyume Kokpiti: site_issues + site_optimizer_actions + site_issues_prune (yalniz service_role; kod tablo yokken 'kurulum bekliyor'; sira serbest, ek)", files: [F.siteIssues] },
    { id: "SP2-platform-ai-kotasi", order: 66, title: "Platform AI kotasi platform_ai_quota + platform_ai_quota_take RPC (bagimsiz; kod tablo yokken SEO AI onerisi 'kota kurulmadi' der; sira serbest, ek)", files: [F.platformAiQuota] },
    { id: "DB8-hazirlik-yoklamalari", order: 62, title: "plan_upgrade_ready / subscription_pause_ready: information_schema yerine pg_catalog sayimi (sonuc ayni; sira serbest)", files: [F.readyProbesPgCatalog] },
    { id: "PORTAL-ogrenen-kurallar", order: 64, title: "Ogrenen eklenti 0.6.0: kural setleri + oneri/oy + gozlem tablolari, JWT/personel RPC'leri, ogrenme/saklama (20261012002700 SONRASI; 002000 -> 002010 -> 002020 sirayla; kod tablolar yokken sets:[] / schema_pending; ek)", files: [F.portalRulesCore, F.portalRulesRpcs, F.portalRulesLearn] },
    { id: "AD10-operasyon-uyari-merkezi", order: 80, title: "Operasyon ve uyari merkezi (uyari tablolari, cron_runs/duraklatma, host_metrics, hata triyaji, DB konsolu RPC) + push_subscriptions onarimi (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablolar yokken 'kurulum bekliyor'; 004900 -> 004910 sirayla, davranis)", files: [F.opsAlerts, F.pushSubscriptionsRepair] },
    { id: "EP4-eids-aksiyon-motoru", order: 94, title: "EIDS aksiyon motoru: gorev turleri/oncelik, dedupe_key, kaldirma kontrol listesi + kapanis kapisi + eklenti tetigi, e-posta hatirlatma kanali (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablo/sutun yokken gorev uretimi 'kurulum bekliyor'; sira serbest, siki)", files: [F.eidsActions] },
    { id: "AD11-guvenlik-yedek", order: 81, title: "AD11 guvenlik sertlestirmesi: denetim izi append-only + ip/ua/once/sonra, destek erisimi gecmisi (gerekce+bilet), backup_runs/restore_drills, personel oturum RPC'leri (bagimsiz; kod tablolar yokken eski yola duser; sira serbest, siki)", files: [F.ad11SecurityHardening] },
    { id: "AD9-destek-masasi-2", order: 79, title: "Destek masasi 2.0: SLA matrisi (oncelik x plan, is saati + tatil), kategori kurali + sirali dagitimla otomatik atama, bilet etiketleri, makro eylemleri/kullanim sayaci, yanit bekleyen bilet otomasyonu RPC'si (20260802000540 SONRASI; bagimsiz, sira serbest; davranis)", files: [F.supportDeskV2] },
    { id: "B7-platform-mrr-ay-sonu", order: 1970, title: "Platform MRR ay sonu okuyucusu platform_mrr_month_end (yalniz service_role, salt-okunur; AP7 platform_mrr_daily SONRASI; KOD YAYININDAN ONCE ya da SONRA: fonksiyon yokken MRR hareketleri/NRR/kohort kartlari 'kurulum bekliyor' der; ek)", files: [F.b7PlatformMrrMonthEnd] },
    { id: "B7-destek-talep-birlestirme", order: 1971, title: "Mukerrer destek talebi birlestirme: support_tickets.merged_into_id/merged_at + support_merge_tickets RPC (yalniz service_role; tek transaction, sabit kilit sirasi) (AD9 destek masasi 2 SONRASI; KOD YAYININDAN ONCE ya da SONRA: kolon/fonksiyon yokken 'Birlestir' paneli gizli; ek)", files: [F.b7SupportTicketMerge] },
    { id: "B7-destek-presence", order: 1972, title: "Destek talebi personel cakisma seridi: realtime.messages 'ticket-desk:<uuid>' presence politikalari (SK4 rt_staff_can_listen SONRASI; KOD YAYININDAN ONCE ya da SONRA: politika yokken serit sessizce gizli; ek)", files: [F.b7TicketDeskPresence] },
    { id: "B7-oneri-yenilik-bagi", order: 1973, title: "Oneri panosu dongu kapatma: product_feature_requests.changelog_entry_id (DG8 oneri panosu + AD8 yenilikler SONRASI; KOD YAYININDAN ONCE ya da SONRA: kolon yokken baglanti yazilmaz, durum yine kaydedilir; ek)", files: [F.b7FeatureRequestChangelog] },
    { id: "B7-talep-saptirma-olcumu", order: 1974, title: "Yeni talepte makaleyle cozulen olcumu: support_article_deflections (yalniz service_role) (AD12 yardim icerigi SONRASI; KOD YAYININDAN ONCE ya da SONRA: tablo yokken olcum yazilmaz; ek)", files: [F.b7SupportArticleDeflections] },
    { id: "SP6-site-medya", order: 70, title: "Site medya kutuphanesi: ozel site-media kovasi + site_media tablosu (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablo yokken 'kurulum bekliyor'; sira serbest, ek)", files: [F.siteMedia] },
    { id: "EP1-portal-uyelikleri", order: 91, title: "Portal uyelikleri tek kaynak: tenant_portal_accounts + portal_account_report_login + portal_name kucuk harf duzeltmesi (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablo yokken canli ilan/gider/talep onerisine duser; sira serbest, davranis; 007100 portal_name tetikleyicisi + CHECK 007000'dan SONRA)", files: [F.tenantPortalAccounts, F.portalListingsNameNormalize] },
    { id: "EP2-eids-yetki-defteri", order: 92, title: "EIDS yetki defteri: genisletilmis yetki durumu + 5 sutun, yalniz-eklenir eids_authority_events, eids_apply/undo_authority_event (tek yazma noktasi) ve aday on suzgeci (20261008001300 SONRASI; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod yokken eski yola duser; davranis)", files: [F.eidsAuthorityLedger] },
    { id: "ONARIM-push-abonelikleri", order: 90, title: "push_subscriptions ilk onarimi (canlida 004910 oncesi uygulandi): eksik tablo asil tanimla idempotent kurulur; 004910 politikayi sikilastirir (sira serbest, ek)", files: [F.pushSubscriptionsRepairFirst] },
    { id: "EP3-eids-eposta-alimi", order: 93, title: "Bakanlik (EIDS) e-posta alimi: eids_inbound_addresses + eids_inbound_messages (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablolar yokken 'kurulum bekliyor'; EP2 olay defteriyle FK yok, sira serbest, ek)", files: [F.eidsInbound] },
    { id: "AD7-eposta-gunlugu", order: 77, title: "E-posta altyapisi: email_sends + email_events + email_suppressions + email_log_prune (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablolar yokken gonderim surer, ekran 'kurulum bekliyor'; sira serbest, ek)", files: [F.emailLog] },
    { id: "AD2-fatura-satirlari-dekont", order: 72, title: "Fatura satirlari (geriye donuk tek satir) + numarali alacak dekontu (iade kaydi tetikleyicisi; mevcut iadeler dekontlanir) + elle fatura taslak RPC'si (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablolar yokken satiri faturadan turetir, elle fatura formu 'kurulum bekliyor' der; sira serbest)", files: [F.invoiceLinesCreditNotes] },
    { id: "FN1-finans-v2-defter", order: 101, title: "Finans v2 (Muhasebe mini muhasebe programi): sema + RPC + veri tasima AYNI PENCEREDE ve bu sirayla (001000 -> 001100 -> 001200; 20261010000600/000900, 20261011001200, 20261012000400, 20261012002900 ve 20261008001100 SONRASI). KOD YAYININDAN ONCE uygulanir; kod sema yokken 'veritabani guncellemesi bekliyor' der. Dogrulama: cash_entries sayisi ve finance_account_balances once/sonra ayni (davranis)", files: [F.financeLedgerV2, F.financeLedgerV2Rpc, F.financeLedgerV2Backfill] },
    { id: "DG2-plan-katalog", order: 112, title: "Plan katalog motoru: billing_plans + plan CHECK -> FK + eklenen paket fiyati + 4 fonksiyonda plan dogrulamasi billing_plan_known (20261007001000/001010 ve 20261008001000 SONRASI; bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod plan_catalog_engine_ready() yokken 'yeni paket' eklemez; davranis)", files: [F.planCatalogEngine] },
    { id: "DG5-kanal-roi-durum-sayfasi", order: 115, title: "Kanal ROI ve durum sayfasi: marketing_spend + status_incidents/status_incident_updates + release_history (bagimsiz yeni tablolar; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablolar yokken harcama yalniz Google Ads, /durum olay bolumu bos, deploy.sh satir yazmaz; sira serbest, ek)", files: [F.channelRoiStatusPage] },
    { id: "DG7-ofis-guvenlik", order: 117, title: "Ofis guvenlik politikalari: ofis sahibinin aktif oturum listesi ve tekil kapatma RPC'leri (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod RPC yokken oturum listesi 'kurulum bekliyor', politika ayarlari RPC'siz calisir; sira serbest, ek)", files: [F.officeSecuritySessions] },
    { id: "DG4-rapor-abonelik", order: 114, title: "Rapor merkezi kayitli gorunum + zamanlanmis rapor aboneligi + teslim gunlugu (bagimsiz yeni tablolar; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablolar yokken 'kurulum bekliyor', gunluk-ozet adimi 'skipped'; sira serbest, ek)", files: [F.reportSubscriptions] },
    { id: "DG1-personel-ozel-rol-dort-goz", order: 111, title: "Personel ozel rolleri + dort goz onay kuyrugu: platform_custom_roles, platform_approval_requests, platform_staff.custom_role_id (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod sutun yokken sabit role duser ve Roller/Onaylar ekrani kurulum bekliyor der; dort goz ayarlari varsayilan kapali; sira serbest, ek)", files: [F.platformCustomRolesFourEyes] },
    { id: "DG8-bayrak-hedefleme-nps-pano", order: 118, title: "Ozellik bayragi hedefleme (ofis/plan/yuzde/zaman) + urun ici NPS anketi + ozellik istek panosu (bagimsiz yeni tablolar; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablolar yokken bayraklar genel durumla calisir, NPS gosterilmez, pano 'kurulum bekliyor'; sira serbest, ek)", files: [F.flagRulesProductFeedback] },
    { id: "GP2-fatura-kdv-orani", order: 132, title: "Otomatik faturada gecerlilik tarihli KDV: fulfill_billing_payment tutari faturanin kendi oranindan (meta.vatRate; yoksa %20) dogrular, growth_cash_net ayni kural + billing_vat_rate_ready() probu (20261014002000 SONRASI; bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod probe yokken yalniz %20 ile otomatik fatura keser, KDV ayari %20'den farkli yapilmadan ONCE uygulanmali; davranis)", files: [F.billingVatRateInvoices] },
    { id: "CL-APP-kanonik-baglantilar", order: 119, title: "Ofis uygulamasi temizligi: kaldirilan /app yollarina giden kayitli baglantilar (bildirim, icgoru) ve portal giris bildirimi kanonik yola cevrilir (bagimsiz; KOD YAYINIYLA AYNI pencerede ya da hemen SONRA; once uygulanirsa yeni yollar kod gelene kadar acilmaz; davranis)", files: [F.clAppCanonicalLinks] },
    { id: "GP1-finans-danisman-kapsami", order: 131, title: "Finans: danisman carisi kapsami (P12) veritabaninda (RLS + finance_party_* / acik kalem / yaslandirma RPC) ve finance_aging vadesiz kovasi. 20261014001100 SONRASI; kod yayinindan ONCE ya da SONRA uygulanabilir (arayuz zaten ayni kurali uygular, vadesiz kovasini kod tanir; eski kod bilinmeyen kovayi yok sayar) (siki)", files: [F.financePartyAdvisorScope] },
    { id: "SN1-finans-hareket-kapsami-duzenli-kdv", order: 141, title: "Finans: hareket satirinda danisman carisi kapsami (cash_entries RLS; GP1 20261014011000 SONRASI) + duzenli odeme hareketine kuraldaki cari/KDV/stopaj (FN1 + FN6 + 20261011001400 SONRASI). KOD YAYININDAN ONCE ya da SONRA uygulanabilir (kod RLS'e ve hareket kolonlarina zaten hazir); stopajli ofis kuralinin yeni donemleri hesaptan net dusmeye baslar (siki)", files: [F.financeEntriesAdvisorScopeRecurringTerms] },
    { id: "SN1-personel-kapilari-matris", order: 142, title: "Personel SQL kapilari DG1 ozel rol matrisine: platform_staff_can + update_tenant_plan_subscription / convert_demo_request_to_tenant / destek / portal kurali / buyume kapilari + platform_mrr_daily politikasi (platform_settings bilerek sabit super_admin'de) (DG1 20261014001300 ve DG2 20261014002000 SONRASI; KOD YAYINIYLA AYNI pencerede ya da SONRA: sabit rollerde davranis ayni; davranis)", files: [F.platformStaffCanGates] },
    { id: "KQ5-sayim-rpcleri", order: 155, title: "Sunucu N+1 azaltma: advisor_counts (danisman basina musteri/yayindaki portfoy tek tur) + onboarding_snapshot (kurulum olgulari tek tur) SECURITY INVOKER fonksiyonlari (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod fonksiyon yokken eski sorgulara duser; sira serbest, ek)", files: [F.advisorCountsRpc, F.onboardingSnapshotRpc] },
    { id: "KQ2-rls-maliyeti-db-yuzeyi", order: 152, title: "RLS maliyeti ve DB yuzeyi: commissions_select / ilan kontrol / ekstre politikalari InitPlan (anlam ayni), kimlik fonksiyonlarina islem ici onbellek, get_metrics_snapshot tek gecis (cikti ayni), commission_splits indeksi + 2 yinelenen indeks, agent-photos sinirlari, 3 RPC'de anon EXECUTE geri alma, Realtime yayin listesi (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod hicbir yeni nesneye dayanmaz, anon'dan geri alinan RPC'leri yalniz oturumlu cagirir; sira dosya numarasiyla; ONCE restore edilebilir yedek dogrulanir)", files: [F.kq2CommissionsRls, F.kq2LcFinanceRls, F.kq2IdentityCache, F.kq2MetricsSinglePass, F.kq2IndexHygiene, F.kq2AgentPhotosLimits, F.kq2RevokeAnonRpcs, F.kq2RealtimeTrim] },
    { id: "SK2-canli-veri-broadcast", order: 202, title: "Ofis ekranlarinda canli veri: deyim duzeyinde Broadcast tetikleyicileri (tenant:<ofis> konusu {t,op,ids<=50,r,by} | {t,op,bulk}; kisisel bildirim inbox:<kullanici>) + realtime.messages okuma politikalari + supabase_realtime yayin kirpma (KOD YAYINIYLA BIRLIKTE: once migration (020000 tetikleyiciler; 020100 politikasiz ertelenir) -> supabase_admin scripts/sunucu/realtime-policies.sql (DEPLOY'DAN ONCE; eski istemciyi etkilemez) -> deploy -> canli dogrulama rt-e2e S1-S4 -> supabase_admin realtime-policies.sql -v trim=1; politika yokken istemci eski postgres_changes yoluna duser; davranis)", files: [F.sk2TenantBroadcast, F.sk2RealtimeTrim] },
    { id: "SN5-kurulum-ilerlemesi", order: 145, title: "Ofis bazinda kurulum ilerlemesi: platform_tenant_onboarding_facts salt-okunur fonksiyonu (admin toplu liste, Ofis 360, saglik skoru girdisi; bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod fonksiyon yokken ilerleme 'kurulum bekliyor' der ve saglik skoru eski bilesenlerle hesaplanir; sira serbest, ek)", files: [F.tenantOnboardingFacts] },
    { id: "GP4-randevu-bildirim-baglantisi", order: 120, title: "Herkese acik randevu bildirimleri (online randevu, teyit/iptal yaniti) tek randevuyu acar: /app/randevular?randevu=<id> (bagimsiz; govdeler ayni, yalniz bildirim href'i; KOD YAYINIYLA AYNI pencerede ya da SONRA, once uygulanirsa eski kod parametreyi yok sayar ve genel listeyi acar; davranis)", files: [F.appointmentNotificationDeepLinks] },
    { id: "YD3-randevu-musteri-iletisi", order: 163, title: "Randevu musteri iletisi izi: appointments.customer_confirm_sent_at + customer_reminded_at (2 nullable sutun; bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod sutunlar yokken musteri hatirlatma SMS adimini atlar ve teyit SMS izini yazmaz; sira serbest, ek)", files: [F.appointmentCustomerMessages] },
    { id: "YD5-arayuz-durumu", order: 165, title: "Urun turu ve davet karti kapatma durumu sunucuda: profiles.ui_state + profile_ui_state_mark (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod sutun/fonksiyon yokken yalniz tarayici onbellegiyle calisir; sira serbest, ek)", files: [F.profilesUiState] },
    { id: "YD4-saha-kullanimi", order: 164, title: "Saha kullanimi: fotograf boyutlari (property_media.width/height) + cevrimdisi hizli kayit kuyrugu icin istek kimligi tablosu client_submissions (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablo/sutun yokken cift kayit frenini atlar ve boyutu kaydetmez; sira serbest, ek)", files: [F.yd4FieldCapture] },
    { id: "SK1-oturum-hiz-yigin", order: 201, title: "HIZ-1 oturum ve yigin: finance_fx inline (yalniz plan), PostgREST yeniden yukleme kapsami (sahip degilse no-op; supabase_admin adimi scripts/sunucu/pgrst-watch-scope.sh, gece), proxy kapi anlik goruntusune oturum canliligi + personel yetki oznesi, admin bildirim zili tek tur fonksiyonu (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod alanlar/fonksiyon yokken oturum canliligini 'bilinmiyor' sayar, admin modul kapisini sayfaya birakir, zil iki sorguya duser; sira dosya numarasiyla; davranis)", files: [F.sk1FinanceFxInline, F.sk1PgrstWatchScope, F.sk1ProxyGateSessionAlive, F.sk1PlatformNotificationFeed] },
    { id: "SK5-bildirim-okunma-ornek-komisyon", order: 205, title: "Bildirim okunma durumu kisi basina tek tabloda (notification_reads; ortak bildirim herkese ayri, salt okunur dahil yazilir) + tek kaynak sayac RPC'si + 'reads:<uid>' okundu yayini; notifications UPDATE yetkisi istemciden kalkar. Komisyonun is_sample bayragi anlasmadan turer (ornek anlasmanin komisyonu ciroya/KDV'ye girmez). Bagimsiz; KOD YAYININDAN ONCE uygulanmasi onerilir (kod tablo/RPC yokken eski sorguya duser; migration once gelirse eski kodun okundu yazimi kisa sure 42501 alir ve yutulur); sira dosya numarasiyla", files: [F.sk5NotificationReads, F.sk5CommissionsInheritSample] },
    { id: "B1-ekip-devri-atomik", order: 171, title: "Ekip is yuku devri tek transaction: team_handoff_workload SECURITY DEFINER (musteri/portfoy + havuz atamasi/acik anlasma/acik gorev/yaklasan randevu/acik sahibinden adayi; team:edit + kapsam modulu edit; audit ayni transaction'da; bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod fonksiyon yokken eski tablo tablo devre duser; sira serbest, ek)", files: [F.b1TeamHandoffWorkload] },
    { id: "P5-sube-rollup", order: 169, title: "Sube karsilastirma rollup'i tek GROUP BY: branch_rollup SECURITY INVOKER fonksiyonu (sube basina portfoy/musteri + donemdeki islem toplam/kazanilan/hacim; bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod fonksiyon yokken eski sayfali taramaya duser; sira serbest, ek)", files: [F.p5BranchRollupRpc] },
    { id: "YD7-veritabani-isletim", order: 167, title: "Veritabani isletim sertlestirmesi: rol duzeyi statement_timeout / idle_in_transaction (service_role daha uzun) + yavas sorgu gunlugu (superuser ise), geo sayimlari materialized view + refresh_geo_stats (cron operational-retention geoStats adimi), toplu sayim RPC'leri (teklif/talep/hedef sayaclari, KVKK iliskili kayit, EF bakiye listesi) (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod RPC/gorunum yokken eski sorgulara duser; sira dosya numarasiyla; log_min_duration_statement icin supabase_admin adimi; davranis)", files: [F.yd7RoleTimeouts, F.yd7GeoStatsMv, F.yd7BatchCountRpcs] },
    { id: "SK4-admin-canli-veri", order: 204, title: "Admin canli veri ve destek: personel ozel Broadcast konulari (admin:staff, staff:<uid>; 5 tablo + platform_notifications tetikleyicisi, realtime.messages personel politikasi) + reply_support_ticket_v3 (ofis yaniti acik talebi acik birakir; v2 devreder; tek seferlik in_progress -> open duzeltmesi) + admin_search_members (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod kanal katilamazsa 60 sn yoklamaya, kod reply_support_ticket_v2 cagirir, migration sonrasi v2 v3'e devreder, arama fonksiyonu yoksa ad aramasina duser; sira dosya numarasiyla; davranis)", files: [F.sk4AdminStaffBroadcast, F.sk4ReplySupportTicketV3, F.sk4AdminSearchMembers] },
    { id: "SK7-musteri-arama-cekirdegi", order: 207, title: "Musteri arama cekirdegi: customers.search_fold (fold_tr ad + e-posta) ve phone_digits uretilmis sutunlari, pg_trgm GIN + (tenant_id, phone_digits) indeksleri, kapsam disi tam telefon eslesmesi icin maskeli lookup_customer_by_phone RPC (bagimsiz; KOD YAYININDAN ONCE uygulanir: arama kodu sutunlari okur, RPC yokken kapsam disi ipucu atlanir; tablo yeniden yazimi kucuk; sira serbest, ek)", files: [F.sk7CustomerSearchFold] },
    { id: "SK10-yetki-veri-erisimi", order: 210, title: "SK10 yetki ve veri erisimi: kapsam RLS (bayrak kapaliyken davranis ayni) + modul yazma politikalari (26 tablo, cron tablolarinda yazma REVOKE) + rol matrisi gm/owner satir korumasi, readonly support:view, profile_ui_state_mark SECURITY DEFINER + havuz sube siniri (KOD ILE AYNI YAYINDA: sozlesme sablonu kaydi settings:edit ister, eylemler ayni kapilari uygular; sira dosya numarasiyla; npm run db:rls-audit YAZMA-IZIN-YOK 0 olmali)", files: [F.sk10ScopeRls, F.sk10ModuleWritePolicies, F.sk10TrpGmGuardReadonlySupport, F.sk10PoolBranchGuard] },
    { id: "KQ6-bildirim-temizligi", order: 156, title: "Bildirim gurultusu temizligi: anahtarsiz 'Portal teyit gecikti' kopyalari ilan basina en yeniye, gelecek tarihli kopyalar en yeniye, kalan gelecek created_at now() (bagimsiz yalniz veri; KOD YAYININDAN ONCE ya da SONRA uygulanabilir; geri alinamaz, PITR; davranis)", files: [F.notificationsDedupeCleanup] },
    { id: "SK6-finans-rapor-platform-mrr", order: 206, title: "SK6 finans/rapor/platform MRR dogrulugu: rapor RPC'leri yerel ay ekseni + ofis geneli/izleyen ayrimi, kar-zarar ve KDV duzeltmesi, kiralama gecikmis dilimi, komisyon pay orani turetme, tenants.is_internal (e2e-test/admin/demo-ofis) ve platform toplulastirmasi (ic ofis haric, Istanbul siniri, ay sonu anlik goruntu egrisi). Sira dosya numarasiyla (060500, 060400'den SONRA). 060000 KOD YAYINIYLA AYNI PENCERE (once migration, sonra kod; arada eski kod Raporlar'da serileri bos gosterebilir); digerleri KOD YAYININDAN ONCE ya da SONRA uygulanabilir (kod yeni anahtar/sutun yokken eski davranisa duser). ONCE restore edilebilir yedek dogrulanir (davranis)", files: [F.sk6ReportingLocalAxis, F.sk6FinancePnlVatFix, F.sk6RentalKpiOverdue, F.sk6CommissionSplitsDeriveRate, F.sk6TenantIsInternal, F.sk6PlatformReportingLocalAxis] },
    { id: "YD1-demo-gece-sifirlama", order: 161, title: "Demo kiracinin gece sifirlamasi: demo_reset_state tabani + demo_tenant_nightly_reset (yalniz slug=demo-ofis; dis baglanti yuzeyleri ve tabandan sonra eklenen is kayitlari silinir). Bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir (kod fonksiyon yokken adimi atlar); ek", files: [F.demoTenantNightlyReset] },
    { id: "SK9-portfoy-veri-dogrulugu", order: 209, title: "Portfoy ve ilan verisi dogrulugu: properties.currency (features.currency'den backfill; doviz kayitlarinin turetilmis fiyat sagligi bosaltilir) ve ARDINDAN yayin kapisi DB kopyasi (transition_property_status_atomic: 'live' icin il/ilce + tamamlanmis ilan sahibi kaydi), aktif satilik stok / aylik kira toplami (portfolio_counts), portalda varlik tanimi (property_portal_presence) (iki dosya BIRLIKTE ve sirayla; KOD YAYININDAN ONCE uygulanir: SK9 kodu properties.currency okur/yazar; RPC yeni alanlari yokken kart '—' der; ONCE restore edilebilir yedek dogrulanir; davranis/siki)", files: [F.sk9PropertyCurrency, F.sk9PublishGateCounts] },
    { id: "P2-kampanya-hedef-kitle", order: 170, title: "Kampanya hedef kitlesi: etiket / acik talep ilcesi / danisman filtreleri (create_campaign_with_recipients govdesi + filtre dallari; bagimsiz; KOD YAYININDAN ONCE uygulanmali: kod migration yokken yeni filtrelerde kampanya olusturma 22023 ile reddedilir, all|type:* etkilenmez; davranis)", files: [F.p2CampaignAudienceFilters] },
    { id: "YD8-csp-olcum-statik-yasal", order: 168, title: "Herkese acik sayfa hafifligi: CSP rapor modu satirlari (error_logs source 'csp') hata patlamasi sayacina girmez (record_error_occurrence govdesi ayni + tek kosul) ve yasal sayfalar statik sunuma acilir (statik.routes yoksa yazilir; varsa dokunulmaz) (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: CSP satirlari migration yokken yalniz sayaca da girer, statik yasal sayfa kodu zaten yayinda; sira dosya numarasiyla; davranis)", files: [F.yd8ErrorLogsCspSource, F.yd8StaticLegalPagesOn] },
    { id: "SK8-herkese-acik-yuzeyler", order: 208, title: "Herkese acik musteri yuzeyleri: offers.owner_visible_note (malik portalinda tek teklif metni; ic not offers.notes artik public degil) + atomik increment_share_view (yeni degeri dondurur; ilk acilis bildirimi yalniz 1 iken) (bagimsiz; KOD YAYININDAN ONCE uygulanir: kod sutun/RPC yokken malik aciklamasi bos, paylasim sayaci atlanir; sira serbest, ek)", files: [F.sk8PublicSurfaces] },
    { id: "P4-belge-gecerlilik", order: 1004, title: "Belge gecerlilik tarihi: customer_files.valid_until (opsiyonel) + kismi indeks (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod sutun yokken listeyi tarihsiz gosterir, gecerlilik filtresi bos doner, document_expiry@1 etkin degil sayilir; sira serbest, ek)", files: [F.p4CustomerFilesValidUntil] },
    { id: "FNE-WP1-kayit-cekirdegi", order: 1701, title: "Finans entegrasyonu WP1 kayit cekirdegi: posting_key/event_type/reversal_of + finance_post/finance_reverse + denetim tetikleyicileri, ARDINDAN acik kalem gorunumu v3 (komisyon alacagi brut+KDV-tahsilat, bina/aidat/hakedis kollari, cari cozumu). Iki dosya BIRLIKTE ve sirayla; FN1 (20261014001000/001100/001200), GP1 (20261014011000) ve SK6 (20261016060100) SONRASI. KOD YAYININDAN ONCE ya da SONRA uygulanabilir (henuz cagiran yok; v3 yeni kaynak turlerini kod taniyor, eski kod bilinmeyen kaynagi yok sayar). ONCE restore edilebilir yedek dogrulanir (davranis)", files: [F.wp1FinancePostingCore, F.wp1FinanceOpenItemsV3] },
    { id: "B4-vitrin-seo-metni", order: 1204, title: "Ofis vitrini elle SEO basligi/aciklamasi: tenants.vitrin_seo_title (<=70) + vitrin_seo_description (<=160) (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod sutunlar yokken vitrin metadata'si SEO kalibina duser, ayar ekrani alanlari 'etkin degil' der; sira serbest, ek)", files: [F.b4TenantVitrinSeoMeta] },
    { id: "M3-demo-okunma-sifirlama", order: 1531, title: "Demo gece sifirlamasi bildirim okunma izlerini de siler: demo_tenant_nightly_reset yeniden tanimlanir (YD1 20261015041000 sonrasi; notification_reads yoksa adim atlanir; KOD YAYININDAN ONCE ya da SONRA uygulanabilir; ek)", files: [F.m3DemoResetNotificationReads] },
    { id: "FNE-WP2-tahakkuk-cari-kz", order: 1702, title: "Finans entegrasyonu WP2: tahakkuk tetikleyicileri (komisyon, ofis disi pay, paysiz onayli hakedis, bina aidati -> posting_key'li acik kalem; kasa disi taban), ARDINDAN cari + kalem geri doldurmasi (idempotent, nakit uydurulmaz), ARDINDAN K/Z v3 (tahakkuk|nakit esasi, danisman pay gider satiri, KDV fatura ayinda). Uc dosya BIRLIKTE ve sirayla; WP1 (20261017010000 + 010100) SONRASI; 'payout.approved' kurali 010200 icinde eklenir. KOD ILE AYNI YAYINDA: kod finance_pnl'deki danisman_hakedis satirini ek giderden dusurur (eski kod pay giderini iki kez dusurur). ONCE restore edilebilir yedek dogrulanir (davranis)", files: [F.wp2FinanceAccrualTriggers, F.wp2FinancePartiesBackfill, F.wp2FinancePnlV3] },
    { id: "A1-kayit-birlestirme-v2", order: 1810, title: "Kayit birlestirme v2: merge_customers tum FK'leri tasir + alan secimi (p_overrides) + farkli telefon/e-posta/not korunur, ARDINDAN portfoy birlestirme merge_properties. Iki dosya BIRLIKTE ve sirayla (010001, 010000'daki merge_fk_refs'e dayanir). KOD YAYININDAN ONCE uygulanir: yeni kod merge_preview_counts / merge_properties / p_overrides cagirir; eski kod 4 argumanli cagriyla calismaya devam eder (davranis)", files: [F.a1MergeCustomersV2, F.a1MergeProperties] },
    { id: "CRM-G4-eslesme-durumu", order: 1822, title: "Talep x portfoy eslesme durumu: demand_property_matches (gonderildi/uygun degil/onerildi; bagimsiz yeni tablo; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablo yokken durum rozetsiz eski davranisla calisir; sira serbest, ek)", files: [F.crmG4DemandPropertyMatches] },
    { id: "A3-musteri-iletisim-tercihi", order: 1833, title: "Musteri iletisim tercihi: customers.preferred_channel / contact_window / preferred_language + CHECK (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod sutunlar yokken tercih karti 'kurulum bekliyor' der, sonraki en iyi eylem tercihsiz calisir; sira serbest, ek)", files: [F.a3CustomerContactPrefs] },
    { id: "GA14-randevu-gelmedi", order: 1844, title: "Randevu sonucu 'gelmedi' (no-show): appointments_outcome_check genisler (bagimsiz; KOD YAYININDAN ONCE uygulanir: yeni kod 'gelmedi' yazar, eski kisitta CHECK hatasi alir; ek)", files: [F.ga14AppointmentOutcomeNoshow] },
    { id: "GA08-bildirim-konusu", order: 1850, title: "Bildirim konusu: notifications.topic (randevu/gorev/atama/musteri/portfoy/finans/sistem) + baglantidan tureten BEFORE INSERT tetikleyicisi + gecmis satir geri doldurma + my_notification_counts 'topics' kirilimi. SK5 (20261016050000) SONRASI; KOD YAYININDAN ONCE ya da SONRA uygulanabilir (kod kolon yokken konusuz yazar ve tur ciplerine duser); ek", files: [F.ga08NotificationsTopic] },
    { id: "A8-satis-hizi-hedef-huni", order: 1808, title: "Raporlama ve hedefler A8: anlasma asama gecmisi (deal_stage_events + stage_changed_at/expected_close_date/closed_at, audit_logs geri doldurmasi, transition_deal_stage_atomic yeni surum) + satis hizi RPC'si, ARDINDAN takim/sube/cagri hedefi (target_demands duser), ARDINDAN donem/kapsam raporu + satis hunisi. Uc dosya BIRLIKTE ve sirayla; KOD YAYININDAN ONCE uygulanir (yeni kod yeni kolonlari ve RPC'leri okur). ONCE restore edilebilir yedek dogrulanir (davranis)", files: [F.a8DealStageHistory, F.a8TargetsScopeCalls, F.a8ReportPeriodFunnel] },
    { id: "WP5-efatura-defter", order: 1706, title: "Finans entegrasyonu WP5: e-Fatura deftere baglanir (einvoices.party_id/open_item_id; resmilesen fatura kaynak alacagina baglanir, serbest faturada invoice.issued alacagi acilir, iptal/hata ters kayit; gecmis faturalara yalniz cari + bag). WP1 (20261017010000) ve e-Fatura (20261012001000) SONRASI; KOD YAYININDAN ONCE ya da SONRA uygulanabilir (kod kolonlar yokken eski fatura listesi; tetik kodu beklemez). ONCE restore edilebilir yedek dogrulanir (davranis)", files: [F.wp5EinvoiceLedgerLink] },
    { id: "A6-kampanya-raporu", order: 1866, title: "Kampanya raporu: campaign_report (durum sayilari, hata gruplari, 7 gun icinde yanit/randevu/ret atfi) + campaign_recipient_page (sunucu sayfalama). Bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir (kod fonksiyon yokken eski 500 satirlik listeye duser; sira serbest, ek)", files: [F.a6CampaignReportRpc] },
    { id: "A6-gelen-kutusu-konusmalar", order: 1867, title: "Gelen kutusu v2: communications/calls.resolved_at + resolved_by ve inbox_conversations (kisi bazli konusma, yanit bekliyor). Bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir (kod fonksiyon yokken Konusmalar sekmesi 'etkin degil' der; sira serbest, ek)", files: [F.a6InboxConversationState] },
    { id: "A6-gelen-kutusu-arama-indeksi", order: 1868, title: "Gelen kutusu aramasi icin GIN trigram indeksleri (mesaj icerigi + numara). Bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir (indeks yokken arama yalniz yavaslar; sira serbest, ek)", files: [F.a6CommunicationsBodyTrgm] },
    { id: "A7-otomasyon-iletisim-tetikleyici", order: 1870, title: "automation_trigger enum: inbound_message + lead_form_submitted (sira serbest, ek; kod enum yokken bu tetikleyicilerle kural kaydedilemez, mevcut kurallar etkilenmez)", files: [F.a7AutomationTriggerInbound] },
    { id: "A7-takip-dizileri", order: 1871, title: "Takip dizileri (drip): message_sequences + adimlar + kayitlar + idempotent adim sonucu (sira serbest, ek; kod tablolar yokken diziler sekmesi kurulum bekliyor gosterir, cron bos doner)", files: [F.a7MessageSequences] },
    { id: "A7-whatsapp-gelen-medya", order: 1872, title: "WhatsApp gelen medya ozel kovasi inbound-media (sira serbest, ek; kod kova yokken medyayi saklamaz, metin ozeti yazar)", files: [F.a7InboundMediaBucket] },
    { id: "A7-anket-google-yorum-izi", order: 1873, title: "surveys.review_clicked_at (sira serbest, ek; kod sutun yokken tiklama izini atlar)", files: [F.a7SurveyReviewClick] },
    { id: "A9-giris-kisitlayici", order: 1891, title: "Giris sertlestirme: hesap + IP basarisizlik kovalari ve ilerleyen bekleme (auth_login_throttle + peek/fail/clear, yalniz service_role; bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod RPC yokken check_rate_limit sabit penceresine duser; ek)", files: [F.a9AuthLoginThrottle] },
    { id: "A9-ofis-totp-2fa", order: 1892, title: "Ofis kullanicilari icin authenticator (TOTP) 2FA: profiles.two_factor_method (varsayilan sms) + yontem degisiminde two_factor_version artar + two_factor_recovery_codes (HMAC ozet, tek kullanim) + 2FA oturum kapisi TOTP yonteminde AAL2'yi de kabul eder (20261007001100 SONRASI; KOD YAYININDAN ONCE uygulanir: yeni kod two_factor_method okur; davranis)", files: [F.a9OfficeTotp] },
    { id: "B1-vitrin-sunucu-suzgeci", order: 1910, title: "Vitrin listesi sunucu suzgeci + gercek sayfalama: vitrin_listing_search / vitrin_listing_facets / vitrin_json_number (salt okur, yalniz service_role; bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod RPC yokken eski PostgREST sorgusuna duser; ek)", files: [F.b1VitrinListingSearch] },
    { id: "B1-ilan-cevresi", order: 1911, title: "Ilan cevresi: properties.nearby_places jsonb (danisman girer, vitrin detayinda 'Cevrede neler var'; bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: sutun yokken portfoy karti 'kurulum bekliyor' der, vitrin bolumu gizlenir; ek)", files: [F.b1PropertyNearbyPlaces] },
    { id: "B4-teklif-kosullari-malik-karsi-teklif", order: 1940, title: "SP2 teklif kosullari (odeme sekli, kapora, tapu tarihi, kredi sarti, takas) + malik portalindan karsi teklif RPC'si (outbox bildirimli, aliciya otomatik gitmez) (20260810000990 SONRASI; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod sutun/RPC yokken kosullari yazmaz ve formu 'etkin degil' gosterir; ek)", files: [F.b4OfferTerms] },
    { id: "B4-sozlesme-anlasma-bagi", order: 1941, title: "SP3 contracts.deal_id/offer_id kesin bag + tek adayli eski sozlesmelerin geri doldurmasi (20260809000020 tenant sinir indeksleri SONRASI; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod sutun yokken bagsiz yazar; davranis)", files: [F.b4ContractsDealLink] },
    { id: "B4-imza-kaniti", order: 1942, title: "SP8 imza tamamlama sertifikasi: icerik SHA-256, dogrulama kodu, imzaci basina kanit + metin kilidi tetigi (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod sutun yokken kanit yazmaz; davranis)", files: [F.b4ContractEvidence] },
    { id: "B4-kira-stopaj-surec", order: 1943, title: "SP9 isyeri kirasi stopaji (rentals.usage/withholding_rate, rent_charges.withholding_amount + NET tahakkuk tetigi) ve SP4 kiralik surec adimlari (rentals.handover_steps) (20261008001100 SONRASI; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: varsayilan oran 0 iken davranis degismez; ONCE restore edilebilir yedek dogrulanir; davranis)", files: [F.b4RentalWithholding] },
    { id: "B4-defter-otomatik-kaynak", order: 1944, title: "SP7 yasal kayit defteri otomatik kaynak etiketi + anlasma/taraf tekillik indeksi (20260821000200 SONRASI; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod sutun yokken eylem 'etkin degil' der; ek)", files: [F.b4LedgerAutoSource] },
    { id: "B5-proje-fiyat-listesi", order: 1950, title: "Proje fiyat listesi: daire fiyat gecmisi (tetik) + toplu zam/indirim ve 10 dk geri al + Excel/CSV fiyat listesi aktarimi RPC'leri (projects/unit_payments SONRASI; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod RPC yokken bu dugmeler 'etkin degil' der; ek)", files: [F.b5ProjectUnitPricing] },
    { id: "B5-proje-paylasim-sayfasi", order: 1951, title: "Proje paylasim sayfasi + galeri: projects paylasim sutunlari (varsayilan kapali), project_media, ozel project-media kovasi (KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod sutun yokken paylasim/galeri kartlari 'etkin degil' der, /proje/[token] 404; ek)", files: [F.b5ProjectPublicPage] },
    { id: "A9-kvkk-veri-dokumu", order: 1893, title: "KVKK veri sahibi dokumu: kvkk_subject_exports (talebe bagli degismez JSON + SHA-256; yazma yalniz service_role, okuma ofis + compliance:view, 90 gun saklama) (k5 kvkk_requests SONRASI; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: tablo yokken dugme 'etkin degil' der; ek)", files: [F.a9KvkkSubjectExports] },
    { id: "B3-medya-oda-etiketi-kat-plani", order: 1930, title: "Portfoy medyasi oda etiketi + aciklama + kat plani: property_media.room_tag (sabit liste, kat_plani) + caption (1-80) (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod sutunlar yokken etiket/aciklama alanlarini gizler, galeri eskisi gibi; ek)", files: [F.b3PropertyMediaRoomTag] },
    { id: "B6-oyun-kitabi-durtme", order: 1960, title: "Musteri basarisi: platform_tasks kaynak kural + tekrar anahtari + oncelik, aktivasyon durtme defteri tenant_lifecycle_nudges (AD5 20261013004400 SONRASI; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod sutun/tablo yokken oyun kitabi ve durtme adimlari 'kurulum bekliyor' der, gonderim yapmaz; ek)", files: [F.b6CsPlaybooksNudges] },
    { id: "B6-limit-deger-rpc", order: 1961, title: "Genisleme sinyali platform_tenant_limit_usage + deger ozeti platform_tenant_value_counts (yalniz service_role) + platform_insights.kind revenue_opportunity (20261013004000 istisna cozucusu SONRASI; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: RPC yokken suzgec 'kurulum bekliyor', ozet e-postasi gitmez; ek)", files: [F.b6TenantUsageRpcs] },
    { id: "B8-ofis-tv-eslestirme", order: 1980, title: "Ofis TV eslestirme: tv_devices + tv_pairing_codes + tv_device_pair/revoke (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: tablolar yokken /tv eslestirme ekrani 'etkin degil' der, oturumlu Pano TV aynen; ek)", files: [F.b8TvDevices] },
    { id: "B8-nobet-cizelgesi", order: 1981, title: "Ofis nobet cizelgesi duty_shifts (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: tablo yokken Nobet sekmesi kurulum bekliyor der, talep dagitimi nobet adimini atlar; ek)", files: [F.b8DutyShifts] },
    { id: "B8-birebir-kocluk", order: 1982, title: "Birebir kocluk gorusmesi coaching_sessions + coaching_commitments (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: tablolar yokken Birebir sekmesi kurulum bekliyor der; ek)", files: [F.b8CoachingSessions] },
    { id: "B8-onay-vekili", order: 1983, title: "Onay politikasi vekil onaylayici: approval_delegations + approval_actor_can_decide vekili tanir (20260823000100 SONRASI; KOD YAYININDAN ONCE uygulanir: yeni kod vekile karar dugmesi gosterir; davranis)", files: [F.b8ApprovalDelegate] },
    { id: "C2-kiraci-basvurusu", order: 2020, title: "Kiraci basvurusu: portfoy basvuru baglantisi + aday/kefil + evrak + malik onayi + rentals.guarantor_* (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: tablolar yokken basvuru ekrani 'kurulum bekliyor', public form 404; ek)", files: [F.c2RentalApplications] },
    { id: "C2-teslim-tahliye-tutanagi", order: 2021, title: "Teslim/tahliye tutanagi + kalemli depozito kesintisi; rental_deposit_post iadeyi net yazar (WP4 20261017010500 SONRASI; KOD YAYININDAN ONCE uygulanir: yeni kod kesinti girer, RPC net tutari yazmali; davranis)", files: [F.c2RentalInspections] },
    { id: "C3-bina-isletme-projesi-duyuru", order: 2033, title: "Bina isletme projesi (yillik butce, aylik avans tahakkuku create_building_batch ile, idempotent) + bina duyurulari (20261008001700 SONRASI; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: tablolar yokken bolumler kurulum bekliyor der; ek)", files: [F.c3BuildingBudgetAnnouncements] },
    { id: "B9-icgoru-riskli-anlasma-asama", order: 1990, title: "Icgoru riskli anlasma: insight_stalled_deals asamada gecen gun (stage_changed_at) + beklenen kapanisi gecmis acik anlasma (A8 20261018080000 SONRASI; KOD YAYININDAN ONCE ya da SONRA uygulanabilir: kod yeni kolonlar yokken eski olcuyle calisir; davranis)", files: [F.b9InsightStalledDealsStage] },
    { id: "C0-finans-rota-tasima", order: 2000, title: "Finans BM (WP6): href ureten SQL nesneleri yeni yollarla (/app/finans/**, /app/kazancim) + saklanmis bildirim/icgoru/saved_views baglantilari + finance_saved_views.tab duzenli->tekrarlayan (20261017010100, 20261014011000, 20261010000900, 20261007001010, 20261018050000 SONRASI; KOD YAYINIYLA AYNI pencerede: eski yollar silindi; davranis)", files: [F.c0FinanceHrefs] },
    { id: "C1-crm-derinligi", order: 2010, title: "CRM derinligi: ek telefon/e-posta (customer_contacts + customers.contacts_fold + lookup_customer_by_phone) -> iliskili kisiler (customer_relations) -> not sabitleme/anma + eski serbest notun kopyasi -> isi RPC'sine dijital ilgi -> merge_customers v3. Bes dosya BIRLIKTE ve sirayla (010000 -> 010004). KOD YAYININDAN ONCE uygulanir: yeni musteri aramasi contacts_fold sutununu okur (davranis)", files: [F.c1CustomerContacts, F.c1CustomerRelations, F.c1CommPinMention, F.c1HeatEngagement, F.c1MergeContacts] },
    { id: "WP4-kira-aidat-dues", order: 1305, title: "Finans entegrasyonu WP4: tekil mulk aidati acik kaleme tasinir (property_dues gecmis/salt okunur, due:{id}), aidat iptali (silme yok), depozito emaneti, kiraci/malik carisi (20261016060100 ve 20261014011000 SONRASI; WP1 20261017010000 varsa posting_key damgalanir, yoksa atlanir; KOD YAYININDAN ONCE uygulanir: yeni kod finance_due_* RPC'lerini cagirir, eski kod property_dues'a yazamaz; ONCE restore edilebilir yedek dogrulanir; davranis)", files: [F.wp4PropertyDuesOpenItems] },
    { id: "SN3-sms-whatsapp-gunlugu", order: 144, title: "SMS ve WhatsApp teslim gunlugu: message_sends + message_log_prune (bagimsiz yeni tablo; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablo yokken gonderim surer ve gunluk atlanir, ekran 'kurulum bekliyor'; sira serbest, ek)", files: [F.messageLog] },
    { id: "FN6-duzenli-odeme-kosullari", order: 106, title: "Muhasebe v2 FN6: duzenli odeme kuralina cari/KDV/stopaj yazan recurring_rule_set_terms RPC (FN1 20261014001000_finance_ledger_v2 ILE AYNI pencerede, FN1 SONRASI cagrilir; plpgsql govde sutunlari calisma aninda cozer; kod RPC yokken kosullar atlanir, kural kaydedilir; ek)", files: [F.financeRecurringRuleTerms] },
    { id: "SN2-uyari-motoru-nabzi", order: 143, title: "Uyari motoru nabiz kurali: alert_rules engine_stalled (CHECK mevcut tanimdan genisler + tohum; bagimsiz, AD10 004900 yoksa atlar; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod satir yokken varsayilan esikle calisir, kural kaydetme 'kurulum bekliyor'; sira serbest, ek)", files: [F.alertEnginePulseRule] },
    { id: "DG6-kvkk-veri-sahibi", order: 116, title: "KVKK veri sahibi basvurulari: platform_kvkk_requests + kvkk_sla uyari kurali (bagimsiz; AD10 004900 varsa CHECK genisler, yoksa atlar; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablo yokken form ve kuyruk 'kurulum bekliyor'; sira serbest, ek)", files: [F.platformKvkkRequests] },
    { id: "AD12-yasal-yardim-icerik", order: 82, title: "Koda dokunmadan icerik: surumlu yasal belgeler, yeniden onay kayitlari, tarihli mevzuat sabitleri, yardim makaleleri ve oylar (bagimsiz yeni tablolar; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablolar yokken koddaki icerik; sira serbest, ek)", files: [F.legalHelpContent] },
    { id: "FN3-elle-mutabakat", order: 102, title: "Muhasebe > Hareketler: toplu Mutabik isaretle / Mutabakati kaldir RPC'si (20261011001200 sonrasi; bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod RPC yokken 'kurulum bekliyor' der; sira serbest, ek)", files: [F.financeEntriesManualReconcile] },
    { id: "FN5-finans-belge-deposu", order: 104, title: "Muhasebe > Belgeler: expense-receipts kovasinda {tenant}/ledger/ yollari icin JWT kimlikli okuma/yazma/silme politikalari + e-Fatura listesini expenses:view okuyabilir (bagimsiz; KOD YAYININDAN ONCE uygulanir, kod politika yokken yuklemede 'Dosya kaydedilemedi' der; sira serbest)", files: [F.financeAttachmentStorage] },
    { id: "SP5-google-veri", order: 69, title: "Google baglanti merkezi: seo_gsc_daily, seo_url_inspections, ads_daily_metrics + google_data_prune/seo_gsc_summary (bagimsiz; kod tablolar yokken bos durum, cron baglanti yokken atlar; sira serbest, ek)", files: [F.googleData] },
    { id: "AD1-abonelik-operasyon", order: 71, title: "Abonelik operasyon konsolu: tenant_entitlement_overrides + tenant_entitlement_resolve, kapasite tetikleyicileri ve effective_seat_limit istisnayi sayar (20260825000600 govdesi md5 on-kosullu), subscriptions.commitment_end_at/cancel_reason_code/cancel_note, invoices.checkout_error (KOD YAYININDAN ONCE ya da SONRA; kod sutun/tablo yokken 'kurulum bekliyor'; davranis)", files: [F.subscriptionOps] },
    { id: "AD5-ofis-crm", order: 75, title: "Ofis CRM katmani: tenant_tags, tenant_tag_links, platform_tenant_crm, platform_tenant_notes, platform_tasks, tenant_health_daily, admin_saved_views + platform_tenant_health_inputs (bagimsiz; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablolar yokken 'CRM kurulumu bekliyor'; sira serbest, ek)", files: [F.platformCrm] },
    { id: "AD8-duyuru-merkezi", order: 78, title: "Duyuru, mesaj ve Yenilikler merkezi: kanal/segment/zamanlama sutunlari, teslim kuyrugu, banner, changelog + office_broadcast_state (bagimsiz; KOD YAYININDAN ONCE uygulanir, kod tablolar yokken eski anlik duyuru ve banner/yenilik yok; sira serbest, ek)", files: [F.announcementCenter] },
    { id: "AD3-tahsilat-gunlugu", order: 73, title: "Tahsilat (dunning) olay gunlugu dunning_events (bagimsiz yeni tablo; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablo yokken e-posta/SMS kademesi atlanir, rapor 'gunluk yok'; sira serbest, ek)", files: [F.dunningEvents] },
    { id: "AD6-uye-arama", order: 76, title: "Platform uye aramasi: e-posta/son giris/2FA/sube suzgecli platform_member_search RPC (bagimsiz salt-okunur; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod RPC yokken eski profil sorgusuna duser; sira serbest, ek)", files: [F.platformMemberSearch] },
    { id: "PORTAL-aktarim-oturumlari", order: 56, title: "Portal ice/disa aktarim: portal_transfer_sessions + pt_* JWT RPC'leri (20261007000210 ve 20260826002000/002010 SONRASI; sira serbest, ek)", files: [F.portalTransferSessions] },
    { id: "EVDS-piyasa-oranlari", order: 47, title: "TCMB EVDS piyasa oranlari tablosu market_rates (kod tablo yokken EVDS adimini sessizce atlar; sira serbest, ek)", files: [F.marketRates] },
    { id: "DAVET-service-role-yetki", order: 48, title: "service_role eksik yazma yetkileri: davet kodu, evrak portali, ortak/odul, KVKK kapanis (sira serbest, ek)", files: [F.serviceRoleWriteGrants] },
    { id: "GUVENILIRLIK-dekont-depo-temizligi", order: 45, title: "Kiraci dekontu depo temizligi: rent-receipts outbox izni + silinen/degisen dekont tetikleyicisi (20261012000900 ve 20261007000700 SONRASI, sira serbest, ek)", files: [F.storageCleanupReceipts] },
    { id: "ARGE-oneri-olay-kapatma", order: 43, title: "Oneri olay aninda kapatma: insight_close_call_priority RPC (20260826002500 insights SONRASI, sira serbest, ek; kod RPC yokken hatayi yutar)", files: [F.insightCloseOnContact] },
    { id: "EINV-sunucu-yazimi", order: 36, title: "e-Fatura saglayici sonucu yalniz sunucu (service_role) RPC'leriyle yazilir (000100'den SONRA; sira serbest)", files: [F.einvoiceServerOnlyWrites] },
    { id: "PORTAL-kira-dekont", order: 35, title: "Kiraci Odedim dekont fotografi: ozel rent-receipts kovasi + dekont sutunlari + token cozucu RPC (20261012000200 SONRASI, sira serbest, ek)", files: [F.rentNoticeReceipt] },
    { id: "HIZ-kabuk-platform-personeli", order: 37, title: "Kabuk RPC: aktif platform personeli satiri tek turda (20261010000100 SONRASI, sira serbest, ek)", files: [F.appShellPlatformStaff] },
    { id: "KONSEY3-portal-istekleri-v2", order: 29.9998695, title: "Portal istekleri v2: gosterim talebi + arayis guncelleme + kiraci Odedim + malik haftalik rapor anahtari (20261007000620 SONRASI; sira serbest)", files: [F.portalRequestsV2] },
    { id: "PB61-ana-ekran-home-snapshot", order: 29.9998673, title: "Ana ekran home_snapshot RPC'si (ben/ofis ilk ekran okumalari tek tur; kod RPC yokken eski sorgulara duser; sira serbest, ek)", files: [F.homeSnapshotRpc] },
    { id: "PB58-ilan-analizi", order: 29.999865, title: "Ilan analizi onbellek tablosu (kod tablo yokken analizi 'etkin degil' der, kontor dusmez; sira serbest, ek)", files: [F.listingAnalyses] },
    { id: "PB58-vitrin-sohbet-kapali", order: 29.999866, title: "vitrin_chat_context: kapali portfoy sizintisi duzeltmesi (000330 govdesi + suzgec; sira serbest)", files: [F.vitrinChatClosedListing] },
    { id: "KONSEY3-recurring-run-errors", order: 31, title: "recurring_run_due hata dizisi (errors); 20261010000900 SONRASI, sira serbest", files: [F.recurringRunErrors] },
    { id: "P12-kazanc-gizliligi", order: 30, title: "AYRI PENCERE (EN SON): kazanc gizliligi RLS", files: [F.earningsPrivacy], separate: true },
    { id: "PB57-mulk-yonetimi-omurgasi", order: 29.999863, title: "Mulk yonetimi omurgasi: kira tahsilat kaydi (kismi odeme, makbuz) + yonetim sozlesmesi + mulk sahibi hakedis defteri (kod tablo yokken eski 'odendi isaretle' akisina duser)", files: [F.propertyManagementCore] },
    { id: "PB55-admin-panel-toplulastirma", order: 29.999864, title: "Admin kontrol paneli SQL toplulastirma RPC'si (sira serbest, ek)", files: [F.platformDashboardRollups] },
    { id: "FIN-A-kasa-banka-hareket-defteri", order: 29.999868, title: "Finans: kasa/banka/kisisel hesap + para hareket defteri (komisyon/kira/aidat tahsilat baglari; kod tablolar yokken eski Giderler akisina duser; 001100 ve 001700'den SONRA)", files: [F.financeAccountsCashEntries] },
    { id: "YD2-sunum-geri-bildirimi", order: 162, title: "Sunum geri bildirimi: presentation_feedback (ilan bazinda ilgileniyorum/degil + not; bagimsiz yeni tablo; KOD YAYININDAN ONCE ya da SONRA uygulanabilir, kod tablo yokken bildirim yine gider ve kayit atlanir; sira serbest, ek)", files: [F.presentationFeedback] },
    { id: "PB57-bina-site-yonetimi", order: 29.999867, title: "Bina & site yonetimi: bina/daire modeli, donemlik toplu aidat tahakkuku, ortak gider paylastirma, tahsilat ve daire cari (M1 omurgasina baglanir; kod tablolar yokken sekmeyi gizler)", files: [F.buildingManagement] },
  ],

  // (b) Birlikte uygulanmasi gerekenler (duzeltici ana'dan sonra numaralanmis ve ayni pencerede).
  pairGroups: [
    { id: "abonelik-yukseltme", title: "Abonelik duraklatma/planli dusurme sutunlari + oransal yukseltme fulfill govdeleri", main: [F.subscriptionPause], fixes: [F.planUpgradeFulfillment], window: "PB53-abonelik-duraklatma-yukseltme", note: "001010 on-kosulu 001000 sutunlarini ve 20260826000300 canli govde md5 degerlerini (48be5cd7... / 47f246de...) arar; eksik/sapma = hicbir sey yazmadan durur. Bayraklar KAPALI birakilir; acmadan once sahip provasi." },
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
    [F.vitrinChatClosedListing, F.vitrinChatContext],
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
    // AD1: kapasite tetikleyici govdeleri 20260825000600 tabanindan turetilir.
    [F.subscriptionOps, F.seatFulfillment],
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
    // Oransal yukseltme: fulfill/v2 gövdeleri EF paket (000300) gövdesinden turetilir ve 001000 sutunlarina bakar.
    [F.subscriptionPause, F.billingAmount],
    [F.planUpgradeFulfillment, F.efPack],
    // Sureli kontor: cuzdan RPC'leri (000100) + devir tavani RPC'si (001200; no-op'a cevrilir) uzerine yazar.
    [F.efPackNamesTl, F.planPricesEfTariff],
    [F.appShellPlatformStaff, F.appShellHiddenModules],
    // FN1: v2 semasi finans/mulk yonetimi tablolarina (is_sample, reconciled_at, rent_charges.paid_amount) dayanir; RPC'ler semaya,
    // eski finance_record_entry'nin son govdesine (002900) sarilir; tasima RPC/sema sonrasi.
    [F.financeLedgerV2, F.financeAccountsCashEntries],
    [F.financeLedgerV2, F.recurringRules],
    [F.financeLedgerV2, F.bankStatementImport],
    [F.financeLedgerV2, F.financeIsSample],
    [F.financeLedgerV2, F.propertyManagementCore],
    [F.financeLedgerV2Rpc, F.financeLedgerV2],
    [F.financeLedgerV2Rpc, F.financeOwnerPayoutSource],
    [F.financeLedgerV2Backfill, F.financeLedgerV2Rpc],
    [F.financePartyAdvisorScope, F.financeLedgerV2Rpc],
    // SN1: GP1 yardimcisi (finance_party_foreign_advisor), FN1 kolon/RPC'leri ve ekstre govdesi (001400) once olmali.
    [F.financeEntriesAdvisorScopeRecurringTerms, F.financePartyAdvisorScope],
    [F.financeEntriesAdvisorScopeRecurringTerms, F.financeLedgerV2Rpc],
    [F.financeEntriesAdvisorScopeRecurringTerms, F.statementApplyRecurringCommission],
    [F.financeEntriesAdvisorScopeRecurringTerms, F.financeRecurringRuleTerms],
    // SN1: custom_role_id (DG1) ve canli govdesi donusturulen fonksiyonlarin son tanimlari (DG2 plan katalog, destek v2, portal kurallari) once olmali.
    [F.platformStaffCanGates, F.platformCustomRolesFourEyes],
    [F.platformStaffCanGates, F.planCatalogEngine],
    [F.platformStaffCanGates, F.billingAmount],
    [F.platformStaffCanGates, F.supportDeskV2],
    [F.platformStaffCanGates, F.portalRulesCore],
    [F.platformStaffCanGates, F.growthEngine],
    [F.platformStaffCanGates, F.platformMrrDaily],
    // DG2: canli govdeleri donusturulen fonksiyonlarin son tanimlari ve plan_monthly_amount'un 20261008001000 govdesi once olmali.
    [F.planCatalogEngine, F.planPricesEfTariff],
    [F.planCatalogEngine, F.planUpgradeFulfillment],
    [F.planCatalogEngine, F.subscriptionPause],
    [F.planCatalogEngine, F.billingAmount],
    // GP2: fulfill'in canli govdesi (plan_upgrade + billing_plan_known donusumu) ve growth_cash_net once olmali.
    [F.billingVatRateInvoices, F.planCatalogEngine],
    [F.billingVatRateInvoices, F.planUpgradeFulfillment],
    [F.billingVatRateInvoices, F.growthEngine],
    [F.financeIsSample, F.financeAccountsCashEntries],
    [F.financeIsSample, F.recurringRules],
    [F.financeIsSample, F.expenseBudgetsRecurring],
    [F.portalRequestsV2, F.customerPortalRequests],
    [F.propertyPriceProposals, F.propertiesPriceDropGuard],
    [F.priceProposalOversightGate, F.propertyPriceProposals],
    [F.rentChargesFinancialGuard, F.propertyManagementCore],
    [F.recurringRunErrors, F.recurringRules],
    [F.efCreditLots, F.efWallet],
    [F.efCreditLots, F.efPlanExpiry],
    // Katalog/tarife seed'i (suresiz -> sureli) lot sisteminden ONCE uygulanir (dosya adi sirasi ile de ayni).
    [F.efCreditLots, F.planPricesEfTariff],
    [F.planUpgradeFulfillment, F.subscriptionPause],
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
    // Ofis Merkezi: pool_assignments RLS'i has_effective_permission('office_center', ...) kullanir -> seed ONCE.
    [F.poolAssignments, F.officeCenterPerms],
    // PB45: overload temizliginin on-kosulu fiyat butunlugu (000300) govdesidir; sahiplik devri RPC'leri tabloya (001300) dayanir.
    [F.planSubscriptionAmount, F.billingAmount],
    [F.ownershipTransferRpc, F.ownership],
    // PB46: gecis kaydi property_control_state'e, envanter/eslesme RPC'leri cekirdek RPC'lere, ilce/SLA duzeltmesi KPI/SLA tablolarina dayanir.
    [F.lcLifecycleEvents, F.lcControlState],
    [F.lcInventoryMatching, F.lcAnomalyRpcs],
    [F.lcInventoryMatching, F.lcQueueRpcs],
    [F.lcDailySync, F.lcInventoryMatching],
    [F.lcInventorySourceHardening, F.lcDailySync],
    [F.lcDistrictSlaReset, F.lcControlState],
    [F.lcDistrictSlaReset, F.lcAnomalyTables],
    // PB49: anket genisletmesi anket modulu tablolarina ve survey_is_manager'a dayanir.
    [F.surveyMatrix, F.survey],
    // PB51: webhook izin kapisi 000320 govdelerini yeniden yazar.
    [F.webhookEnqueueGate, F.webhooksApiKeys],
    // PB51: closure_loss tetikleyicisi anomali tablolarina dayanir.
    [F.closureLossAnomalies, F.lcAnomalyTables],
    // FSBO: izin seed'i tablolarin RLS'inden once ya da sonra olabilir, ancak ayni pencerede uygulanir.
    [F.fsboPermissionDefaults, F.fsboLeads],
    // FSBO RLS kapsami: tablo (002400) ve kapatma RPC'si (002500) once var olmalidir.
    [F.fsboRlsScope, F.fsboLeads],
    [F.fsboRlsScope, F.fsboRealtime],
    // FSBO SELECT kapsami: UPDATE politikasi/sutun listesi 002600'de kurulur, bu dosya onun ustune yazar.
    [F.fsboSelectScope, F.fsboRlsScope],
    // Hakedis kasa kaynagi: owner_payouts (core), finance_* (000600/001100) ve tavan govdesi (001400) uzerine yazar.
    [F.financeOwnerPayoutSource, F.financeEntrySourceAmountGuard],
    [F.financeOwnerPayoutSource, F.propertyManagementCore],
    // RLS InitPlan sarmasi fsbo_leads_select'in 002800 ifadesini (danisman kapsami) esas alir; once 002800 uygulanmali.
    [F.rlsInitplanFsboStaff, F.fsboSelectScope],
    // Portal aktarim RPC'leri lc_bind_portal_listing (002000), lc_row_visible (002010) ve lc_mark_state_stale (002040) cekirdegine dayanir.
    [F.portalTransferSessions, F.lcInventoryMatching],
    // Ogrenen kurallar: RPC'ler ve ogrenme cekirdek tablolara, cekirdek portal_transfer_sessions'a (FK) dayanir.
    [F.portalRulesRpcs, F.portalRulesCore],
    [F.portalRulesLearn, F.portalRulesCore],
    [F.portalRulesCore, F.portalTransferSessions],
    // SP3: huni RPC'si sayac tablosunu (003200) ve signup_attributions.channel sutununu (003210) okur.
    [F.growthFunnel, F.publicMeasurement],
    [F.growthFunnel, F.signupAttributionExt],
    // KQ2: politika yeniden yazimlari mevcut yardimcilara ve ifadelere dayanir.
    [F.kq2CommissionsRls, F.earningsPrivacy],
    [F.kq2LcFinanceRls, F.lcScopeHelpers],
    [F.kq2LcFinanceRls, F.lcLifecycleEvents],
    [F.kq2LcFinanceRls, F.earningsStatementPrivacy],
    [F.kq2MetricsSinglePass, F.dashboardSnapshotRpcs],
    // SK2: yayin kirpma Broadcast tetikleyicisini (020000) ve KQ2 yayin listesini (017000) esas alir.
    [F.sk2RealtimeTrim, F.sk2TenantBroadcast],
    [F.sk2RealtimeTrim, F.kq2RealtimeTrim],
    // SK4: ozel konu politikasi growth_flag_on (MFA bayragi) yardimcisini kullanir.
    [F.sk4AdminStaffBroadcast, F.growthEngine],
    // SK6: her dosya degistirdigi fonksiyonun son canli govdesinin uzerine yazar; platform toplulastirmasi is_internal ve platform_mrr_daily'yi okur.
    [F.sk6ReportingLocalAxis, F.earningsStatementPrivacy],
    [F.sk6FinancePnlVatFix, F.financeLedgerV2Rpc],
    [F.sk6FinancePnlVatFix, F.financePartyAdvisorScope],
    [F.sk6RentalKpiOverdue, F.dbPerfRlsInitplanKpi],
    [F.sk6CommissionSplitsDeriveRate, F.commissionSplitProfile],
    [F.sk6CommissionSplitsDeriveRate, F.commissionSplitsIntegrity],
    [F.sk6PlatformReportingLocalAxis, F.sk6TenantIsInternal],
    [F.sk6PlatformReportingLocalAxis, F.platformMrrDaily],
    // SK9: sayim RPC'si properties.currency kolonunu okur; 090100 ancak 090000'dan sonra uygulanir.
    [F.sk9PublishGateCounts, F.sk9PropertyCurrency],
    // M3: fonksiyonun son govdesi YD1 dosyasindadir; bu dosya onu yeniden tanimlar.
    [F.m3DemoResetNotificationReads, F.demoTenantNightlyReset],
    // WP1: kayit cekirdegi finans v2 semasi, P12 cari kapsami ve son settle/KDV govdeleri uzerine kurulur; v3 gorunumu posting_key okur.
    [F.wp1FinancePostingCore, F.financeLedgerV2Rpc],
    [F.wp1FinancePostingCore, F.financePartyAdvisorScope],
    [F.wp1FinancePostingCore, F.sk6FinancePnlVatFix],
    [F.wp1FinanceOpenItemsV3, F.wp1FinancePostingCore],
    [F.wp1FinanceOpenItemsV3, F.buildingManagement],
    [F.wp1FinanceOpenItemsV3, F.payouts],
    // WP2: tetikleyiciler kayit cekirdegine ve v3 gorunumune, geri doldurma tetikleyici esitleyicilerine, K/Z v3 son K/Z govdesine dayanir.
    [F.wp2FinanceAccrualTriggers, F.wp1FinancePostingCore],
    [F.wp2FinanceAccrualTriggers, F.wp1FinanceOpenItemsV3],
    [F.wp2FinanceAccrualTriggers, F.buildingManagement],
    [F.wp2FinanceAccrualTriggers, F.payouts],
    [F.wp2FinancePartiesBackfill, F.wp2FinanceAccrualTriggers],
    [F.wp2FinancePnlV3, F.wp2FinanceAccrualTriggers],
    [F.wp2FinancePnlV3, F.sk6FinancePnlVatFix],
    // WP4: aidat RPC'leri finans v2 cekirdegine (settle/cancel son govdeleri) ve mulk/bina yonetimi tablolarina dayanir.
    [F.wp4PropertyDuesOpenItems, F.sk6FinancePnlVatFix],
    [F.wp4PropertyDuesOpenItems, F.financePartyAdvisorScope],
    [F.wp4PropertyDuesOpenItems, F.buildingManagement],
    [F.wp4PropertyDuesOpenItems, F.sk10ModuleWritePolicies],
    // WP5: e-Fatura tetigi kayit cekirdegine (finance_post_internal / finance_reverse_internal) ve e-Fatura son yazma yollarina dayanir.
    // A8: asama gecmisi kapsam RLS'ine (anlasma gorunurlugu) dayanir; hedef kapsami takim tablosuna ve faaliyet hedeflerine; rapor fonksiyonlari asama gecmisi yardimcilarina ve expenses.portal_key'e.
    [F.a8DealStageHistory, F.sk10ScopeRls],
    [F.a8TargetsScopeCalls, F.targets],
    [F.a8TargetsScopeCalls, F.takimTeams],
    [F.a8ReportPeriodFunnel, F.a8DealStageHistory],
    [F.a8ReportPeriodFunnel, F.expenseBudgetsRecurring],
    // A9: 2FA kapisi govdesi perf turunun plpgsql govdesi uzerine kurulur; dokum tablosu kvkk_requests'e baglanir.
    [F.a9OfficeTotp, F.perfIndexesRpc],
    [F.a9KvkkSubjectExports, F.k5Kvkk],
    // B4: stopaj tetigi tahsilat cekirdeginin rent_charges yapisina; defter kaynagi defter tablosuna dayanir.
    [F.b4RentalWithholding, F.propertyManagementCore],
    [F.b4LedgerAutoSource, F.ledger],
    // B6: oyun kitabi sutunlari AD5 platform_tasks'a; limit RPC'si istisna cozucusu ve platform icgoru tablosuna dayanir.
    [F.b6CsPlaybooksNudges, F.platformCrm],
    [F.b6TenantUsageRpcs, F.subscriptionOps],
    [F.b6TenantUsageRpcs, F.platformInsights],
    // B8: onay vekili, approval_requests RLS yardimcisinin uzerine kurulur.
    [F.b8ApprovalDelegate, F.sec3Approval],
    [F.wp5EinvoiceLedgerLink, F.wp1FinancePostingCore],
    [F.wp5EinvoiceLedgerLink, F.einvoiceServerOnlyWrites],
    [F.wp5EinvoiceLedgerLink, F.financePartyAdvisorScope],
    // A1: merge_properties, merge_fk_refs cekirdegine dayanir.
    [F.a1MergeProperties, F.a1MergeCustomersV2],
    // B7: ay sonu okuyucusu platform_mrr_daily'ye; birlestirme destek masasi 2'ye (tags); presence SK4 rt_staff_can_listen'e; oneri bagi oneri panosu ve yeniliklere.
    [F.b7PlatformMrrMonthEnd, F.platformMrrDaily],
    [F.b7SupportTicketMerge, F.supportDeskV2],
    [F.b7TicketDeskPresence, F.sk4AdminStaffBroadcast],
    [F.b7FeatureRequestChangelog, F.flagRulesProductFeedback],
    [F.b7FeatureRequestChangelog, F.announcementCenter],
    [F.b7SupportArticleDeflections, F.legalHelpContent],
    // GA-08: my_notification_counts ve notification_reads SK5'te tanimlanir.
    [F.ga08NotificationsTopic, F.sk5NotificationReads],
    // B9: riskli anlasma icgorusu A8'in deals.stage_changed_at / expected_close_date kolonlarini okur.
    [F.b9InsightStalledDealsStage, F.a8DealStageHistory],
    // C0 (WP6): acik kalem v3 gorunumu ve GA-08 konu fonksiyonunun son govdeleri yeni href'lerle yeniden tanimlanir.
    [F.c0FinanceHrefs, F.wp1FinanceOpenItemsV3],
    [F.c0FinanceHrefs, F.ga08NotificationsTopic],
    // C1: iliski tablosu KVKK temizlik fonksiyonunu genisletir; isi RPC'si origin kolonunu okur; birlestirme v3 iki yeni tabloya ve v2 cekirdegine dayanir.
    [F.c1CustomerRelations, F.c1CustomerContacts],
    [F.c1HeatEngagement, F.c1CommPinMention],
    [F.c1MergeContacts, F.c1CustomerContacts],
    [F.c1MergeContacts, F.c1CustomerRelations],
    [F.c1MergeContacts, F.a1MergeCustomersV2],
    // C2: tutanak RPC govdesi WP4 depozito emanetine ve finans v2 cekirdegine; basvuru kira kaydina (mulk yonetimi omurgasi) baglanir.
    [F.c2RentalInspections, F.wp4PropertyDuesOpenItems],
    [F.c2RentalApplications, F.propertyManagementCore],
    // C3: isletme projesi bina yonetimi tablolarina ve create_building_batch RPC'sine dayanir.
    [F.c3BuildingBudgetAnnouncements, F.buildingManagement],
  ],

  // Eski K4 dali (20260818000400_property_media_is_document) KALDIRILDI: PB48 (20261007000100) yerini aldi; kod sutun
  // yokken ad kuralina dustugu icin "migration once" kurali artik gerekmez.
  externalPending: [],
};
