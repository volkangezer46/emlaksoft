/**
 * Ofis kapatma / veri indirme talebi işleme kuralları (saf; sunucu action'ı ve arayüz aynı kaynağı kullanır).
 * Kalıcı silme YOKTUR: "kapatma" = ofisi arşivlemek (tenants.status = cancelled); veri korunur, geri yüklenebilir.
 */
export const CLOSURE_REQUEST_TYPES = ["account_closure", "data_export"] as const;
export type ClosureRequestType = (typeof CLOSURE_REQUEST_TYPES)[number];

export function isClosureRequestType(v: unknown): v is ClosureRequestType {
  return typeof v === "string" && (CLOSURE_REQUEST_TYPES as readonly string[]).includes(v);
}

export type ClosurePlan = {
  /** true: önce ofis arşivlenir (iptal durumu). */
  archive: boolean;
  /** Talebe yazılacak çözüm notu. */
  resolution: string;
};

/**
 * Talebe göre yapılacak işi belirler. Ofis zaten arşivdeyse yeniden arşivlenmez (idempotent:
 * arşiv başarılı ama talep güncellemesi başarısız olduysa tekrar denenebilir).
 */
export function planClosure(type: ClosureRequestType, tenantStatus: string, reason: string): ClosurePlan {
  const suffix = reason ? ` Gerekçe: ${reason}` : "";
  if (type === "data_export") {
    return {
      archive: false,
      resolution: `Veri indirme talebi işlendi; veri paketi ofis sahibine teslim edildi.${suffix}`.slice(0, 1000),
    };
  }
  return {
    archive: tenantStatus !== "cancelled",
    resolution: `Ofis arşivlendi (veri silinmedi, geri yüklenebilir); veri paketi ofis sahibine sunuldu.${suffix}`.slice(0, 1000),
  };
}

/**
 * Arşivlenmiş ofisin sahibi, YALNIZ platformun işleyip "completed" yaptığı (kapatma işlenmiş) talep varken
 * veri paketini indirebilir. open / in_progress / rejected talep indirme hakkı vermez (sahibin açtığı talep tek başına yetmez).
 */
export function closureDownloadAllowed(tenantStatus: string | null | undefined, requestStatuses: string[]): boolean {
  return tenantStatus === "cancelled" && requestStatuses.some((s) => s === "completed");
}

/**
 * Talebi acan kullanici, islem aninda HALA ofisin aktif sahibi/genel muduru mu?
 * (Talebi acan ayrildiysa/pasife alindiysa/rolu dustuyse talep islenmez: yetkisiz eski talep ofisi kapatamaz.)
 */
export function requesterMayCloseOffice(profile: { role?: string | null; is_active?: boolean | null; tenant_id?: string | null } | null | undefined, tenantId: string): boolean {
  if (!profile || profile.is_active !== true) return false;
  if (String(profile.tenant_id ?? "") !== tenantId) return false;
  return profile.role === "owner" || profile.role === "gm";
}
