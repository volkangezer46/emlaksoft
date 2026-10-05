import "server-only";

import { randomUUID } from "node:crypto";
import { logActivity } from "@/lib/activity";
import { isPast } from "@/lib/clock";
import { isEmlakFiyatiConfigured } from "@/lib/integrations/emlakfiyati/adapter";
import { ortakDegerleme, ortakRapor, ortakRaporPdf, type OrtakOutcome } from "@/lib/integrations/emlakfiyati/ortak-client";
import { getOrtakProbeOkAt, isOrtakFlagOn } from "@/lib/integrations/emlakfiyati/ortak";
import {
  ortakValuationInputSchema,
  type OrtakErrorKind,
  type OrtakValuationInput,
  type OrtakValuationOk,
  type OrtakValuationResult,
} from "@/lib/integrations/emlakfiyati/ortak-contract";
import { getPlatformSetting } from "@/lib/platform-settings";
import {
  EF_TARIFF_SETTING_KEY,
  efIdempotencyKey,
  efUnitsFor,
  parseEfTariff,
  type EfBalance,
  type EfItem,
  type EfTariff,
} from "./config";
import {
  efBalance,
  efCommit,
  efCreditReady,
  efRelease,
  efReserve,
  getEfReport,
  insertEfReport,
  listEfReports,
  markEfPdfCharged,
} from "./wallet";
import type { EfReportRow, ReportDetailResult, RunValuationResult } from "./types";

export type { EfReportRow, ReportDetailResult, RunValuationResult } from "./types";

/**
 * EF KONTÖR SERVİSİ — ada/parsel değerleme, rapor detayı ve PDF akışının TEK orkestrasyonu.
 *
 * FAIL-CLOSED: cüzdan yazılamazsa (reserve null) EmlakFiyati ÇAĞRILMAZ. Akış: tarife → rezerve → ortak çağrı →
 * (deger + ucretlendirilir:true → commit | yetersiz/hata/429/zaman aşımı/ucretlendirilir:false → release).
 * Tarife 0 ise rezerve açılmaz. `rapor_id` bir ERİŞİM ANAHTARIDIR: yalnız `ef_reports`ta BU tenant'a ait olanlar sunulur.
 * Denetim kaydı kişisel veri içermez: yalnız kalem, birim, X-Istek-Id, rapor_id, sonuç.
 * Yetki/hız sınırı çağıran katmanda (actions/ef-valuation.ts, api/app/ef-rapor): burada tenant/kullanıcı güvenilir girdidir.
 */

export type EfActor = { tenantId: string; userId: string };

// ---------------------------------------------------------------------------
// Özellik durumu ("etkin değil" kartı için eksik ön koşullar)
// ---------------------------------------------------------------------------

export type EfPrerequisites = { key: boolean; flag: boolean; probe: boolean; wallet: boolean };

export type EfFeatureState = {
  ready: boolean;
  prerequisites: EfPrerequisites;
  /** Kullanıcıya gösterilecek eksik ön koşullar (Türkçe). */
  missing: string[];
  balance: EfBalance | null;
  tariff: EfTariff;
};

async function loadTariff(): Promise<EfTariff> {
  return parseEfTariff(await getPlatformSetting(EF_TARIFF_SETTING_KEY));
}

export async function getEfFeatureState(tenantId: string): Promise<EfFeatureState> {
  const [key, flag, probeAt, wallet, tariff] = await Promise.all([
    isEmlakFiyatiConfigured(),
    isOrtakFlagOn(),
    getOrtakProbeOkAt(),
    efCreditReady(),
    loadTariff(),
  ]);
  const prerequisites: EfPrerequisites = { key, flag, probe: probeAt !== null, wallet };
  const missing: string[] = [];
  if (!key) missing.push("EmlakFiyati anahtarı tanımlı değil (yönetici: Sistem > EmlakFiyati).");
  if (!flag) missing.push("Ortak uçlar yönetici tarafından etkinleştirilmemiş.");
  if (!prerequisites.probe) missing.push("Ortak bağlantı yoklaması başarılı değil (yönetici: 'Ortak bağlantıyı dene').");
  if (!wallet) missing.push("Kontör cüzdanı henüz hazır değil (veritabanı şeması uygulanmamış).");
  const ready = key && flag && prerequisites.probe && wallet;
  const balance = ready ? await efBalance(tenantId) : null;
  return { ready: ready && balance !== null, prerequisites, missing, balance, tariff };
}

