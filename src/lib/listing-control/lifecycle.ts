import type { ExitKind, LifecycleStage } from "./types";

/**
 * Portföy YAŞAM DÖNGÜSÜ aşaması türetimi (SAF). `properties.status` serbest metindir ve istenen aşamalar oraya
 * konamaz (ilan havuzu tasarımı da "properties.status'a DOKUNULMAZ" demişti); aşama mevcut gerçeklerden TÜRETİLİR
 * ve `property_control_state.lifecycle_stage` içinde özetlenir. Hem `live` hem `Yayında` yazımı görülür (tutarsız
 * veri), bu yüzden değerler katlanır.
 *
 * Akış: Yeni → Havuz → Danışmana atandı → Hazırlanıyor → Yayına hazır → Portalda yayında → Pazarlama → Teklif →
 * Pazarlık → Kapora → Satıldı/Kiralandı. Çıkışlar: iptal, yetki doldu, mal sahibi vazgeçti, başka emlakçıya verildi,
 * portal ilanı kaldırıldı, pasife alındı, kopya.
 */

export type LifecycleInput = {
  /** properties.status (ham). */
  status: string | null;
  deleted: boolean;
  /** Havuzda bekleyen (pending) kayıt var mı. */
  poolPending: boolean;
  assignedTo: string | null;
  /** Canlı VE kayıp olmayan portal ilanı var mı. */
  hasLiveListing: boolean;
  hasShowings: boolean;
  /** Açık teklif/pazarlık/kapora aşaması (en ileri). */
  dealStage: "offer" | "negotiation" | "deposit" | null;
  /** Kullanıcı kodlu çıkış nedeni (portfolio_closures/status geçmişi) varsa. */
  exitKind?: ExitKind | null;
  isDuplicate?: boolean;
};

export type LifecycleResult = { stage: LifecycleStage; exitKind: ExitKind | null; active: boolean };

function fold(s: string | null): string {
  return (s ?? "").trim().toLocaleLowerCase("tr-TR");
}

const PREPARING = new Set(["draft", "taslak", "pending_docs", "evrak bekliyor", "photo_needed", "fotoğraf bekliyor", "fotograf bekliyor"]);
const READY = new Set(["ready", "hazır", "hazir", "live", "yayında", "yayinda", "active", "aktif", "reserved", "rezerve"]);

export function deriveLifecycle(i: LifecycleInput): LifecycleResult {
  const s = fold(i.status);
  if (i.isDuplicate) return { stage: "exited", exitKind: "duplicate", active: false };
  if (s === "sold" || s === "satıldı" || s === "satildi") return { stage: "sold", exitKind: "sold", active: false };
  if (s === "rented" || s === "kiralandı" || s === "kiralandi") return { stage: "rented", exitKind: "rented", active: false };
  const exitFromStatus: Record<string, ExitKind> = {
    withdrawn: "owner_withdrew",
    passive: "passive",
    pasif: "passive",
    archived: "passive",
    auth_expired: "authority_expired",
    cancelled: "cancelled",
    canceled: "cancelled",
    iptal: "cancelled",
  };
  if (i.deleted) return { stage: "exited", exitKind: i.exitKind ?? "cancelled", active: false };
  const mapped = exitFromStatus[s];
  if (mapped) return { stage: "exited", exitKind: i.exitKind ?? mapped, active: false };
  if (i.exitKind) return { stage: "exited", exitKind: i.exitKind, active: false };

  if (i.hasLiveListing) {
    if (i.dealStage === "deposit") return { stage: "deposit", exitKind: null, active: true };
    if (i.dealStage === "negotiation") return { stage: "negotiation", exitKind: null, active: true };
    if (i.dealStage === "offer") return { stage: "offer", exitKind: null, active: true };
    return { stage: i.hasShowings ? "marketing" : "published", exitKind: null, active: true };
  }
  if (i.dealStage) return { stage: i.dealStage, exitKind: null, active: true };
  if (i.poolPending) return { stage: "pool", exitKind: null, active: true };
  if (!i.assignedTo) return { stage: "new", exitKind: null, active: true };
  if (PREPARING.has(s)) return { stage: "preparing", exitKind: null, active: true };
  if (READY.has(s)) return { stage: "ready", exitKind: null, active: true };
  return { stage: "assigned", exitKind: null, active: true };
}

/** Yayına hazır olup henüz ilanı olmayan aşamalar ("yayın bekleyen"). */
export function isAwaitingPublishStage(stage: LifecycleStage): boolean {
  return stage === "assigned" || stage === "preparing" || stage === "ready";
}
