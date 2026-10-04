/**
 * Yayin penceresi verisi: hangi migration hangi pencerede, hangileri BIRLIKTE uygulanir, etki sinifi.
 * Mantik: `migration-pairs.ts` (saf, testli). Kilavuz: `docs/runbooks/YAYIN_PENCERESI.md`.
 *
 * Yeni bir uygulanmamis migration eklenirse BURAYA da eklenmelidir (etki sinifi + pencere); aksi halde
 * `npm run check:migration-pairs` "etki-sinifi-yok / pencere-yok" hatasi verir. Bu dosya SQL'e dokunmaz.
 */
import type { GroupSpec } from "../src/lib/migration-pairs";

/** Canlida uygulanan son migration (docs/HAFIZA.md §2). Bundan buyuk surumler "uygulanmamis" sayilir. */
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
  k4IsDocument: "20260818000400_property_media_is_document.sql",
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
    [F.k4IsDocument]: "ek",
  },

  // Pencereler yayin sirasidir (order artan). Her pencere --only ile dosya dosya uygulanir.
  windows: [
    { id: "P1-duzeltme", order: 1, title: "Davranis duzeltmesi: telefon CHECK + kampanya claim", files: [F.phone, F.campaignClaim] },
    { id: "P2-seed", order: 2, title: "Seed: kayip nedeni + earnings_all izin varsayilani", files: [F.lossSeed, F.earningsPerm] },
    {
      id: "P3-komisyon-temel",
      order: 3,
      title: "Komisyon/talep/atama temeli (yalniz ekler)",
      files: [F.splits, F.plans, F.payouts, F.demandCols, F.demandRpc, F.targets, F.assignRules, F.profileScope],
    },
    {
      id: "P4-altyapi",
      order: 4,
      title: "Moduller, SEO 404, oturum kapatma, deneme gunu, plan/fiyat kilidi, ornek veri kapsami",
      files: [F.sampleScope, F.tenantModules, F.seo404, F.trialDays, F.revokeSessions, F.planBusiness, F.priceLock],
    },
    { id: "P5-kupon", order: 5, title: "Kuponlar + kupon tenant siniri", files: [F.coupons, F.sec3Coupon] },
    { id: "P6-k5-kvkk", order: 6, title: "K5 abonelik/sube + KVKK talepleri + rol kapisi", files: [F.k5Subs, F.k5Kvkk, F.sec3Kvkk] },
    {
      id: "P7-danisman-profil",
      order: 7,
      title: "Danisman profili/ozel kimlik + PII bicim kisiti",
      files: [F.advisorPrivate, F.advisorSpecialties, F.sec3Advisor],
    },
    {
      id: "P8-ilan-havuzu",
      order: 8,
      title: "Atama kurali ilan hedefi + ilan havuzu + insert/claim korumasi",
      files: [F.assignListing, F.listingPool, F.poolFlags, F.sec3Pool],
    },
    { id: "P9-ilan-sahibi", order: 9, title: "Ilan sahibi bilgisi + guncelleme kapsami", files: [F.ownerInfo, F.sec3Owner] },
    { id: "P10-ofis-kontrol", order: 10, title: "Ofis kontrol merkezi + onay istekleri RLS", files: [F.oversight, F.sec3Approval] },
    { id: "P11-f-modulleri", order: 11, title: "Mahalle notlari, yasal kayit defteri, evrak linkleri", files: [F.neighborhood, F.ledger, F.docRequests] },
    { id: "P12-kazanc-gizliligi", order: 12, title: "AYRI PENCERE: kazanc gizliligi RLS", files: [F.earningsPrivacy], separate: true },
    { id: "PK4-is-document", order: 13, title: "K4 is_document (dal main'e girerse): migration KODDAN ONCE", files: [F.k4IsDocument] },
  ],

  // (b) Birlikte uygulanmasi gerekenler (duzeltici ana'dan sonra numaralanmis ve ayni pencerede).
  pairGroups: [
    { id: "onay-kapisi", title: "Ofis kontrol (oversight) + approval_requests RLS + onay kapisi", main: [F.oversight], fixes: [F.sec3Approval], window: "P10-ofis-kontrol" },
    { id: "ilan-havuzu", title: "Ilan havuzu + insert/claim korumasi", main: [F.listingPool], fixes: [F.sec3Pool], window: "P8-ilan-havuzu" },
    { id: "kvkk-talepleri", title: "kvkk_requests + rol kapisi", main: [F.k5Kvkk], fixes: [F.sec3Kvkk], window: "P6-k5-kvkk" },
    { id: "ilan-sahibi", title: "property_owner_info + guncelleme kapsami", main: [F.ownerInfo], fixes: [F.sec3Owner], window: "P9-ilan-sahibi" },
    { id: "danisman-ozel", title: "advisor_private + PII biçim kisiti", main: [F.advisorPrivate], fixes: [F.sec3Advisor], window: "P7-danisman-profil" },
    { id: "kuponlar", title: "coupons + max_per_tenant", main: [F.coupons], fixes: [F.sec3Coupon], window: "P5-kupon" },
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
