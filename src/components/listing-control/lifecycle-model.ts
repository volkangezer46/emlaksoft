import { freshnessValue, priceConsistencyValue, type HealthInputs } from "@/lib/listing-control/health-score";
import type { ListingControlConfig } from "@/lib/listing-control/config";
import { REASON_LABELS, STAGE_LABELS, type LifecycleStage, type ReasonCode } from "@/lib/listing-control/types";
import { anomalyTypeLabel } from "./helpers";
import { eidsHealthValue } from "@/lib/eids/health";

/**
 * Portföy "Yaşam döngüsü & portal geçmişi" SAF modeli: zaman çizelgesi birleştirme, sağlık girdileri, süre ortalamaları,
 * danışman sıralaması. Veriyi çeken kısım `readers.ts`; burada DB/React yok (testli).
 */

export type TimelineKind = "created" | "assigned" | "stage" | "published" | "removed" | "id_changed" | "price" | "verified" | "missing" | "anomaly" | "explained" | "resolved";

export type TimelineEvent = { at: string; kind: TimelineKind; title: string; detail?: string };

/** Yaşam döngüsü aşama geçişi (lc_lifecycle_events). `actorSource`: user = kendisi yaptı, inferred = ilgili kayıttan çıkarıldı. */
export type StageEvent = { at: string; from: string | null; to: string; actorName: string | null; actorSource: "user" | "inferred" | "system"; reason: string | null };

/** Portal ilanı bitiş nedeni etiketleri (portal_listings.ended_reason). */
export const ENDED_REASON_LABELS: Record<string, string> = {
  id_changed: "İlan no değişti",
  sold: "Satıldı",
  rented: "Kiralandı",
  owner_withdrew: "Mal sahibi kaldırdı",
  authority_expired: "Yetki sona erdi",
  price_will_update: "Fiyat güncellenecek",
  portal_removed: "Portal kaldırdı",
  will_republish: "Yeniden yayınlanacak",
  mistake: "Yanlışlıkla kaldırıldı",
  duplicate: "Kopya ilan",
  other: "Diğer",
};

export type LifecycleSource = {
  createdAt: string | null;
  assignedAt: string | null;
  stage: { stage: string; since: string | null } | null;
  /** Varsa tek "aşama" satırı yerine bütün geçişler (kim, ne zaman, neden) gösterilir. */
  stageEvents?: StageEvent[];
  listings: {
    id: string;
    portal: string;
    externalId: string | null;
    status: string;
    publishedAt: string | null;
    removedAt: string | null;
    supersedesId: string | null;
    endedReason?: string | null;
    removalReason?: string | null;
    removedByName?: string | null;
    publishedByName?: string | null;
  }[];
  verifications: { checkedAt: string; portal: string; result: string; stateAfter: string | null }[];
  prices: { at: string; oldPrice: number | null; newPrice: number | null }[];
  anomalies: { type: string; firstSeenAt: string; explainedAt: string | null; explainedReason: string | null; resolvedAt: string | null }[];
};

const tl = (n: number) => `${new Intl.NumberFormat("tr-TR").format(Math.round(n))} ₺`;

