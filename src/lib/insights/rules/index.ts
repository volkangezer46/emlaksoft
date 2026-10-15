import type { SupabaseClient } from "@supabase/supabase-js";
import type { InsightDraft, InsightKind, InsightPermission, InsightRuleRun } from "@/lib/insights/types";
import {
  InsightFactsUnavailable,
  loadDeadlines,
  loadQuietCustomers,
  loadStaleListings,
  loadStalledDeals,
  loadWeeklySeries,
  INSIGHT_FACT_LIMIT,
} from "@/lib/insights/facts";
import { readTenantSettings, numberSetting } from "@/lib/settings/tenant-read";
import { CALL_MIN_QUIET_DAYS, CALL_PRIORITY_RULE_ID, evaluateCallPriorityRun } from "@/lib/insights/rules/call-priority";
import { DEAL_MIN_IDLE_DAYS, DEAL_RISK_RULE_ID, evaluateDealRiskRun } from "@/lib/insights/rules/deal-risk";
import { PRICE_ACTION_RULE_ID, PRICE_MIN_DAYS, evaluatePriceActionRun } from "@/lib/insights/rules/price-action";
import { DEADLINE_RULE_ID, evaluateDeadlinesRun } from "@/lib/insights/rules/deadline";
import { AUTHORITY_EXPIRED_RULE_ID, evaluateAuthorityExpiredRun } from "@/lib/insights/rules/authority-expired";
import { loadExpiredAuthorities } from "@/lib/insights/authority-facts";
import { ANOMALY_RULE_ID, evaluateAnomalies } from "@/lib/insights/rules/anomaly";
import { LIFECYCLE_RULE_ID, evaluateLifecycle } from "@/lib/insights/rules/lifecycle";
import { loadLifecycleFacts } from "@/lib/insights/lifecycle-facts";
import {
  AUTHORITY_RENEWAL_RULE_ID,
  HOME_VALUE_RULE_ID,
  PRICE_REVISION_RULE_ID,
  REFERRAL_INVITE_RULE_ID,
  UNSHOWN_MATCH_RULE_ID,
  evaluateAuthorityRenewal,
  evaluateHomeValue,
  evaluatePriceRevision,
  evaluateReferralInvites,
  evaluateUnshownMatches,
} from "@/lib/insights/rules/revenue";
import {
  loadAuthorityRenewals,
  loadHomeValueFacts,
  loadPriceRevisionFacts,
  loadReferralInviteFacts,
  loadUnshownMatches,
} from "@/lib/insights/revenue-facts";
import {
  EXPENSE_BUDGET_RULE_ID,
  PORTAL_ROI_RULE_ID,
  SUBSCRIPTION_RULE_ID,
  evaluateExpenseBudgets,
  evaluatePortalRoi,
  evaluateSubscriptions,
} from "@/lib/insights/rules/finance";
import { loadBudgetContext, loadBudgetContextShared, loadPortalRoi, loadRecurringSeries } from "@/lib/finance/load";
import { CASH_CATEGORIES } from "@/lib/finance/cash/categories";
import { pickLeastEfficientPortal, unusedPortalSubscriptions } from "@/lib/finance/portal-roi";
import { EXPENSE_CATEGORIES } from "@/lib/definition-defaults";
import { trNextMonthStartMs } from "@/lib/clock";
import { loadProspectingFacts, FSBO_FACT_LIMIT } from "@/lib/insights/prospecting-facts";
import {
  FSBO_AGING_RULE_ID,
  FSBO_CLAIM_RULE_ID,
  FSBO_FOLLOWUP_RULE_ID,
  FSBO_PRICE_DROP_RULE_ID,
  FSBO_RELISTED_RULE_ID,
  FSBO_UNCALLED_RULE_ID,
  evaluateFsboAging,
  evaluateFsboClaimExpiring,
  evaluateFsboFollowupDue,
  evaluateFsboPriceDrop,
  evaluateFsboRelisted,
  evaluateFsboUncalled,
} from "@/lib/insights/rules/prospecting";
import { isFeatureEnabledIn } from "@/lib/modules/logic";
import { loadTenantModuleState } from "@/lib/modules/state";
import type { FsboFact } from "@/lib/insights/rules/prospecting";
import { eidsPropertyFactsOnce, loadEidsMailSilentFact } from "@/lib/insights/eids-facts";
import { EIDS_REVOKED_LIVE_RULE_ID, evaluateEidsRevokedStillLive } from "@/lib/insights/rules/eids-revoked-still-live";
import { EIDS_UNKNOWN_LIVE_RULE_ID, evaluateEidsUnknownLive } from "@/lib/insights/rules/eids-unknown-live";
import { EIDS_NO_EMAIL_RULE_ID, evaluateEidsNoEmailSeen } from "@/lib/insights/rules/eids-no-email-seen";
import { EIDS_MAIL_SILENT_RULE_ID, evaluateEidsMailSilent } from "@/lib/insights/rules/eids-mail-silent";