// ---------------------------------------------------------------------------
// Hata dili (kişisel veri/anahtar/URL yok)
// ---------------------------------------------------------------------------

export function efFailureMessage(kind: OrtakErrorKind, code: string | null): string {
  switch (kind) {
    case "disabled":
      return "Ada/parsel değerleme şu an etkin değil.";
    case "auth":
    case "forbidden":
      return "Değerleme servisi şu an kullanılamıyor. Kontörünüz düşülmedi; yönetici bilgilendirildi.";
    case "bad_request":
    case "invalid_input":
      if (code === "kullanici_ref_kisisel_veri" || code === "kullanici_ref_gecersiz" || code === "kullanici_ref_gerekli") {
        return "Değerleme isteği reddedildi. Kontörünüz düşülmedi; lütfen destekle iletişime geçin.";
      }
      return "Girdiler değerleme servisi tarafından kabul edilmedi (ada, parsel veya konut bilgilerini kontrol edin). Kontörünüz düşülmedi.";
    case "not_found":
      return "Rapor bulunamadı veya süresi doldu. Yeniden değerleme gerekir.";
    case "busy":
      return "İstek hâlâ işleniyor; birkaç saniye sonra tekrar deneyin. Kontörünüz düşülmedi.";
    case "too_large":
      return "İstek çok büyük. Kontörünüz düşülmedi.";
    case "rate_limited":
    case "unavailable":
    case "too_many_local":
      return "Sistem şu an yoğun. Lütfen biraz sonra tekrar deneyin. Kontörünüz düşülmedi.";
    case "pdf_failed":
      return "PDF şu an üretilemedi; rapor detayını ekranda görebilirsiniz. Kontörünüz düşülmedi.";
    case "timeout":
    case "network":
    case "server":
      return "Geçici bir hata oluştu. Kontörünüz düşülmedi (iade edildi); lütfen tekrar deneyin.";
    case "invalid_response":
      return "Servisten beklenmeyen bir yanıt geldi. Kontörünüz düşülmedi (iade edildi).";
  }
}

// ---------------------------------------------------------------------------
// Ortak yardımcılar
// ---------------------------------------------------------------------------

async function audit(a: EfActor, action: string, raporId: string | null, data: Record<string, unknown>): Promise<void> {
  await logActivity({
    tenantId: a.tenantId,
    actorId: a.userId,
    action,
    entityType: "ef_report",
    entityId: raporId,
    newValue: data,
  });
}

async function releaseSafely(tenantId: string, reservationId: string | null, reason: string): Promise<boolean> {
  if (!reservationId) return true;
  for (let i = 0; i < 2; i += 1) {
    const r = await efRelease(tenantId, reservationId, reason);
    if (r && r.ok) return true;
  }
  return false; // süpürücü (ef_credit_sweep) eski rezervi serbest bırakır
}

async function commitSafely(tenantId: string, reservationId: string, ref: Record<string, string | number | boolean | null>): Promise<boolean> {
  for (let i = 0; i < 2; i += 1) {
    const r = await efCommit(tenantId, reservationId, ref);
    if (r && r.ok) return true;
  }
  return false;
}

type Hold = { kind: "none" } | { kind: "held"; reservationId: string } | { kind: "no_credit"; available: number } | { kind: "wallet_error" };

async function holdUnits(a: EfActor, units: number, item: EfItem): Promise<Hold> {
  if (units <= 0) return { kind: "none" };
  const r = await efReserve({ tenantId: a.tenantId, userId: a.userId, units, idem: randomUUID(), item });
  if (!r) return { kind: "wallet_error" };
  if (!r.ok) return { kind: "no_credit", available: r.available };
  return { kind: "held", reservationId: r.reservation_id };
}

