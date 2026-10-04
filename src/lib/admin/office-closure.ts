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

/** Arşivlenmiş ofisin sahibi, yalnız bu durumdaki talepler varken veri paketini indirebilir. */
export function closureDownloadAllowed(tenantStatus: string | null | undefined, requestStatuses: string[]): boolean {
  return tenantStatus === "cancelled" && requestStatuses.some((s) => s !== "rejected");
}
