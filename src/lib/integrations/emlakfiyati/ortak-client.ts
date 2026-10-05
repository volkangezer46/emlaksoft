import "server-only";

import { z } from "zod";
import { now } from "@/lib/clock";
import { setPlatformSetting } from "@/lib/platform-settings";
import { ortakCall, ortakReferenceGet, type OrtakRaw } from "./adapter";
import { EF_SETTING } from "./keys";
import { makeOrtakUserRef, ortakGate } from "./ortak";
import {
  buildOrtakValuationBody,
  isOrtakReportId,
  ortakValuationInputSchema,
  parseOrtakValuation,
  summarizeOrtakUsage,
  type OrtakErrorKind,
  type OrtakUsageSummary,
  type OrtakValuationInput,
  type OrtakValuationResult,
} from "./ortak-contract";
import { isValidIdempotencyKey } from "./policy";

/**
 * EmlakFiyati ORTAK API v1 istemcisi (YALNIZ adapter.ts üzerinden ağa çıkar). Hiçbir işlev FIRLATMAZ: `{ ok:false, kind, code }`.
 * Her sonuçta `requestId` (X-Istek-Id) döner ve kişisel veri içermeden denetim/hata kaydına yazılabilir.
 * Anahtarlı çağrılar KAPI arkasındadır: admin bayrağı AÇIK + son ortak yoklaması başarılı (ortak.ts).
 */

export type OrtakOutcome<T> =
  | { ok: true; data: T; requestId: string | null; replayed: boolean; attempts: number }
  | {
      ok: false;
      kind: OrtakErrorKind;
      /** Makine kodu (kapsam_yok, rapor_yok, flag_off, probe_missing ...); hata METNİ yok. */
      code: string | null;
      status?: number;
      requestId: string | null;
      retryAfterSec: number | null;
      attempts: number;
    };

function fail<T>(kind: OrtakErrorKind, code: string | null, extra?: Partial<{ requestId: string | null; status: number; retryAfterSec: number | null; attempts: number }>): OrtakOutcome<T> {
  return { ok: false, kind, code, requestId: extra?.requestId ?? null, ...(extra?.status !== undefined ? { status: extra.status } : {}), retryAfterSec: extra?.retryAfterSec ?? null, attempts: extra?.attempts ?? 0 };
}

function failFrom<T>(raw: Extract<OrtakRaw, { ok: false }>): OrtakOutcome<T> {
  return fail(raw.kind, raw.code, { requestId: raw.requestId, status: raw.status, retryAfterSec: raw.retryAfterSec, attempts: raw.attempts });
}

async function gated(): Promise<{ ok: true } | { ok: false; code: string }> {
  const gate = await ortakGate();
  return gate.enabled ? { ok: true } : { ok: false, code: gate.reason };
}

export type OrtakActor = { tenantId: string; userId: string };

function refOf(actor: OrtakActor): string | null {
  return makeOrtakUserRef(actor.tenantId, actor.userId);
}

// --- Değerleme ------------------------------------------------------------------------------------------------------------

/**
 * POST /api/ortak/v1/degerleme. `idempotencyKey` ZORUNLU ve yeniden denemelerde AYNI kalır (bu işlev değiştirmez).
 * Başarı: `deger` (ucretlendirilir true/false) veya `yetersiz` (HATA DEĞİL; ücretlendirilmez). `replayed` = Idempotency-Replayed.
 */
export async function ortakDegerleme(p: OrtakActor & { idempotencyKey: string; input: OrtakValuationInput }): Promise<OrtakOutcome<OrtakValuationResult>> {
  const g = await gated();
  if (!g.ok) return fail("disabled", g.code);
  const userRef = refOf(p);
  if (!userRef) return fail("disabled", "kullanici_ref_uretilemedi");
  if (!isValidIdempotencyKey(p.idempotencyKey)) return fail("bad_request", "gecersiz_istek_anahtari");
  const parsed = ortakValuationInputSchema.safeParse(p.input);
  if (!parsed.success) return fail("invalid_input", "gecersiz_girdi_yerel");
  const body = buildOrtakValuationBody(parsed.data);
  if (body === null) return fail("too_large", "govde_cok_buyuk");

  const raw = await ortakCall({
    method: "POST",
    path: "/api/ortak/v1/degerleme",
    body,
    userRef,
    idempotencyKey: p.idempotencyKey,
    lane: "value",
    expect: "json",
  });
  if (!raw.ok) return failFrom(raw);
  const result = parseOrtakValuation(raw.json);
  if (!result.ok) return fail("invalid_response", null, { requestId: raw.requestId, status: raw.status, attempts: raw.attempts });
  // Ücretlendirilen değerlemede rapor_id olmadan kontör kesinleştirilemez/izlenemez.
  if (result.value.durum === "deger" && !result.value.raporId) {
    return fail("invalid_response", "rapor_id_yok", { requestId: raw.requestId, status: raw.status, attempts: raw.attempts });
  }
  return { ok: true, data: result.value, requestId: raw.requestId, replayed: raw.replayed, attempts: raw.attempts };
}

