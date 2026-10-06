import { CONTROL_BASE, districtListHref, kpiHref, type SummaryNumbers, type TypeCounts } from "./helpers";

/**
 * "OFİS SAHİBİNİN 12 SORUSU" (SAF; DB/React yok, testli). Her soru GERÇEK bir sayıdan cevaplanır ve tıklanınca o sayıyı
 * üreten filtreli listeye gider (sıfır çıkmaz metrik). Veri yoksa cevap "veri yok" der; sahte sayı üretilmez.
 * Kaynaklar: KPI özeti (property_control_state k_* bayrakları), açık uyarı sayıları (tür bazlı), son 24 saat değişimleri,
 * danışman kırılımı, süresi geçen uyarıların danışmanları, ilçe kırılımı.
 */

export type OwnerQuestion = {
  key: string;
  question: string;
  answer: string;
  value: number | null;
  href: string;
  tone: "neutral" | "success" | "warn" | "danger";
};

export type OwnerQuestionInput = {
  summary: SummaryNumbers;
  counts: TypeCounts;
  changes: { anomalies_opened: number; anomalies_closed: number; newly_missing: number } | null;
  worstAdvisor: { id: string; name: string; issues: number; active: number } | null;
  overdueAdvisors: readonly { id: string; name: string; count: number }[];
  riskDistrict: { id: string | null; name: string; missing: number; inReview: number } | null;
};

const n = (v: number | undefined) => v ?? 0;
const tone = (v: number, bad: "warn" | "danger" = "warn"): OwnerQuestion["tone"] => (v > 0 ? bad : "success");

