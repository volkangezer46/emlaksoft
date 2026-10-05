"use server";

import { requirePermission } from "@/lib/require-permission";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolveGeo } from "@/lib/geo";
import { getEfIlceler, getEfIller, getEfMahalleler } from "@/lib/integrations/emlakfiyati/ortak-client";
import { type OrtakValuationInput } from "@/lib/integrations/emlakfiyati/ortak-contract";
import { getReportDetail, runParcelValuation, type ReportDetailResult, type RunValuationResult } from "@/lib/ef-credits/service";

/**
 * Ada/parsel değerleme (EmlakFiyati Ortak API) — kullanıcı eylemleri. Her action requirePermission("valuation", ...) + hız sınırı.
 * Kontör mantığı, tenant sahipliği ve denetim kaydı src/lib/ef-credits/service.ts'tedir. Kullanıcıya EmlakFiyati anahtarı/URL'si ASLA dönmez.
 */

export type EfGeoOption = { id: number; ad: string };
export type EfGeoListResult = { ok: true; items: EfGeoOption[] } | { ok: false; error: string };
export type EfGeoMatchResult = { ok: true; matched: boolean; note: string | null } | { ok: false; error: string };
export type EfRunResult = { ok: true; run: RunValuationResult } | { ok: false; error: string };
export type EfDetailResult = { ok: true; detail: ReportDetailResult } | { ok: false; error: string };

const RATE_MESSAGE = "Çok fazla istek. Lütfen birkaç dakika sonra tekrar deneyin.";

async function geoGate(): Promise<{ ok: false; error: string } | { ok: true }> {
  const gate = await requirePermission("valuation", "view");
  if (!gate.ok) return { ok: false, error: gate.error };
  const limit = await checkRateLimit(`ef-geo:${gate.userId}`, { limit: 120, windowSec: 600, failurePolicy: "deny" });
  if (!limit.allowed) return { ok: false, error: RATE_MESSAGE };
  return { ok: true };
}

function toList(out: Awaited<ReturnType<typeof getEfIller>>): EfGeoListResult {
  if (!out.ok) return { ok: false, error: "Konum listesi şu an alınamadı. Lütfen tekrar deneyin." };
  return { ok: true, items: out.data.map((i) => ({ id: i.id, ad: i.ad })) };
}

export async function efLoadIller(): Promise<EfGeoListResult> {
  const g = await geoGate();
  if (!g.ok) return g;
  return toList(await getEfIller());
}

export async function efLoadIlceler(ilId: number): Promise<EfGeoListResult> {
  const g = await geoGate();
  if (!g.ok) return g;
  return toList(await getEfIlceler(Number(ilId)));
}

export async function efLoadMahalleler(ilceId: number): Promise<EfGeoListResult> {
  const g = await geoGate();
  if (!g.ok) return g;
  return toList(await getEfMahalleler(Number(ilceId)));
}

/** EmlakFiyati seçiminin (il/ilçe/mahalle adı) Emlaksoft coğrafya merkezindeki karşılığı var mı? Eşleşmezse açık uyarı. */
export async function efCheckGeoMatch(input: { il: string; ilce: string; mahalle: string }): Promise<EfGeoMatchResult> {
  const g = await geoGate();
  if (!g.ok) return g;
  const res = await resolveGeo({
    province: String(input.il ?? "").slice(0, 80),
    district: String(input.ilce ?? "").slice(0, 80),
    neighborhood: String(input.mahalle ?? "").slice(0, 80),
  });
  if (res.status === "ok" && res.geo.neighborhoodId) return { ok: true, matched: true, note: null };
  return {
    ok: true,
    matched: false,
    note: "Bu mahalle Emlaksoft konum kayıtlarıyla eşleşmedi. Değerleme yine EmlakFiyati seçiminize göre yapılır; portföy ve bölge analizlerine bağlanmaz.",
  };
}

/** Değerlemeyi çalıştırır (kontör: rezerve → sorgu → kesinleştir/iade). Tarife 0 ise kontör düşmez. */
export async function submitParcelValuation(input: OrtakValuationInput): Promise<EfRunResult> {
  const gate = await requirePermission("valuation", "create");
  if (!gate.ok) return { ok: false, error: gate.error };
  const limit = await checkRateLimit(`ef-valuation:${gate.userId}`, { limit: 12, windowSec: 600, failurePolicy: "deny" });
  if (!limit.allowed) return { ok: false, error: RATE_MESSAGE };
  const run = await runParcelValuation({ tenantId: gate.tenantId, userId: gate.userId, input });
  return { ok: true, run };
}

/** Rapor detayı (JSON). Rapor bu ofise ait değilse "bulunamadı". */
export async function loadParcelReportDetail(raporId: string): Promise<EfDetailResult> {
  const gate = await requirePermission("valuation", "view");
  if (!gate.ok) return { ok: false, error: gate.error };
  const limit = await checkRateLimit(`ef-detail:${gate.userId}`, { limit: 60, windowSec: 600, failurePolicy: "deny" });
  if (!limit.allowed) return { ok: false, error: RATE_MESSAGE };
  const detail = await getReportDetail({ tenantId: gate.tenantId, userId: gate.userId, role: gate.role, raporId: String(raporId ?? "") });
  return { ok: true, detail };
}