// --- Rapor detayı (JSON) ---------------------------------------------------------------------------------------------------

/** GET /api/ortak/v1/rapor/{id}: K10 maskeli kayıtlı özet (birim tutarı HER ZAMAN 0). 404 rapor_yok = yok/süresi doldu/başkasının. */
export async function ortakRapor(p: OrtakActor & { raporId: string }): Promise<OrtakOutcome<OrtakValuationResult>> {
  const g = await gated();
  if (!g.ok) return fail("disabled", g.code);
  const userRef = refOf(p);
  if (!userRef) return fail("disabled", "kullanici_ref_uretilemedi");
  if (!isOrtakReportId(p.raporId)) return fail("not_found", "rapor_yok");
  const raw = await ortakCall({ method: "GET", path: `/api/ortak/v1/rapor/${p.raporId.toLowerCase()}`, userRef, lane: "other", expect: "json" });
  if (!raw.ok) return failFrom(raw);
  const result = parseOrtakValuation(raw.json);
  if (!result.ok) return fail("invalid_response", null, { requestId: raw.requestId, status: raw.status, attempts: raw.attempts });
  return { ok: true, data: result.value, requestId: raw.requestId, replayed: false, attempts: raw.attempts };
}

// --- PDF ---------------------------------------------------------------------------------------------------------------------

/** GET /api/ortak/v1/rapor/{id}.pdf: ikili yanıt (en çok 15 MB, %PDF- doğrulanır). ÖNBELLEK YOK. */
export async function ortakRaporPdf(p: OrtakActor & { raporId: string }): Promise<OrtakOutcome<{ bytes: Uint8Array }>> {
  const g = await gated();
  if (!g.ok) return fail("disabled", g.code);
  const userRef = refOf(p);
  if (!userRef) return fail("disabled", "kullanici_ref_uretilemedi");
  if (!isOrtakReportId(p.raporId)) return fail("not_found", "rapor_yok");
  const raw = await ortakCall({ method: "GET", path: `/api/ortak/v1/rapor/${p.raporId.toLowerCase()}.pdf`, userRef, lane: "pdf", expect: "pdf" });
  if (!raw.ok) return failFrom(raw);
  if (!raw.bytes) return fail("invalid_response", null, { requestId: raw.requestId, status: raw.status, attempts: raw.attempts });
  return { ok: true, data: { bytes: raw.bytes }, requestId: raw.requestId, replayed: false, attempts: raw.attempts };
}

// --- Kullanım / yoklama ---------------------------------------------------------------------------------------------------

/** GET /api/ortak/v1/kullanim (kapılı; `X-Ortak-Kullanici-Ref` isteğe bağlı). Mutabakat için. */
export async function ortakKullanim(p?: Partial<OrtakActor>): Promise<OrtakOutcome<OrtakUsageSummary>> {
  const g = await gated();
  if (!g.ok) return fail("disabled", g.code);
  const userRef = p?.tenantId && p.userId ? (refOf({ tenantId: p.tenantId, userId: p.userId }) ?? undefined) : undefined;
  const raw = await ortakCall({ method: "GET", path: "/api/ortak/v1/kullanim", userRef, lane: "other", expect: "json", timeoutMs: 30_000 });
  if (!raw.ok) return failFrom(raw);
  const summary = summarizeOrtakUsage(raw.json);
  if (!summary) return fail("invalid_response", null, { requestId: raw.requestId, status: raw.status, attempts: raw.attempts });
  return { ok: true, data: summary, requestId: raw.requestId, replayed: false, attempts: raw.attempts };
}

export type OrtakProbeState = "connected" | "auth" | "forbidden" | "rate_limited" | "server" | "network" | "disabled" | "invalid_response" | "other";
export type OrtakProbeResult = {
  state: OrtakProbeState;
  /** 403 için kapsam_yok | ortak_bagi_yok | ortak_pasif ... (yoksa null). */
  code: string | null;
  status: number | null;
  requestId: string | null;
  summary: OrtakUsageSummary | null;
};