const WALLET_ERROR_MESSAGE = "Kontör cüzdanına şu an yazılamadı; işlem yapılmadı ve kontörünüz düşülmedi. Lütfen tekrar deneyin.";

// ---------------------------------------------------------------------------
// Ada/parsel değerleme
// ---------------------------------------------------------------------------

export async function runParcelValuation(p: EfActor & { input: OrtakValuationInput }): Promise<RunValuationResult> {
  const parsed = ortakValuationInputSchema.safeParse(p.input);
  if (!parsed.success) {
    return { status: "invalid", message: parsed.error.issues[0]?.message ?? "Girdiler geçersiz." };
  }
  const input = parsed.data;

  const state = await getEfFeatureState(p.tenantId);
  if (!state.ready) return { status: "disabled", message: "Ada/parsel değerleme şu an etkin değil.", missing: state.missing };

  const item: EfItem = input.tip === "konut" ? "valuation_konut" : "valuation_arsa";
  const units = efUnitsFor(item, state.tariff);

  const hold = await holdUnits(p, units, item);
  if (hold.kind === "wallet_error") return { status: "error", kind: "disabled", code: "wallet", message: WALLET_ERROR_MESSAGE, requestId: null, refunded: true };
  if (hold.kind === "no_credit") return { status: "no_credit", available: hold.available, needed: units };
  const reservationId = hold.kind === "held" ? hold.reservationId : null;

  // Idempotency-Key rezerv kimliğinden türer; yeniden denemelerde (adaptör döngüsü) AYNI kalır.
  const idempotencyKey = efIdempotencyKey(reservationId ?? randomUUID());
  const out = await ortakDegerleme({ tenantId: p.tenantId, userId: p.userId, idempotencyKey, input });

  if (!out.ok) {
    const refunded = await releaseSafely(p.tenantId, reservationId, `valuation_${out.kind}`);
    await audit(p, "ef.valuation", null, { item, units, outcome: "error", kind: out.kind, code: out.code, request_id: out.requestId, attempts: out.attempts, refunded, idem: idempotencyKey });
    return { status: "error", kind: out.kind, code: out.code, message: efFailureMessage(out.kind, out.code), requestId: out.requestId, refunded };
  }

  const result = out.data;
  if (result.durum === "yetersiz") {
    const refunded = await releaseSafely(p.tenantId, reservationId, "valuation_yetersiz");
    await audit(p, "ef.valuation", null, { item, units, outcome: "yetersiz", request_id: out.requestId, replayed: out.replayed, refunded, idem: idempotencyKey });
    return { status: "insufficient", result, requestId: out.requestId, refunded };
  }

  return settleValuation(p, { out, result, item, units, reservationId, idempotencyKey, input });
}

async function settleValuation(
  p: EfActor,
  c: {
    out: Extract<OrtakOutcome<OrtakValuationResult>, { ok: true }>;
    result: OrtakValuationOk;
    item: EfItem;
    units: number;
    reservationId: string | null;
    idempotencyKey: string;
    input: ReturnType<typeof ortakValuationInputSchema.parse>;
  },
): Promise<RunValuationResult> {
  const { out, result, item, units, reservationId, idempotencyKey, input } = c;
  const raporId = result.raporId as string; // ortak-client: rapor_id'siz "deger" invalid_response sayılır

  let unitsCharged = 0;
  let settlementPending = false;
  if (result.ucretlendirilir && reservationId) {
    const ok = await commitSafely(p.tenantId, reservationId, { rapor_id: raporId, request_id: out.requestId, item, idem: idempotencyKey });
    if (ok) unitsCharged = units;
    else settlementPending = true;
  } else {
    // ucretlendirilir:false → rapor üretildi ama kontör KESİLMEZ (iade).
    await releaseSafely(p.tenantId, reservationId, "valuation_ucretlendirilmedi");
  }

  // Replay: aynı rapor zaten kayıtlıysa ikinci satır/commit sayılmaz (insert idempotent; commit RPC'si idempotent).
  const insert = {
    tenantId: p.tenantId,
    userId: p.userId,
    raporId,
    reservationId,
    mahalleId: input.mahalleId,
    ada: input.ada,
    parsel: input.parsel,
    tip: result.tip ?? input.tip,
    guvenSinifi: result.guvenSinifi,
    sonucDurumu: "deger" as const,
    unitsCharged,
    expiresAt: result.expiresAt,
  };
  let stored = await insertEfReport(insert);
  if (!stored) stored = await insertEfReport(insert);

  await audit(p, "ef.valuation", raporId, {
    item,
    units,
    units_charged: unitsCharged,
    outcome: "deger",
    ucretlendirilir: result.ucretlendirilir,
    request_id: out.requestId,
    replayed: out.replayed,
    attempts: out.attempts,
    settlement_pending: settlementPending,
    report_stored: stored,
    guven: result.guvenSinifi,
    idem: idempotencyKey,
  });
  return { status: "ok", result, raporId, unitsCharged, replayed: out.replayed, requestId: out.requestId, settlementPending };
}