/** Yeniden eskiye sıralı olay listesi. Tarihsiz kayıtlar alınmaz (sahte tarih yok). */
export function buildLifecycleTimeline(src: LifecycleSource): TimelineEvent[] {
  const ev: TimelineEvent[] = [];
  const add = (at: string | null | undefined, kind: TimelineKind, title: string, detail?: string) => {
    if (at && Number.isFinite(Date.parse(at))) ev.push({ at, kind, title, detail });
  };
  add(src.createdAt, "created", "Portföy oluşturuldu");
  add(src.assignedAt, "assigned", "Danışmana atandı");
  if (src.stageEvents && src.stageEvents.length > 0) {
    for (const e of src.stageEvents) {
      const to = STAGE_LABELS[e.to as LifecycleStage] ?? e.to;
      const from = e.from ? (STAGE_LABELS[e.from as LifecycleStage] ?? e.from) : null;
      const who = e.actorName
        ? e.actorSource === "inferred"
          ? `${e.actorName} (ilgili kayıttan)`
          : e.actorName
        : "Sistem tespit etti";
      add(e.at, "stage", from ? `Aşama: ${from} → ${to}` : `Aşama: ${to}`, [who, e.reason].filter(Boolean).join(" · "));
    }
  } else if (src.stage?.since) {
    const label = STAGE_LABELS[src.stage.stage as LifecycleStage];
    if (label) add(src.stage.since, "stage", `Aşama: ${label}`);
  }
  const byId = new Map(src.listings.map((l) => [l.id, l]));
  for (const l of src.listings) {
    const no = l.externalId ? ` (ilan no ${l.externalId})` : "";
    if (l.supersedesId) {
      const prev = byId.get(l.supersedesId);
      add(l.publishedAt, "id_changed", `${l.portal} ilan numarası değişti`, [`${prev?.externalId ?? "?"} → ${l.externalId ?? "?"}`, l.publishedByName].filter(Boolean).join(" · "));
    } else {
      add(l.publishedAt, "published", `${l.portal} portalında yayınlandı${no}`, l.publishedByName ?? undefined);
    }
    if (l.removedAt && l.status !== "superseded") {
      const reason = (l.endedReason ? ENDED_REASON_LABELS[l.endedReason] : null) ?? l.removalReason ?? null;
      const detail = [reason ? `Neden: ${reason}` : null, l.removedByName ? `Kaldıran: ${l.removedByName}` : null].filter(Boolean).join(" · ");
      add(l.removedAt, "removed", `${l.portal} ilanı kaldırıldı${no}`, detail || undefined);
    }
  }
  for (const p of src.prices) {
    if (p.newPrice === null) continue;
    add(p.at, "price", "Fiyat değişti", p.oldPrice !== null ? `${tl(p.oldPrice)} → ${tl(p.newPrice)}` : tl(p.newPrice));
  }
  for (const v of src.verifications) {
    if (v.result === "present" && v.stateAfter === "verified") add(v.checkedAt, "verified", `${v.portal} ilanı portalda doğrulandı`);
    else if (v.result === "absent") add(v.checkedAt, "missing", `${v.portal} ilanı portalda bulunamadı`);
  }
  for (const a of src.anomalies) {
    add(a.firstSeenAt, "anomaly", `Uyarı: ${anomalyTypeLabel(a.type)}`);
    if (a.explainedAt) add(a.explainedAt, "explained", "Danışman açıklama girdi", a.explainedReason ? REASON_LABELS[a.explainedReason as ReasonCode] ?? undefined : undefined);
    if (a.resolvedAt) add(a.resolvedAt, "resolved", `Uyarı çözüldü: ${anomalyTypeLabel(a.type)}`);
  }
  return ev.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
}

/**
 * Portföyün TOPLAM yayın süresi (gün): bütün portallardaki ilan satırlarının yayın aralıklarının BİRLEŞİMİ (aynı anda iki
 * portalda yayında olmak iki kez sayılmaz; ilan no değişimi zinciri kesintisiz sayılır). Tarihsiz satır alınmaz.
 */
export function unionPublishedDays(
  rows: readonly { publishedAt: string | null; removedAt: string | null; status: string }[],
  nowMs: number,
): { days: number; firstPublishedAt: string | null; liveNow: boolean } | null {
  const spans = rows
    .map((r) => {
      const start = r.publishedAt ? Date.parse(r.publishedAt) : Number.NaN;
      const end = r.removedAt ? Date.parse(r.removedAt) : r.status === "live" ? nowMs : Number.NaN;
      return { start, end };
    })
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end >= s.start)
    .sort((a, b) => a.start - b.start);
  if (spans.length === 0) return null;
  let total = 0;
  let curStart = spans[0].start;
  let curEnd = spans[0].end;
  for (const s of spans.slice(1)) {
    if (s.start <= curEnd) curEnd = Math.max(curEnd, s.end);
    else {
      total += curEnd - curStart;
      curStart = s.start;
      curEnd = s.end;
    }
  }
  total += curEnd - curStart;
  const first = rows.map((r) => r.publishedAt).filter((x): x is string => !!x && Number.isFinite(Date.parse(x))).sort()[0] ?? null;
  return { days: Math.round((total / 86_400_000) * 10) / 10, firstPublishedAt: first, liveNow: rows.some((r) => r.status === "live") };
}

export type HealthFacts = {
  hasAdvisor: boolean;
  listPrice: number | null;
  updatedAt: string | null;
  authorizationEnd: string | null;
  /** EİDS taşınmaz no girilmiş mi; okunamadıysa null/belirtilmez = ölçülemedi. */
  eidsNoPresent?: boolean | null;
  /** Yetki süresi 3 aydan kısa mı (EİDS kuralı). */
  authorityShort?: boolean;
  listings: { live: boolean; verified: boolean; externalId: string | null; url: string | null; portalPrice: number | null; lastSuccessAt: string | null }[];
};

