import "server-only";
import { now } from "@/lib/clock";
import { getTenantUsage } from "@/lib/ai/credits/usage";
import type { QuotaView } from "@/lib/ai/credits/aggregate";

/**
 * Otomatik (kullanıcı tıklamadan tetiklenen) LLM çağrıları için KOTA KAPISI.
 *
 * Kullanıcı tıklamalı çağrılar eski "nazik" davranışta kalır (aşım çağrıyı engellemez, ürün kararı).
 * Otomatik çağrıda ise kota dolduysa LLM HİÇ çağrılmaz; çağıran kural tabanlı metne düşer.
 * Okuma `getTenantUsage` (allowlist'li, mevcut) üzerinden yapılır; yeni service_role kullanımı yoktur.
 */

const GATE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { open: boolean; at: number }>();

/** Saf karar: kota doluysa (veya 0/negatif tanımlıysa) otomatik çağrı KAPALI. Sınırsız kota = açık. */
export function decideAutoCall(view: Pick<QuotaView, "quota" | "state">): boolean {
  if (view.quota !== null && view.quota <= 0) return false;
  return view.state !== "over";
}

/**
 * Tenant'ın otomatik AI çağrısı yapmaya hakkı var mı. Okuma hatasında KAPALI döner
 * (otomatik harcama için fail-closed; kart kural metniyle zaten görünür).
 */
export async function canAutoCallAi(tenantId: string): Promise<boolean> {
  const t = now();
  const hit = cache.get(tenantId);
  if (hit && t - hit.at < GATE_TTL_MS) return hit.open;
  let open = false;
  try {
    const usage = await getTenantUsage(tenantId);
    open = decideAutoCall(usage.ai);
  } catch {
    open = false;
  }
  cache.set(tenantId, { open, at: t });
  return open;
}

export function resetAutoCallGateCache(): void {
  cache.clear();
}