// ---------------------------------------------------------------------------
// Rapor erişimi (tenant sahipliği) + detay
// ---------------------------------------------------------------------------

export type OwnedReport = { ok: true; row: EfReportRow } | { ok: false; status: "not_found" | "expired" };

/** `rapor_id` ERİŞİM ANAHTARIDIR: başka tenant'ın raporu "bulunamadı" (404) gibi davranır. */
export async function getOwnedReport(tenantId: string, raporId: string): Promise<OwnedReport> {
  if (!/^[0-9a-f-]{36}$/i.test(raporId)) return { ok: false, status: "not_found" };
  const row = await getEfReport(tenantId, raporId.toLowerCase());
  if (!row) return { ok: false, status: "not_found" };
  if (row.expires_at && isPast(row.expires_at)) return { ok: false, status: "expired" };
  return { ok: true, row };
}

/** Rapor detayı (JSON). Tarife `reportDetail` (varsayılan 0) kadar kontör: 0 ise rezerve açılmaz. */
export async function getReportDetail(p: EfActor & { raporId: string }): Promise<ReportDetailResult> {
  const owned = await getOwnedReport(p.tenantId, p.raporId);
  if (!owned.ok) return { status: owned.status, message: efFailureMessage("not_found", "rapor_yok") };
  const state = await getEfFeatureState(p.tenantId);
  if (!state.ready) return { status: "disabled", message: "Ada/parsel değerleme şu an etkin değil.", missing: state.missing };

  const units = efUnitsFor("report_detail", state.tariff);
  const hold = await holdUnits(p, units, "report_detail");
  if (hold.kind === "wallet_error") return { status: "error", kind: "disabled", code: "wallet", message: WALLET_ERROR_MESSAGE, requestId: null };
  if (hold.kind === "no_credit") return { status: "no_credit", available: hold.available, needed: units };
  const reservationId = hold.kind === "held" ? hold.reservationId : null;

  const out = await ortakRapor({ tenantId: p.tenantId, userId: p.userId, raporId: owned.row.rapor_id });
  if (!out.ok) {
    await releaseSafely(p.tenantId, reservationId, `detail_${out.kind}`);
    await audit(p, "ef.report_detail", owned.row.rapor_id, { outcome: "error", kind: out.kind, code: out.code, request_id: out.requestId });
    return { status: "error", kind: out.kind, code: out.code, message: efFailureMessage(out.kind, out.code), requestId: out.requestId };
  }
  let charged = 0;
  if (reservationId) {
    const ok = await commitSafely(p.tenantId, reservationId, { rapor_id: owned.row.rapor_id, request_id: out.requestId, item: "report_detail" });
    if (ok) charged = units;
  }
  await audit(p, "ef.report_detail", owned.row.rapor_id, { outcome: "ok", units_charged: charged, request_id: out.requestId });
  return { status: "ok", result: out.data, row: owned.row, requestId: out.requestId, unitsCharged: charged };
}

