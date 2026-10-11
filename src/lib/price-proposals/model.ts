/**
 * Fiyat revizyonu önerisi — SAF model (sunucu/istemci güvenli; veri okuma/yazma yok).
 *
 * Akış: danışman portföy detayında yeni fiyat + gerekçe önerir -> mülk sahibi portalında onaylar/reddeder/not ekler ->
 * onayda portföy fiyatı AYNI işlemde güncellenir (SQL: decide_property_price_proposal_by_token, 20261012000800).
 * Kural: emsal yoksa öneri aralığı YOK (uydurma değer yazılmaz); emsal özeti mülk sahibine yalnız anonim satırlarla gider.
 */

export type ProposalStatus = "pending" | "approved" | "rejected" | "expired";

export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  pending: "Mülk sahibi onayı bekliyor",
  approved: "Mülk sahibi onayladı",
  rejected: "Mülk sahibi reddetti",
  expired: "Süresi doldu",
};

/** Öneri ömrü (gün): SQL expires_at varsayılanıyla aynı. */
export const PROPOSAL_TTL_DAYS = 14;

export type SnapshotRow = {
  source: "won_deal" | "active_listing";
  price: number;
  sqm: number | null;
  rooms: string | null;
};

/** Emsal anlık görüntüsü: mülk sahibine gösterilebilir, başka portföyün kimliğini TAŞIMAZ (kod/başlık/id yok). */
export type ProposalSnapshot = {
  v: 1;
  confidence: "yüksek" | "orta" | "düşük";
  low: number;
  high: number;
  median: number;
  compCount: number;
  wonCount: number;
  activeCount: number;
  rows: SnapshotRow[];
  generatedAt: string;
};

export type EstimateLike = {
  estimatedValue: number | null;
  lowValue: number | null;
  highValue: number | null;
  compCount: number;
  wonCount: number;
  activeCount: number;
  confidence: "yüksek" | "orta" | "düşük" | "yetersiz";
};

export type CompRowLike = {
  source: "won_deal" | "active_listing";
  price: number;
  sqm: number | null;
  rooms: string | null;
};

const MAX_ROWS = 5;

/** Emsal yoksa (yetersiz güven, eksik uç değer) null döner -> öneri aralığı gösterilmez. */
export function buildSnapshot(estimate: EstimateLike, comps: readonly CompRowLike[], generatedAtIso: string): ProposalSnapshot | null {
  if (estimate.confidence === "yetersiz") return null;
  const { estimatedValue: median, lowValue: low, highValue: high } = estimate;
  if (!(median && median > 0) || !(low && low > 0) || !(high && high > 0) || estimate.compCount <= 0) return null;
  const rows = comps
    .filter((c) => Number.isFinite(c.price) && c.price > 0)
    .slice(0, MAX_ROWS)
    .map((c) => ({
      source: c.source,
      price: Math.round(c.price),
      sqm: c.sqm != null && Number.isFinite(c.sqm) ? Math.round(c.sqm) : null,
      rooms: c.rooms ? String(c.rooms).slice(0, 20) : null,
    }));
  return {
    v: 1,
    confidence: estimate.confidence,
    low: Math.round(low),
    high: Math.round(high),
    median: Math.round(median),
    compCount: estimate.compCount,
    wonCount: estimate.wonCount,
    activeCount: estimate.activeCount,
    rows,
    generatedAt: generatedAtIso,
  };
}

/** Veritabanından gelen jsonb'yi güvenle okur; biçim bozuksa null (kart emsalsiz gösterilir). */
export function parseSnapshot(raw: unknown): ProposalSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const low = n(o.low);
  const high = n(o.high);
  const median = n(o.median);
  const compCount = n(o.compCount);
  if (o.v !== 1 || low === null || high === null || median === null || compCount === null) return null;
  const conf = o.confidence === "yüksek" || o.confidence === "orta" || o.confidence === "düşük" ? o.confidence : null;
  if (!conf) return null;
  const rows = Array.isArray(o.rows)
    ? (o.rows as unknown[]).flatMap((r): SnapshotRow[] => {
        if (!r || typeof r !== "object") return [];
        const x = r as Record<string, unknown>;
        const price = n(x.price);
        if (price === null || (x.source !== "won_deal" && x.source !== "active_listing")) return [];
        return [{ source: x.source, price, sqm: n(x.sqm), rooms: typeof x.rooms === "string" ? x.rooms : null }];
      })
    : [];
  return {
    v: 1,
    confidence: conf,
    low,
    high,
    median,
    compCount,
    wonCount: n(o.wonCount) ?? 0,
    activeCount: n(o.activeCount) ?? 0,
    rows,
    generatedAt: typeof o.generatedAt === "string" ? o.generatedAt : "",
  };
}

