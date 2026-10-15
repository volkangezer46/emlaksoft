import "server-only";
import { createHash } from "node:crypto";

/**
 * Çevrimdışı not kapsam izi: kullanıcı + ofis kimliğinin tek yönlü özeti (kişisel veri değil, geri çözülmez).
 * Notu alan oturum ile bağlantı gelince açılan oturum aynı mı, yalnız bunu karşılaştırmaya yarar.
 */
export function offlineScopeFingerprint(tenantId: string | null | undefined, userId: string | null | undefined): string | null {
  if (!tenantId || !userId) return null;
  return createHash("sha256").update(`emlaksoft-offline:${tenantId}:${userId}`).digest("hex").slice(0, 32);
}