const categoryLabel = (value: string): string => EXPENSE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
/** Bütçe anahtarı etiketi (Bütçe sekmesiyle aynı sıra: sistem hareket kategorisi → gider tanımı → anahtar). */
const budgetLabel = (value: string): string =>
  CASH_CATEGORIES.find((c) => c.value === value && c.direction === "out")?.label ?? categoryLabel(value);
/** Gider içgörüleri (bütçe, abonelik, portal maliyeti) ofis giderini gösterir: alıcıda gider görüntüleme izni şart (SK6/B165). */
const EXPENSES_VIEW: InsightPermission = { module: "expenses", action: "view" };

/**
 * KURAL KAYIT LİSTESİ (tek ortak dosya). Sonraki rol paketleri (danışman 5a, yönetim 5b, muhasebe 5c)
 * YALNIZ kendi satırını ekler; engine bu listeyi sırayla koşar. `digest` bir "post" kuralıdır (diğerlerinin çıktısını
 * özetler) ve engine tarafından ayrıca çağrılır, bu listede YOKTUR.
 *
 * Satır sözleşmesi: `run` olguyu yükler ve SAF `evaluate*` fonksiyonuna verir; `nowMs` enjekte edilir.
 */
export type InsightRule = {
  /** Sürümlü kimlik: "deal_risk@1". */
  id: string;
  kind: InsightKind;
  /** Ofis ayarlarında gösterilen Türkçe kural adı (tek kaynak; ekranlar kopya yazmaz). */
  label: string;
  /**
   * Olguyu yükler + değerlendirir. RPC yoksa InsightFactsUnavailable fırlatır (engine "etkin değil" sayar).
   * Dönüş `{ drafts, liveEntityIds }`: liveEntityIds üst sınırdan ÖNCEKİ canlı varlıklardır (engine koşulu kalkanı kapatır);
   * `null` = bu kural için otomatik kapatma yok. Yalnız dizi döndüren kural da kabul edilir ("kapatma yok" sayılır).
   */
  run: (admin: SupabaseClient, tenantId: string, nowMs: number) => Promise<InsightRuleRun | InsightDraft[]>;
  /**
   * Alıcıdan istenen modül izni (SK6/B165). Verilirse engine yalnız rolü uyan VE bu izni (etkin: matris + ofis/kullanıcı
   * istisnaları) taşıyan alıcılara dağıtır. Ör. gider içgörüleri → expenses:view (gider izni olmayan şube müdürüne gitmez).
   */
  requiredPermission?: InsightPermission;
};

/** Olgu kümesi satır tavanına ulaştıysa küme kesik olabilir: kapatma yok (güvenli taraf). */
function guardTruncated(run: InsightRuleRun, factCount: number): InsightRuleRun {
  return factCount >= INSIGHT_FACT_LIMIT ? { drafts: run.drafts, liveEntityIds: null } : run;
}

/** Olgu kümesi tam olmayan / dönemsel kurallar: taslaklar aynen, kapatma yok. */
const noClose = (drafts: InsightDraft[]): InsightRuleRun => ({ drafts, liveEntityIds: null });

/**
 * Ofis eşikleri (Ofis Tanımları Merkezi): kural çalıştırıcısına verilen `admin` ile, AÇIK tenant_id parametresiyle okunur
 * (yeni istemci oluşturulmaz). Kayıt yoksa/okunamazsa bugünkü sabitler (davranış değişmez).
 */
export async function insightThresholds(admin: SupabaseClient, tenantId: string) {
  const v = await readTenantSettings(admin, tenantId, ["office.alert.deal_stale_days", "office.insight.customer_quiet_days", "office.insight.listing_stale_days"]);
  return {
    dealIdleDays: numberSetting(v, "office.alert.deal_stale_days", DEAL_MIN_IDLE_DAYS),
    quietDays: numberSetting(v, "office.insight.customer_quiet_days", CALL_MIN_QUIET_DAYS),
    listingStaleDays: numberSetting(v, "office.insight.listing_stale_days", PRICE_MIN_DAYS),
  };
}