/** Süresi geçmiş bekleyen öneri, SQL henüz 'expired' yazmamış olsa da süresi dolmuş sayılır. */
export function effectiveStatus(status: ProposalStatus, expiresAtMs: number, nowMs: number): ProposalStatus {
  return status === "pending" && expiresAtMs <= nowMs ? "expired" : status;
}

/** Yeni fiyat metni ("4.250.000", "4250000 TL") -> sayı; geçersizse null. Kuruş alınmaz. */
export function parsePriceInput(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits || digits.length > 13) return null;
  const n = Number(digits);
  return n > 0 ? n : null;
}

/** Yüzde değişim (yeni - eski) / eski; eski yoksa null. Bir ondalık. */
export function changePct(oldPrice: number, newPrice: number): number | null {
  if (!(oldPrice > 0)) return null;
  return Math.round(((newPrice - oldPrice) / oldPrice) * 1000) / 10;
}

/** Yeni fiyat emsal aralığının neresinde? (yalnız emsal varsa) */
export function positionInRange(price: number, snap: ProposalSnapshot | null): "alt" | "icinde" | "ust" | null {
  if (!snap) return null;
  if (price < snap.low) return "alt";
  if (price > snap.high) return "ust";
  return "icinde";
}

/** RPC / eylem kodu -> kullanıcıya gösterilen Türkçe cümle (ham hata metni asla gösterilmez). */
export function proposalMessage(code: string): { ok: boolean; text: string } {
  switch (code) {
    case "ok":
      return { ok: true, text: "Kaydedildi." };
    case "forbidden":
      return { ok: false, text: "Bu işlem için yetkiniz yok." };
    case "invalid_price":
      return { ok: false, text: "Yeni fiyatı rakamla yazın (örn. 4.250.000)." };
    case "invalid_reason":
      return { ok: false, text: "Mülk sahibine gösterilecek kısa bir gerekçe yazın." };
    case "same_price":
      return { ok: false, text: "Yeni fiyat mevcut fiyatla aynı; farklı bir tutar yazın." };
    case "no_current_price":
      return { ok: false, text: "Bu portföyün güncel liste fiyatı yok; önce fiyatı girin." };
    case "no_owner_portal":
      return { ok: false, text: "Mülk sahibine açık bir portal bağlantısı yok. Önce 'Mülk sahibi portalı' bölümünden bağlantı oluşturun." };
    case "already_pending":
      return { ok: false, text: "Zaten mülk sahibinin onayını bekleyen bir öneri var. Önce onu iptal edin ya da yanıtını bekleyin." };
    case "not_found":
      return { ok: false, text: "Kayıt bulunamadı ya da artık geçerli değil. Sayfayı yenileyin." };
    case "invalid_link":
      return { ok: false, text: "Bağlantı geçersiz veya süresi dolmuş. Danışmanınızdan yeni bağlantı isteyin." };
    case "already_decided":
      return { ok: false, text: "Bu öneriye zaten yanıt verilmiş." };
    case "expired":
      return { ok: false, text: "Bu önerinin süresi dolmuş. Danışmanınız yeni bir öneri gönderebilir." };
    case "price_changed":
      return { ok: false, text: "Bu arada portföy fiyatı değişmiş; öneri geçersiz sayıldı. Danışmanınız güncel fiyatla yeniden önerecek." };
    case "note_required":
      return { ok: false, text: "Danışmanınıza iletmek istediğiniz notu yazın." };
    case "rate_limited":
      return { ok: false, text: "Çok fazla deneme. Lütfen biraz sonra tekrar deneyin." };
    default:
      return { ok: false, text: "İşlem kaydedilemedi. Lütfen tekrar deneyin." };
  }
}