// ---------------------------------------------------------------------------
// PDF (ilk indirme ücretli, tekrarlar ücretsiz)
// ---------------------------------------------------------------------------

export type ReportPdfResult =
  | { status: "ok"; bytes: Uint8Array; filename: string; unitsCharged: number; requestId: string | null }
  | { status: "not_found" | "expired"; message: string }
  | { status: "no_credit"; available: number; needed: number }
  | { status: "busy"; message: string }
  | { status: "disabled"; message: string; missing: string[] }
  | { status: "error"; kind: OrtakErrorKind; code: string | null; message: string; requestId: string | null };

/** Aynı rapor için eşzamanlı ilk-PDF indirmesi (aynı örnekte) çift ücretlendirmeyi önlemek için tek seferde işlenir. */
const pdfInflight = new Set<string>();

export async function getReportPdf(p: EfActor & { raporId: string }): Promise<ReportPdfResult> {
  const owned = await getOwnedReport(p.tenantId, p.raporId);
  if (!owned.ok) return { status: owned.status, message: efFailureMessage("not_found", "rapor_yok") };
  const row = owned.row;
  const state = await getEfFeatureState(p.tenantId);
  if (!state.ready) return { status: "disabled", message: "Ada/parsel değerleme şu an etkin değil.", missing: state.missing };

  const lockKey = `${p.tenantId}:${row.rapor_id}`;
  if (pdfInflight.has(lockKey)) return { status: "busy", message: "Bu raporun PDF'i hazırlanıyor; birkaç saniye sonra tekrar deneyin." };
  pdfInflight.add(lockKey);
  try {
    // pdf_charged → UCRETSİZ yeniden indirme. Değilse tarife pdfFirst kadar rezerve.
    const units = row.pdf_charged ? 0 : efUnitsFor("pdf_first", state.tariff);
    const hold = await holdUnits(p, units, "pdf_first");
    if (hold.kind === "wallet_error") return { status: "error", kind: "disabled", code: "wallet", message: WALLET_ERROR_MESSAGE, requestId: null };
    if (hold.kind === "no_credit") return { status: "no_credit", available: hold.available, needed: units };
    const reservationId = hold.kind === "held" ? hold.reservationId : null;

    const out = await ortakRaporPdf({ tenantId: p.tenantId, userId: p.userId, raporId: row.rapor_id });
    if (!out.ok) {
      await releaseSafely(p.tenantId, reservationId, `pdf_${out.kind}`);
      await audit(p, "ef.report_pdf", row.rapor_id, { outcome: "error", kind: out.kind, code: out.code, request_id: out.requestId, attempts: out.attempts });
      return { status: "error", kind: out.kind, code: out.code, message: efFailureMessage(out.kind, out.code), requestId: out.requestId };
    }

    let charged = 0;
    if (reservationId) {
      const ok = await commitSafely(p.tenantId, reservationId, { rapor_id: row.rapor_id, request_id: out.requestId, item: "pdf_first" });
      if (ok) {
        charged = units;
        await markEfPdfCharged(p.tenantId, row.rapor_id, reservationId);
      }
    }
    await audit(p, "ef.report_pdf", row.rapor_id, { outcome: "ok", units_charged: charged, repeat: row.pdf_charged, request_id: out.requestId, size: out.data.bytes.byteLength });
    return { status: "ok", bytes: out.data.bytes, filename: `degerleme-raporu-${row.rapor_id.slice(0, 8)}.pdf`, unitsCharged: charged, requestId: out.requestId };
  } finally {
    pdfInflight.delete(lockKey);
  }
}

// ---------------------------------------------------------------------------
// Liste
// ---------------------------------------------------------------------------

/** Geçmiş raporlar (tenant kapsamlı). Tablo yoksa null (arayüz "etkin değil"). */
export async function listTenantReports(tenantId: string, limit = 30): Promise<EfReportRow[] | null> {
  return listEfReports(tenantId, limit);
}