/**
 * Sahibinden ilanlar (portföy avı): tek olgu sorgusu, altı saf kural. Modül kapalıysa kart üretilmez ve açık kartlar kapanır.
 * Olgu kümesi satır tavanına ulaştıysa kapatma yapılmaz (güvenli taraf).
 */
// Altı kural aynı ofis turunda AYNI olgu kümesini paylaşır (son anahtar önbelleği: ofis + tur zamanı).
let prospectingMemo: { key: string; value: Promise<{ enabled: boolean; facts: FsboFact[]; truncated: boolean }> } | null = null;
function prospectingFactsOnce(admin: SupabaseClient, tenantId: string, nowMs: number) {
  const key = `${tenantId}:${nowMs}`;
  if (prospectingMemo?.key === key) return prospectingMemo.value;
  const value = (async () => {
    const moduleState = await loadTenantModuleState(admin, tenantId);
    if (!isFeatureEnabledIn(moduleState, "prospecting")) return { enabled: false, facts: [], truncated: false };
    return { enabled: true, ...(await loadProspectingFacts(admin, tenantId)) };
  })();
  prospectingMemo = { key, value };
  value.catch(() => {
    if (prospectingMemo?.key === key) prospectingMemo = null;
  });
  return value;
}

async function runProspecting(
  admin: SupabaseClient,
  tenantId: string,
  nowMs: number,
  evaluate: (facts: readonly FsboFact[], nowMs: number) => InsightRuleRun,
): Promise<InsightRuleRun> {
  const { enabled, facts, truncated } = await prospectingFactsOnce(admin, tenantId, nowMs);
  if (!enabled) return { drafts: [], liveEntityIds: new Set<string>() };
  const run = evaluate(facts, nowMs);
  return truncated || facts.length >= FSBO_FACT_LIMIT ? { drafts: run.drafts, liveEntityIds: null } : run;
}