export function buildOwnerQuestions(i: OwnerQuestionInput): OwnerQuestion[] {
  const s = i.summary;
  const missingUnhandled = n(i.counts.portal_missing);
  const authority = n(i.counts.authority_expiring);
  const lostDeal = n(i.counts.potential_lost_deal) + n(i.counts.sold_still_listed);
  const anomalies = `${CONTROL_BASE}/anomaliler`;
  const q: OwnerQuestion[] = [
    { key: "total", question: "Kaç aktif portföyüm var?", answer: `${s.total_active} aktif portföy`, value: s.total_active, href: kpiHref("active"), tone: "neutral" },
    {
      key: "published",
      question: "Kaçı portallarda yayında?",
      answer: s.total_active > 0 ? `${s.in_portals} / ${s.total_active} yayında` : "Aktif portföy yok",
      value: s.in_portals,
      href: kpiHref("in_portals"),
      tone: "neutral",
    },
    {
      key: "awaiting",
      question: "Danışmana verilmiş ama yayınlanmamış kaç portföy var?",
      answer: s.awaiting_publish > 0 ? `${s.awaiting_publish} portföy yayın bekliyor` : "Yayın bekleyen yok",
      value: s.awaiting_publish,
      href: kpiHref("awaiting_publish"),
      tone: tone(s.awaiting_publish),
    },
    {
      key: "missing",
      question: "Portaldan kaybolan kaç ilan var?",
      answer: s.portal_missing > 0 ? `${s.portal_missing} portföyde portal ilanı kayıp` : "Kaybolan ilan yok",
      value: s.portal_missing,
      href: kpiHref("portal_missing"),
      tone: tone(s.portal_missing, "danger"),
    },
    {
      key: "no_crm",
      question: "Kaybolan ama CRM'de işlem yapılmamış kaç ilan var?",
      answer: missingUnhandled > 0 ? `${missingUnhandled} kayıp uyarısı açıklama bekliyor` : "Açıklama bekleyen kayıp yok",
      value: missingUnhandled,
      href: `${anomalies}?tur=portal_missing`,
      tone: tone(missingUnhandled, "danger"),
    },
    i.worstAdvisor
      ? {
          key: "advisor",
          question: "Hangi danışmanda sorun birikiyor?",
          answer: `${i.worstAdvisor.name}: ${i.worstAdvisor.issues} sorunlu / ${i.worstAdvisor.active} portföy`,
          value: i.worstAdvisor.issues,
          href: `${anomalies}?danisman=${encodeURIComponent(i.worstAdvisor.id)}`,
          tone: "warn",
        }
      : {
          key: "advisor",
          question: "Hangi danışmanda sorun birikiyor?",
          answer: "Karşılaştırılacak sorunlu danışman yok",
          value: null,
          href: `${CONTROL_BASE}?gruplama=danisman`,
          tone: "success",
        },
    {
      key: "price",
      question: "Fiyatı portalda farklı görünen kaç portföy var?",
      answer: s.price_mismatch > 0 ? `${s.price_mismatch} fiyat uyuşmazlığı` : "Fiyat uyuşmazlığı yok",
      value: s.price_mismatch,
      href: kpiHref("price_mismatch"),
      tone: tone(s.price_mismatch),
    },
    {
      key: "authority",
      question: "Yetkisi bitmiş ya da bitmek üzere olan kaç portföy var?",
      answer: authority > 0 ? `${authority} yetki uyarısı` : "Yetki uyarısı yok",
      value: authority,
      href: `${anomalies}?tur=authority_expiring`,
      tone: tone(authority),
    },
    {
      key: "unrecorded",
      question: "Satılmış/kiralanmış olabilir ama sisteme girilmemiş kaç portföy var?",
      answer: lostDeal > 0 ? `${lostDeal} olası işlem girilmemiş` : "Girilmemiş işlem şüphesi yok",
      value: lostDeal,
      href: `${anomalies}?tur=potential_lost_deal`,
      tone: tone(lostDeal, "danger"),
    },
    i.changes
      ? {
          key: "yesterday",
          question: "Dün ne değişti?",
          answer: `${i.changes.anomalies_opened} yeni sorun · ${i.changes.newly_missing} yeni kayıp · ${i.changes.anomalies_closed} çözüldü`,
          value: i.changes.anomalies_opened,
          href: `${CONTROL_BASE}/rapor`,
          tone: tone(i.changes.newly_missing, "danger"),
        }
      : { key: "yesterday", question: "Dün ne değişti?", answer: "Değişim verisi yok", value: null, href: `${CONTROL_BASE}/rapor`, tone: "neutral" },
    i.overdueAdvisors.length > 0
      ? {
          key: "warn_today",
          question: "Bugün kimi uyarmalıyım?",
          answer: i.overdueAdvisors
            .slice(0, 3)
            .map((a) => `${a.name} (${a.count})`)
            .join(", "),
          value: i.overdueAdvisors.reduce((sum, a) => sum + a.count, 0),
          href: `${anomalies}?danisman=${encodeURIComponent(i.overdueAdvisors[0].id)}`,
          tone: "danger",
        }
      : { key: "warn_today", question: "Bugün kimi uyarmalıyım?", answer: "Süresi geçen uyarı yok", value: 0, href: anomalies, tone: "success" },
    i.riskDistrict && i.riskDistrict.missing + i.riskDistrict.inReview > 0
      ? {
          key: "risk_where",
          question: "Kayıp riski nerede toplanıyor?",
          answer: `${i.riskDistrict.name}: ${i.riskDistrict.missing} kayıp · ${i.riskDistrict.inReview} inceleme`,
          value: i.riskDistrict.missing + i.riskDistrict.inReview,
          href: districtListHref(i.riskDistrict.missing > 0 ? "portal_missing" : "in_review", i.riskDistrict.id),
          tone: "danger",
        }
      : { key: "risk_where", question: "Kayıp riski nerede toplanıyor?", answer: "Riskin toplandığı bölge yok", value: 0, href: `${CONTROL_BASE}#bolge`, tone: "success" },
  ];
  return q;
}

/** İlçe satırlarından risk bölgesi: kayıp + inceleme en yüksek olan (eşitlikte aktif portföyü çok olan). */
export function pickRiskDistrict(
  rows: readonly { district_id: string | null; district_name: string | null; portal_missing: number; in_review: number; total_active: number }[],
): OwnerQuestionInput["riskDistrict"] {
  const sorted = [...rows].sort((a, b) => b.portal_missing + b.in_review - (a.portal_missing + a.in_review) || b.total_active - a.total_active);
  const top = sorted[0];
  if (!top) return null;
  return { id: top.district_id, name: top.district_name ?? "İlçesi girilmemiş", missing: top.portal_missing, inReview: top.in_review };
}
