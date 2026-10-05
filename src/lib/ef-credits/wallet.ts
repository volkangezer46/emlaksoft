import "server-only";

import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { EF_RPC, type EfBalance, type EfReserveResult, type EfSettleResult } from "./config";
import type { EfReportRow } from "./types";

/**
 * EF kontör CÜZDANI — RPC sarmalayıcıları + `ef_reports` erişimi. `createAdminClient` YALNIZ bu dosyada (ve service.ts'te DEĞİL).
 * FAIL-CLOSED: her işlev FIRLATMAZ; cüzdan/tablo yoksa ya da hata olursa `null`/`false` döner ve çağıran sorguyu YAPMAZ.
 * SQL (RPC'ler + `ef_reports`) canlı DB'ye henüz uygulanmamış olabilir: bu durumda `efCreditReady()` false → özellik "etkin değil".
 * Kişisel veri YAZILMAZ: yalnız kimlikler, kalem, birim, X-Istek-Id, rapor_id.
 */

const READY_RPC = "ef_credit_ready";

const balanceSchema = z.object({
  available: z.number(),
  reserved: z.number(),
  granted_total: z.number(),
  committed_total: z.number(),
});
const reserveSchema = z.union([
  z.object({
    ok: z.literal(true),
    code: z.enum(["ok", "duplicate"]),
    reservation_id: z.string().uuid(),
    state: z.enum(["reserved", "committed", "released"]),
    available: z.number(),
  }),
  z.object({ ok: z.literal(false), code: z.literal("insufficient"), available: z.number() }),
]);
const settleSchema = z.object({
  ok: z.boolean(),
  state: z.enum(["reserved", "committed", "released", "unknown"]),
  already: z.boolean(),
});

/** SQL şeması (RPC'ler + tablo) hazır mı? false/hata → özellik kapalı. */
export async function efCreditReady(): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc(READY_RPC);
    return !error && data === true;
  } catch {
    return false;
  }
}

export async function efBalance(tenantId: string): Promise<EfBalance | null> {
  try {
    const { data, error } = await createAdminClient().rpc(EF_RPC.balance, { p_tenant: tenantId });
    if (error) return null;
    const p = balanceSchema.safeParse(data);
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/** `null` = cüzdan yazılamadı (FAIL-CLOSED: çağıran sorgu YAPMAZ). */
export async function efReserve(p: { tenantId: string; userId: string; units: number; idem: string; item: string }): Promise<EfReserveResult | null> {
  try {
    const { data, error } = await createAdminClient().rpc(EF_RPC.reserve, {
      p_tenant: p.tenantId,
      p_user: p.userId,
      p_units: p.units,
      p_idem: p.idem,
      p_item: p.item,
    });
    if (error) return null;
    const r = reserveSchema.safeParse(data);
    return r.success ? (r.data as EfReserveResult) : null;
  } catch {
    return null;
  }
}

/** Yalnız reserved→committed; idempotent (`already`). Kişisel veri içermeyen `ref` (rapor_id, request_id, kalem). */
export async function efCommit(tenantId: string, reservationId: string, ref: Record<string, string | number | boolean | null>): Promise<EfSettleResult | null> {
  try {
    const { data, error } = await createAdminClient().rpc(EF_RPC.commit, { p_tenant: tenantId, p_reservation: reservationId, p_ref: ref });
    if (error) return null;
    const r = settleSchema.safeParse(data);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Yalnız reserved→released (iade); idempotent. */
export async function efRelease(tenantId: string, reservationId: string, reason: string): Promise<EfSettleResult | null> {
  try {
    const { data, error } = await createAdminClient().rpc(EF_RPC.release, { p_tenant: tenantId, p_reservation: reservationId, p_reason: reason });
    if (error) return null;
    const r = settleSchema.safeParse(data);
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// ef_reports (rapor_id bir ERİŞİM ANAHTARIDIR: her okuma tenant_id ile sınırlıdır; yazım yalnız service_role)
// ---------------------------------------------------------------------------

const REPORT_COLUMNS =
  "id, tenant_id, user_id, rapor_id, reservation_id, mahalle_id, ada, parsel, tip, guven_sinifi, sonuc_durumu, units_charged, pdf_charged, pdf_reservation_id, created_at, expires_at";

export type EfReportInsert = {
  tenantId: string;
  userId: string;
  raporId: string;
  reservationId: string | null;
  mahalleId: number;
  ada: string;
  parsel: string;
  tip: string | null;
  guvenSinifi: string | null;
  sonucDurumu: "deger" | "yetersiz";
  unitsCharged: number;
  expiresAt: string | null;
};

/** Idempotent: (tenant_id, rapor_id) tekil; çakışmada yok sayılır. */
export async function insertEfReport(r: EfReportInsert): Promise<boolean> {
  try {
    const { error } = await createAdminClient()
      .from("ef_reports")
      .upsert(
        {
          tenant_id: r.tenantId,
          user_id: r.userId,
          rapor_id: r.raporId,
          reservation_id: r.reservationId,
          mahalle_id: r.mahalleId,
          ada: r.ada,
          parsel: r.parsel,
          tip: r.tip,
          guven_sinifi: r.guvenSinifi,
          sonuc_durumu: r.sonucDurumu,
          units_charged: r.unitsCharged,
          expires_at: r.expiresAt,
        },
        { onConflict: "tenant_id,rapor_id", ignoreDuplicates: true },
      );
    return !error;
  } catch {
    return false;
  }
}

/** Rapor BU tenant'a mı ait? Başka tenant'ın rapor_id'si de `null` döner (çağıran 404 verir). */
export async function getEfReport(tenantId: string, raporId: string): Promise<EfReportRow | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("ef_reports")
      .select(REPORT_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("rapor_id", raporId)
      .maybeSingle();
    if (error || !data) return null;
    return data as unknown as EfReportRow;
  } catch {
    return null;
  }
}

export async function listEfReports(tenantId: string, limit = 30): Promise<EfReportRow[] | null> {
  try {
    const { data, error } = await createAdminClient()
      .from("ef_reports")
      .select(REPORT_COLUMNS)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return null;
    return (data ?? []) as unknown as EfReportRow[];
  } catch {
    return null;
  }
}

/** PDF ücretlendirildi işareti (yalnız henüz işaretlenmemişse). */
export async function markEfPdfCharged(tenantId: string, raporId: string, pdfReservationId: string): Promise<boolean> {
  try {
    const { error } = await createAdminClient()
      .from("ef_reports")
      .update({ pdf_charged: true, pdf_reservation_id: pdfReservationId })
      .eq("tenant_id", tenantId)
      .eq("rapor_id", raporId)
      .eq("pdf_charged", false);
    return !error;
  } catch {
    return false;
  }
}