export const INSIGHT_RULES: readonly InsightRule[] = [
  {
    id: CALL_PRIORITY_RULE_ID,
    kind: "call_priority",
    label: "Bugün ara (sessiz kalan müşteriler)",
    run: async (admin, tenantId, nowMs) => {
      const days = await insightThresholds(admin, tenantId);
      const facts = await loadQuietCustomers(admin, tenantId, days.quietDays);
      return guardTruncated(evaluateCallPriorityRun(facts, nowMs, days.quietDays), facts.length);
    },
  },
  {
    id: DEAL_RISK_RULE_ID,
    kind: "deal_risk",
    label: "Hareketsiz kalan anlaşmalar",
    run: async (admin, tenantId, nowMs) => {
      const days = await insightThresholds(admin, tenantId);
      const facts = await loadStalledDeals(admin, tenantId, days.dealIdleDays);
      return guardTruncated(evaluateDealRiskRun(facts, nowMs, days.dealIdleDays), facts.length);
    },
  },
  {
    id: PRICE_ACTION_RULE_ID,
    kind: "price_action",
    label: "Fiyatı gözden geçirilecek ilanlar",
    run: async (admin, tenantId, nowMs) => {
      const days = await insightThresholds(admin, tenantId);
      const facts = await loadStaleListings(admin, tenantId, days.listingStaleDays);
      return guardTruncated(evaluatePriceActionRun(facts, nowMs, days.listingStaleDays), facts.length);
    },
  },
  {
    id: DEADLINE_RULE_ID,
    kind: "deadline",
    label: "Yetki bitişi ve gecikmiş ilan teyidi",
    run: async (admin, tenantId, nowMs) => {
      const facts = await loadDeadlines(admin, tenantId);
      return guardTruncated(evaluateDeadlinesRun(facts, nowMs), facts.length);
    },
  },
  {
    id: ANOMALY_RULE_ID,
    kind: "anomaly",
    label: "Haftalık sıra dışı değişimler",
    // Dönemsel (varlıksız) kural: kapatma yok.
    run: async (admin, tenantId, nowMs) => noClose(evaluateAnomalies(await loadWeeklySeries(admin, tenantId), nowMs)),
  },
  {
    // Satış sonrası / yeniden satış / çapraz satış (alımın 3-5. yılı, kira bitişine 90 gün, evini satan malik).
    id: LIFECYCLE_RULE_ID,
    kind: "match_suggestion",
    label: "Satış sonrası ve yeniden satış fırsatları",
    // Olgu yükleyicisi dönemsel pencere + üst sınırlı: kapatma yok.
    run: async (admin, tenantId, nowMs) => noClose(evaluateLifecycle(await loadLifecycleFacts(admin, tenantId, nowMs), nowMs)),
  },
  // GELİR FIRSATLARI (saf kurallar: rules/revenue.ts; olgular: revenue-facts.ts). Her biri ofis ayarından ayrı kapatılabilir.
  {
    id: AUTHORITY_RENEWAL_RULE_ID,
    kind: "deadline",
    label: "Yetki yenileme fırsatı (16-30 gün)",
    run: async (admin, tenantId, nowMs) => noClose(evaluateAuthorityRenewal(await loadAuthorityRenewals(admin, tenantId, nowMs), nowMs)),
  },
  {
    // Süresi DOLMUŞ yetki (0-15 gün deadline@1, 16-30 gün authority_renewal@1; bu kural yalnız bitişi geçmişi kapsar).
    id: AUTHORITY_EXPIRED_RULE_ID,
    kind: "deadline",
    label: "Yetki süresi dolmuş ilanlar",
    // Olgu yükleyicisi sayfalı ve eksiksiz (üst sınırsız): canlı küme güvenilir.
    run: async (admin, tenantId, nowMs) => evaluateAuthorityExpiredRun(await loadExpiredAuthorities(admin, tenantId, nowMs), nowMs),
  },
  // EİDS YETKİ UYUMU (saf kurallar: rules/eids-*.ts; olgular: eids-facts.ts, dört kural aynı portföy kümesini paylaşır).
  // E-posta gelmeyen durumun güvenlik ağı: iptal/dolmuş ama portalda yayında, bilinmeyen yetkiyle yayında, 120 gün teyitsiz
  // onay, 90 gün sessiz alma adresi. Olgu kümesi tam (sayfalı, üst sınırsız): canlı küme kapatma için güvenilir.
  {
    id: EIDS_REVOKED_LIVE_RULE_ID,
    kind: "compliance",
    label: "Yetkisi sona erdiği hâlde portalda yayında olan ilanlar",
    run: async (admin, tenantId, nowMs) => {
      const f = await eidsPropertyFactsOnce(admin, tenantId, nowMs);
      return evaluateEidsRevokedStillLive(f.facts, f.todayKey, nowMs);
    },
  },
  {
    id: EIDS_UNKNOWN_LIVE_RULE_ID,
    kind: "compliance",
    label: "Yetki durumu bilinmeden yayında olan ilanlar",
    run: async (admin, tenantId, nowMs) => evaluateEidsUnknownLive((await eidsPropertyFactsOnce(admin, tenantId, nowMs)).facts, nowMs),
  },
  {
    id: EIDS_NO_EMAIL_RULE_ID,
    kind: "compliance",
    label: "120 gündür teyit görmemiş onaylı yetkiler",
    run: async (admin, tenantId, nowMs) => {
      const f = await eidsPropertyFactsOnce(admin, tenantId, nowMs);
      if (!f.confirmationsKnown) throw new InsightFactsUnavailable("properties.authority_last_email_at");
      return evaluateEidsNoEmailSeen(f.facts, nowMs);
    },
  },
  {
    id: EIDS_MAIL_SILENT_RULE_ID,
    kind: "compliance",
    label: "Bakanlık e-postası gelmiyor (iletme kuralı)",
    run: async (admin, tenantId, nowMs) => noClose(evaluateEidsMailSilent(await loadEidsMailSilentFact(admin, tenantId, nowMs), nowMs)),
  },
  {
    id: UNSHOWN_MATCH_RULE_ID,
    kind: "match_suggestion",
    label: "Gösterilmemiş uygun eşleşmeler",
    run: async (admin, tenantId, nowMs) => noClose(evaluateUnshownMatches(await loadUnshownMatches(admin, tenantId, nowMs), nowMs)),
  },
  {
    id: HOME_VALUE_RULE_ID,
    kind: "match_suggestion",
    label: "Evini satan müşteriye değerleme önerisi",
    run: async (admin, tenantId, nowMs) => noClose(evaluateHomeValue(await loadHomeValueFacts(admin, tenantId, nowMs), nowMs)),
  },
  {
    id: PRICE_REVISION_RULE_ID,
    kind: "price_action",
    label: "Fiyat revizyonu önerisi",
    run: async (admin, tenantId, nowMs) => noClose(evaluatePriceRevision(await loadPriceRevisionFacts(admin, tenantId, nowMs), nowMs)),
  },
  {
    id: REFERRAL_INVITE_RULE_ID,
    kind: "match_suggestion",
    label: "Memnun müşteriye tavsiye daveti",
    run: async (admin, tenantId, nowMs) => noClose(evaluateReferralInvites(await loadReferralInviteFacts(admin, tenantId, nowMs), nowMs)),
  },
  // SAHİBİNDEN İLANLAR (portföy avı; saf kurallar: rules/prospecting.ts; olgular: prospecting-facts.ts). Örnek veri kart üretmez.
  { id: FSBO_UNCALLED_RULE_ID, kind: "call_priority", label: "Sahibinden ilan: kayıttan beri aranmayanlar", run: (a, t, n) => runProspecting(a, t, n, evaluateFsboUncalled) },
  { id: FSBO_FOLLOWUP_RULE_ID, kind: "call_priority", label: "Sahibinden ilan: tekrar arama günü gelenler", run: (a, t, n) => runProspecting(a, t, n, evaluateFsboFollowupDue) },
  { id: FSBO_PRICE_DROP_RULE_ID, kind: "call_priority", label: "Sahibinden ilan: fiyatı düşenler", run: (a, t, n) => runProspecting(a, t, n, evaluateFsboPriceDrop) },
  { id: FSBO_RELISTED_RULE_ID, kind: "call_priority", label: "Sahibinden ilan: yeniden yayına çıkanlar", run: (a, t, n) => runProspecting(a, t, n, evaluateFsboRelisted) },
  { id: FSBO_AGING_RULE_ID, kind: "call_priority", label: "Sahibinden ilan: uzun süredir satılamayanlar", run: (a, t, n) => runProspecting(a, t, n, evaluateFsboAging) },
  { id: FSBO_CLAIM_RULE_ID, kind: "call_priority", label: "Sahibinden ilan: sahipliği düşecek kayıtlar (yönetici)", run: (a, t, n) => runProspecting(a, t, n, evaluateFsboClaimExpiring) },
  // GİDER içgörüleri (alıcı: yönetim). Şema (20261008000700) yoksa kural "etkin değil" sayılır.
  {
    id: EXPENSE_BUDGET_RULE_ID,
    kind: "anomaly",
    label: "Gider bütçesi aşımı",
    requiredPermission: EXPENSES_VIEW,
    run: async (admin, tenantId, nowMs) => {
      // SK6/B018: Bütçe sekmesiyle TEK KAYNAK (finance_budget_vs_actual_for); fonksiyon yoksa eski v1 yükleyici.
      const ctx = (await loadBudgetContextShared(admin, tenantId, nowMs)) ?? (await loadBudgetContext(admin, tenantId, nowMs));
      if (!ctx.available) throw new InsightFactsUnavailable("expense_budgets");
      return noClose(
        evaluateExpenseBudgets(
          { monthKey: ctx.monthKey, monthStart: ctx.monthStart, monthEnd: ctx.monthEnd, rows: ctx.rows.map((r) => ({ ...r, label: budgetLabel(r.category) })) },
          nowMs,
          trNextMonthStartMs(nowMs),
        ),
      );
    },
  },
  {
    id: SUBSCRIPTION_RULE_ID,
    kind: "deadline",
    label: "Yaklaşan abonelik ve düzenli ödemeler",
    requiredPermission: EXPENSES_VIEW,
    run: async (admin, tenantId, nowMs) => {
      const [recurring, portal] = await Promise.all([loadRecurringSeries(admin, tenantId, nowMs), loadPortalRoi(admin, tenantId, nowMs)]);
      if (!recurring.available) throw new InsightFactsUnavailable("expenses.recurrence");
      return noClose(
        evaluateSubscriptions(
          {
            todayKey: recurring.todayKey,
            series: recurring.series.map((s) => ({ ...s, categoryLabel: categoryLabel(s.category) })),
            unusedPortals: portal.available ? unusedPortalSubscriptions(portal.rows) : [],
          },
          nowMs,
        ),
      );
    },
  },
  {
    id: PORTAL_ROI_RULE_ID,
    kind: "anomaly",
    label: "Portal maliyet verimliliği",
    requiredPermission: EXPENSES_VIEW,
    run: async (admin, tenantId, nowMs) => {
      const portal = await loadPortalRoi(admin, tenantId, nowMs);
      if (!portal.available) throw new InsightFactsUnavailable("expenses.portal_key");
      return noClose(evaluatePortalRoi(pickLeastEfficientPortal(portal.rows), portal.rows, nowMs));
    },
  },
];

export { buildDigestDraft, DIGEST_RULE_ID } from "@/lib/insights/rules/digest";
