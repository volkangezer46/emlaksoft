import { buildDedupeKey, monthPeriod } from "@/lib/insights/dedupe";
import type { InsightDraft } from "@/lib/insights/types";
import { dayMs } from "@/lib/insights/rules/common";
import type { EidsMailSilentFact } from "@/lib/insights/eids-facts";

/**
 * Kural: eids_mail_silent@1 — ofisin EİDS alma adresine 90 gündür hiç e-posta gelmemiş VE son 90 günde 3 ya da daha fazla
 * yeni yetki elle girilmiş. Yetkiler veriliyor ama e-postası gelmiyor: posta kutusundaki iletme kuralı bozulmuş olabilir.
 * Alıcı: yönetim (owner/gm/şube müdürü). Dönemsel kural (aylık anahtar). Alma adresi hiç kurulmadıysa kart yok.
 */
export const EIDS_MAIL_SILENT_RULE_ID = "eids_mail_silent@1";
export const EIDS_MAIL_SILENT_DAYS = 90;
export const EIDS_MAIL_SILENT_MIN_MANUAL = 3;

export function evaluateEidsMailSilent(fact: EidsMailSilentFact | null, nowMs: number): InsightDraft[] {
  if (!fact) return [];
  const last = Date.parse(fact.lastReceivedAt ?? fact.addressCreatedAt);
  if (!Number.isFinite(last) || nowMs - last < dayMs(EIDS_MAIL_SILENT_DAYS)) return [];
  if (fact.manualGrants90d < EIDS_MAIL_SILENT_MIN_MANUAL) return [];
  const days = Math.floor((nowMs - last) / dayMs(1));
  return [
    {
      kind: "compliance",
      ruleId: EIDS_MAIL_SILENT_RULE_ID,
      severity: "orta",
      title: `Bakanlık e-postası ${days} gündür gelmiyor; iletme kuralını kontrol edin`,
      why: `Son ${EIDS_MAIL_SILENT_DAYS} günde ${fact.manualGrants90d} yetki elle girildi ama alma adresine hiç Bakanlık e-postası ulaşmadı. Posta kutunuzdaki iletme kuralı silinmiş ya da bozulmuş olabilir; Ayarlar > Entegrasyonlar'daki kurulum adımlarını yeniden kontrol edin.`,
      evidence: [
        { label: "Son e-posta", value: fact.lastReceivedAt ? String(fact.lastReceivedAt).slice(0, 10) : "Hiç gelmedi" },
        { label: "Elle girilen yetki (90 gün)", value: String(fact.manualGrants90d) },
      ],
      href: "/app/ayarlar/entegrasyonlar#eids",
      entityType: null,
      entityId: null,
      isForecast: false,
      confidence: null,
      dedupeKey: buildDedupeKey("eids-mail-silent", "tenant", monthPeriod(nowMs)),
      validUntilMs: nowMs + dayMs(7),
      audience: { type: "management" },
      urgencyDays: null,
      impact: 3,
    },
  ];
}
