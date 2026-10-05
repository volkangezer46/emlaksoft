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
    // Kullanici karari (2026-10-05): kazanc gizliligi SIRADA EN SONDA, ayri pencere.
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
