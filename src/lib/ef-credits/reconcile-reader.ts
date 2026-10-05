import { createClient } from "@/lib/supabase/server";
import type { EfReconcileStatus } from "@/lib/ef-credits/reconcile";

export type LatestEfReconciliation = {
  runAt: string;
  windowStart: string;
  windowEnd: string;
  status: EfReconcileStatus;
  efDegerleme: number | null;
  efPdf: number | null;
  ledgerDegerleme: number;
  ledgerPdf: number;
  diffDegerleme: number | null;
  diffPdf: number | null;
};

/**
 * Son mutabakat kaydi (salt-okunur). Oturumlu istemci + RLS: yalniz platform personeli satir gorur (service_role YOK).
 * Tablo yoksa / satir yoksa null (kart "henuz calismadi" gosterir); fırlatmaz.
 */
export async function readLatestEfReconciliation(): Promise<LatestEfReconciliation | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("ef_reconciliation_runs")
      .select("run_at, window_start, window_end, status, ef_degerleme, ef_pdf, ledger_degerleme, ledger_pdf, diff_degerleme, diff_pdf")
      .order("run_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const status = data.status === "ok" || data.status === "drift" ? data.status : "error";
    return {
      runAt: data.run_at,
      windowStart: data.window_start,
      windowEnd: data.window_end,
      status,
      efDegerleme: data.ef_degerleme,
      efPdf: data.ef_pdf,
      ledgerDegerleme: data.ledger_degerleme,
      ledgerPdf: data.ledger_pdf,
      diffDegerleme: data.diff_degerleme,
      diffPdf: data.diff_pdf,
    };
  } catch {
    return null;
  }
}
