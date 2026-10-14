import { now } from "@/lib/clock";

/**
 * /api/health ayrıntılı modu (HEALTHCHECK_SECRET) için Supabase alt servis yoklamaları: auth (GoTrue), storage, realtime.
 *
 * Bu yoklamalar GENEL DURUMU DÜŞÜRMEZ: uygulama DB + migration + sürüm kimliğiyle "hazır" sayılır; alt servislerden biri
 * yanıt vermezse yalnız `degraded` raporlanır (uyarı için). Herkese açık yanıtta görünmezler. Her yoklama 3 sn ile
 * sınırlıdır, hiçbiri fırlatmaz; anahtar yanıtta ya da günlükte yer almaz.
 */
export type ServiceProbeName = "auth" | "storage" | "realtime";
export type ServiceProbeResult = { status: "up" | "degraded"; httpStatus: number | null; latencyMs: number };
export type ServiceProbes = {
  /** Hepsi up → "ok"; en az biri degraded → "degraded". Genel `ok`/`status` alanını etkilemez. */
  overall: "ok" | "degraded";
  auth: ServiceProbeResult;
  storage: ServiceProbeResult;
  realtime: ServiceProbeResult;
};

/** Self-hosted Supabase'te kimlik doğrulaması gerektirmeyen (apikey yeter) sağlık uçları. */
export const SERVICE_PROBE_PATHS: Record<ServiceProbeName, string> = {
  auth: "/auth/v1/health",
  storage: "/storage/v1/status",
  realtime: "/realtime/v1/api/ping",
};

const PROBE_TIMEOUT_MS = 3_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function probeOne(baseUrl: string, path: string, apiKey: string, fetchImpl: FetchLike): Promise<ServiceProbeResult> {
  const started = now();
  try {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: "GET",
      headers: { apikey: apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // Gövde okunmaz ama bağlantı bırakılsın.
    await res.body?.cancel().catch(() => undefined);
    return { status: res.ok ? "up" : "degraded", httpStatus: res.status, latencyMs: Math.max(0, now() - started) };
  } catch {
    return { status: "degraded", httpStatus: null, latencyMs: Math.max(0, now() - started) };
  }
}

export async function probeSupabaseServices(
  baseUrl: string | undefined,
  apiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<ServiceProbes> {
  const base = (baseUrl ?? "").trim().replace(/\/+$/, "");
  const key = (apiKey ?? "").trim();
  if (!base || !key) {
    const missing: ServiceProbeResult = { status: "degraded", httpStatus: null, latencyMs: 0 };
    return { overall: "degraded", auth: missing, storage: missing, realtime: missing };
  }
  const [auth, storage, realtime] = await Promise.all([
    probeOne(base, SERVICE_PROBE_PATHS.auth, key, fetchImpl),
    probeOne(base, SERVICE_PROBE_PATHS.storage, key, fetchImpl),
    probeOne(base, SERVICE_PROBE_PATHS.realtime, key, fetchImpl),
  ]);
  const overall = [auth, storage, realtime].every((r) => r.status === "up") ? "ok" : "degraded";
  return { overall, auth, storage, realtime };
}
