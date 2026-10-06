import { now } from "@/lib/clock";

/**
 * "RPC henüz yok" yoklaması (süreç içi, 60 sn).
 *
 * Kod, migration'dan ÖNCE yayınlanabilir: yeni RPC (ör. `app_shell_bootstrap`) canlı DB'de yoksa PostgREST
 * PGRST202 / 42883 döner ve kod eski yola düşer. Bu düşüşü her gezintide bir kez daha denemek boşa bir ağ turu
 * demektir; fonksiyonun eksik olduğu öğrenilince aynı süreçte 60 sn boyunca RPC hiç çağrılmaz (ef_credit_ready
 * yoklamasıyla aynı desen). Süre dolunca yeniden denenir: migration uygulanır uygulanmaz en geç 1 dk içinde
 * hızlı yol devreye girer. Diğer hatalar (yetki, zaman aşımı) yoklamayı DEĞİŞTİRMEZ — geçici hata kalıcı sayılmaz.
 */
export type RpcProbeState = { missingUntil: number } | null;

export const RPC_MISSING_TTL_MS = 60_000;

type RpcError = { code?: string | null; message?: string | null } | null | undefined;

/** PostgREST/Postgres "fonksiyon yok" hatası mı? (migration henüz uygulanmamış) */
export function isMissingFunctionError(error: RpcError): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "PGRST202" || code === "42883") return true;
  const msg = (error.message ?? "").toLowerCase();
  return msg.includes("could not find the function") || (msg.includes("function") && msg.includes("does not exist"));
}

export function shouldSkipRpc(state: RpcProbeState, nowMs: number): boolean {
  return state !== null && state.missingUntil > nowMs;
}

/** Çağrı sonucundan yeni yoklama durumu: fonksiyon yoksa TTL kadar atla; yoksa (başarı/geçici hata) temiz. */
export function nextProbeState(error: RpcError, nowMs: number, ttlMs: number = RPC_MISSING_TTL_MS): RpcProbeState {
  return isMissingFunctionError(error) ? { missingUntil: nowMs + ttlMs } : null;
}

const registry = new Map<string, RpcProbeState>();

export function rpcKnownMissing(name: string, nowMs: number = now()): boolean {
  return shouldSkipRpc(registry.get(name) ?? null, nowMs);
}

export function recordRpcOutcome(name: string, error: RpcError, nowMs: number = now()): void {
  registry.set(name, nextProbeState(error, nowMs));
}

/** Test yardımcısı. */
export function resetRpcProbes(): void {
  registry.clear();
}