function probeStateOf(kind: OrtakErrorKind): OrtakProbeState {
  switch (kind) {
    case "auth":
    case "forbidden":
    case "rate_limited":
    case "server":
    case "invalid_response":
    case "disabled":
      return kind;
    case "network":
    case "timeout":
      return "network";
    case "unavailable":
      return "server";
    default:
      return "other";
  }
}

/**
 * Admin "Ortak baglantiyi dene": GET /kullanim, TEK deneme, KAPISIZ (bayrak kapalıyken de çalışır), alarm/önbellek/eski anahtar YOK.
 * Başarıda `emlakfiyati_ortak_probe_ok_at` (ISO) + özet yazılır; BAŞARISIZLIKTA ikisi de silinir (ortak uçlar kendiliğinden kapanır).
 */
export async function runOrtakProbe(staffId?: string): Promise<OrtakProbeResult> {
  const raw = await ortakCall({ method: "GET", path: "/api/ortak/v1/kullanim", lane: "other", expect: "json", retries: false, probe: true, timeoutMs: 30_000 });
  if (raw.ok) {
    const summary = summarizeOrtakUsage(raw.json);
    if (summary) {
      const ok = await setPlatformSetting(EF_SETTING.ortakProbeOkAt, new Date(now()).toISOString(), staffId);
      await setPlatformSetting(EF_SETTING.ortakProbeInfo, JSON.stringify({ sinirlar: summary.sinirlar, tarifeSurum: summary.tarifeSurum, ortakAd: summary.ortakAd }), staffId);
      if (!ok) return { state: "other", code: "probe_kaydedilemedi", status: raw.status, requestId: raw.requestId, summary };
      return { state: "connected", code: null, status: raw.status, requestId: raw.requestId, summary };
    }
    await clearProbe(staffId);
    return { state: "invalid_response", code: null, status: raw.status, requestId: raw.requestId, summary: null };
  }
  await clearProbe(staffId);
  return { state: probeStateOf(raw.kind), code: raw.code, status: raw.status ?? null, requestId: raw.requestId, summary: null };
}

async function clearProbe(staffId?: string): Promise<void> {
  try {
    await setPlatformSetting(EF_SETTING.ortakProbeOkAt, null, staffId);
  } catch {
    // En iyi çaba; kapı zaten probe_missing ile kapanır.
  }
}

// --- Mahalle referansı (anahtarsız, 6 saat önbellek) -----------------------------------------------------------------------

export type EfGeoItem = { id: number; ad: string; path: string };
const geoItem = z.object({ id: z.number().int().positive(), ad: z.string().min(1), path: z.string().min(1) }).passthrough();

function geoList(key: "iller" | "ilceler" | "mahalleler") {
  return z.object({ [key]: z.array(z.unknown()) }).passthrough();
}

async function referenceList(path: "/api/musteri/iller" | "/api/musteri/ilceler" | "/api/musteri/mahalleler", key: "iller" | "ilceler" | "mahalleler", query: URLSearchParams): Promise<OrtakOutcome<EfGeoItem[]>> {
  const raw = await ortakReferenceGet(path, query);
  if (!raw.ok) return failFrom(raw);
  const shell = geoList(key).safeParse(raw.json);
  if (!shell.success) return fail("invalid_response", null, { attempts: raw.attempts });
  const rows = (shell.data[key] as unknown[]).flatMap((r) => {
    const p = geoItem.safeParse(r);
    return p.success ? [{ id: p.data.id, ad: p.data.ad, path: p.data.path }] : []; // bozuk satır atlanır
  });
  return { ok: true, data: rows, requestId: raw.requestId, replayed: false, attempts: raw.attempts };
}

export async function getEfIller(): Promise<OrtakOutcome<EfGeoItem[]>> {
  return referenceList("/api/musteri/iller", "iller", new URLSearchParams());
}

export async function getEfIlceler(ilId: number): Promise<OrtakOutcome<EfGeoItem[]>> {
  if (!Number.isInteger(ilId) || ilId <= 0) return fail("bad_request", "gecersiz_il");
  return referenceList("/api/musteri/ilceler", "ilceler", new URLSearchParams({ il_id: String(ilId) }));
}

export async function getEfMahalleler(ilceId: number): Promise<OrtakOutcome<EfGeoItem[]>> {
  if (!Number.isInteger(ilceId) || ilceId <= 0) return fail("bad_request", "gecersiz_ilce");
  return referenceList("/api/musteri/mahalleler", "mahalleler", new URLSearchParams({ ilce_id: String(ilceId) }));
}
