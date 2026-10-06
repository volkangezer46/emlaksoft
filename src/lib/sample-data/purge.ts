import type { SupabaseClient } from "@supabase/supabase-js";
import { now } from "@/lib/clock";
import { deleteSampleRecords, type SampleClearReport } from "@/lib/sample-clear";

/**
 * "Gerçek kullanıma geç" — örnek verileri kalıcı silme, TEK giriş noktası (sunucu).
 *
 * Yol 1 (tercih): `purge_tenant_sample_data(p_tenant_id)` RPC'si (migration 20261006000600). Kullanıcının KENDİ
 * oturum istemcisiyle çağrılır; yetki (owner/gm + aynı ofis) RPC'nin içinde doğrulanır, silme tek transaction'dır.
 * Yol 2 (RPC yoksa — migration henüz uygulanmadı): eski tablo-tablo silme (`deleteSampleRecords`, service_role);
 * çağıran `fallbackAdmin` verir. İki yol da yalnız `is_sample = true` + `tenant_id` satırlarına dokunur.
 */

export const PURGE_RPC = "purge_tenant_sample_data";

type RpcError = { code?: string; message?: string } | null | undefined;

/** PostgREST "fonksiyon yok" (PGRST202) ya da Postgres 42883: RPC migration'ı uygulanmamış. */
export function isRpcMissing(error: RpcError): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = String(error.message ?? "").toLowerCase();
  return code === "PGRST202" || code === "42883" || (msg.includes("function") && msg.includes("not"));
}

/** RPC'nin jsonb dönüşü → rapor. `deleted` sayıları tablo başına gelir. */
export function reportFromRpc(payload: unknown): SampleClearReport {
  const deletedRaw = (payload as { deleted?: Record<string, unknown> } | null)?.deleted ?? {};
  const deleted: Record<string, number> = {};
  let total = 0;
  for (const [table, n] of Object.entries(deletedRaw)) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) continue;
    deleted[table] = v;
    total += v;
  }
  return { deleted, unavailable: [], failed: [], totalDeleted: total, complete: true };
}

export type PurgeResult = { ok: true; via: "rpc" | "fallback"; report: SampleClearReport } | { ok: false; error: string; report?: SampleClearReport };

type RpcClient = Pick<SupabaseClient, "rpc">;

export async function purgeSampleData(input: {
  /** Oturumlu kullanıcı istemcisi (RLS/JWT): RPC yetkiyi içeride doğrular. */
  session: RpcClient;
  tenantId: string;
  /** RPC yoksa kullanılacak service_role istemcisi (çağıran kapıdan çıkarmış olmalı). */
  fallbackAdmin: SupabaseClient;
}): Promise<PurgeResult> {
  const { data, error } = await input.session.rpc(PURGE_RPC, { p_tenant_id: input.tenantId });
  if (!error) return { ok: true, via: "rpc", report: reportFromRpc(data) };
  if (!isRpcMissing(error)) {
    console.error("purgeSampleData rpc", error);
    return {
      ok: false,
      error:
        String(error.code) === "42501"
          ? "Bu işlem yalnız ofis sahibi veya genel müdür tarafından yapılabilir."
          : "Örnek veriler temizlenemedi. Lütfen tekrar deneyin.",
    };
  }

  // Eski yol: tablo tablo, kısmi hatayı raporlar; damga yalnız tam temizlikte sıfırlanır.
  const report = await deleteSampleRecords(input.fallbackAdmin, input.tenantId);
  if (report.complete) {
    const { error: markErr } = await input.fallbackAdmin.from("tenants").update({ sample_seeded_at: null }).eq("id", input.tenantId);
    if (markErr) {
      console.error("purgeSampleData mark", markErr);
      return { ok: false, error: "Örnek veriler silindi ancak ofis işareti güncellenemedi. Sayfayı yenileyip tekrar deneyin.", report };
    }
    await input.fallbackAdmin
      .from("tenants")
      .update({ sample_pack: null, sample_cleared_at: new Date(now()).toISOString() })
      .eq("id", input.tenantId);
    return { ok: true, via: "fallback", report };
  }
  return {
    ok: false,
    error: `Temizlik yarım kaldı (${report.failed.map((f) => f.label).join(", ")}). Silinenler geri gelmez; tekrar deneyebilirsiniz.`,
    report,
  };
}
