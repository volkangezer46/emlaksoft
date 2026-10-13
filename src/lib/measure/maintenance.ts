import { createAdminClient } from "@/lib/supabase/admin";
import { flushMeasureBuffer } from "./buffer";

export type MaintenanceResult = {
  flushed: { pv: number; wv: number };
  pruned: { pv: number; wv: number } | null;
  /** Tampon boşaltma geçici hatası (1) — sayaçlar tamponda kalır, bir sonraki turda yeniden denenir. */
  failed: number;
  detail: string;
};

/**
 * `olcum-bakim` cron'unun işi: önce bu süreçteki tampon boşaltılır (budamadan önce bugünün sayacı yazılsın),
 * sonra `analytics_prune` çalışır. RPC yoksa (migration bekliyor) budama atlanır, iş başarısız sayılmaz.
 * Diğer DB hataları fırlatılır (cron "error" heartbeat'i yazar).
 */
export async function runMeasureMaintenance(): Promise<MaintenanceResult> {
  const f = await flushMeasureBuffer();
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("analytics_prune", { p_pageview_days: 400, p_vitals_days: 90 });
  const flushed = { pv: f.pv, wv: f.wv };
  const failed = f.reason === "error" ? 1 : 0;
  const note = failed ? "; tampon yazılamadı (yeniden denenecek)" : "";
  if (error) {
    if (error.code === "42883" || error.code === "PGRST202" || error.code === "42P01") {
      return { flushed, pruned: null, failed: 0, detail: "ölçüm tabloları henüz kurulmamış; budama atlandı" };
    }
    throw new Error(error.message);
  }
  const d = (data ?? {}) as { pv?: number; wv?: number };
  const pruned = { pv: Number(d.pv ?? 0), wv: Number(d.wv ?? 0) };
  return { flushed, pruned, failed, detail: `tampon ${flushed.pv}+${flushed.wv} anahtar; budanan ${pruned.pv} sayaç, ${pruned.wv} hız satırı${note}` };
}