/** Ölçülemeyen girdi = null (paydadan çıkar, ekranda "ölçülemedi"). Fotoğraf/iletişim ayrı kaynak: burada ölçülmez. EİDS yalnız `eidsNoPresent` verilirse ölçülür. */
export function buildHealthInputs(f: HealthFacts, nowMs: number, cfg: Pick<ListingControlConfig, "price" | "cadence">): HealthInputs {
  const live = f.listings.filter((l) => l.live);
  const anyListing = f.listings.length > 0;
  const staleMs = cfg.cadence.staleAfterHours * 3_600_000;
  const lastSuccess = live.map((l) => (l.lastSuccessAt ? Date.parse(l.lastSuccessAt) : NaN)).filter(Number.isFinite);
  const newest = lastSuccess.length ? Math.max(...lastSuccess) : null;
  const priceList = live.map((l) => l.portalPrice).filter((p): p is number => p !== null && p > 0);
  let authority: number | null = null;
  if (f.authorizationEnd && Number.isFinite(Date.parse(f.authorizationEnd))) authority = Date.parse(f.authorizationEnd) >= nowMs ? 1 : 0;
  return {
    onPortal: !anyListing ? null : live.some((l) => l.verified) ? 1 : live.length > 0 ? 0.5 : 0,
    price: priceConsistencyValue(f.listPrice, priceList, cfg.price.toleranceRatio, cfg.price.criticalRatio),
    advisor: f.hasAdvisor ? 1 : 0,
    authority,
    photos: null,
    freshness: f.updatedAt ? freshnessValue((nowMs - Date.parse(f.updatedAt)) / 86_400_000) : null,
    idUrlValid: live.length === 0 ? null : live.filter((l) => (l.externalId ?? "").trim() !== "" || (l.url ?? "").trim() !== "").length / live.length,
    contact: null,
    eids: eidsHealthValue(f.eidsNoPresent ?? null, f.authorityShort ?? false),
    checkRecency: newest === null ? null : nowMs - newest <= staleMs ? 1 : 0,
  };
}

/** Kapanış kontrol listesi için "tamam / eksik / ölçülemedi" metni. */
export function tristateLabel(v: boolean | null): "Tamam" | "Eksik" | "Ölçülemedi" {
  return v === null ? "Ölçülemedi" : v ? "Tamam" : "Eksik";
}

/** Yayına alma süresi: atama -> ilk portal yayını (saat). Negatif/eksik çiftler dışlanır. */
export function averageLeadHours(pairs: readonly { assignedAt: string | null; firstPublishedAt: string | null }[]): number | null {
  const hours: number[] = [];
  for (const p of pairs) {
    if (!p.assignedAt || !p.firstPublishedAt) continue;
    const d = (Date.parse(p.firstPublishedAt) - Date.parse(p.assignedAt)) / 3_600_000;
    if (Number.isFinite(d) && d >= 0) hours.push(d);
  }
  if (hours.length === 0) return null;
  return hours.reduce((a, b) => a + b, 0) / hours.length;
}

/** Çözülme süresi ortalaması (saat). */
export function averageResolveHours(rows: readonly { firstSeenAt: string; resolvedAt: string | null }[]): number | null {
  return averageLeadHours(rows.map((r) => ({ assignedAt: r.firstSeenAt, firstPublishedAt: r.resolvedAt })));
}

export type RankRow = { id: string | null; name: string; total_active: number; healthy: number; portal_missing: number; in_review: number };

/** En sağlıklı / en çok sorunlu danışman. En az `minActive` portföyü olanlar; tek kişi varsa karşılaştırma yapılmaz. */
export function rankAdvisors(rows: readonly RankRow[], minActive = 3): { best: RankRow | null; worst: RankRow | null } {
  const eligible = rows.filter((r) => r.id && r.total_active >= minActive);
  if (eligible.length < 2) return { best: null, worst: null };
  const ratio = (r: RankRow) => r.healthy / r.total_active;
  const issues = (r: RankRow) => (r.portal_missing + r.in_review) / r.total_active;
  const best = [...eligible].sort((a, b) => ratio(b) - ratio(a) || b.total_active - a.total_active)[0] ?? null;
  const worst = [...eligible].sort((a, b) => issues(b) - issues(a) || b.total_active - a.total_active)[0] ?? null;
  return { best, worst: worst && issues(worst) > 0 ? worst : null };
}
