import type { ProbeClassification, ProbeReply } from "./core";
import { classifyReply, isReadable } from "./extension-health";

/**
 * AYRIŞTIRICI TELEMETRİSİ (SAF, testli). Eklenti her kontrol sonucuyla birlikte yalnız SAYAÇ alanlarını bildirir: portal,
 * ayrıştırıcı sürümü, sınıf, kimliği doğrulayan katman, hata kodu, kısmi okuma. İlan no, başlık, fiyat, ilan sahibi GİTMEZ.
 * Sunucu bunları günlük sayaç olarak toplar (`lc_parser_telemetry`) ve hangi sürümün ne kadar "kontrol edilemedi" ürettiğini
 * gösterir.
 */

export const TELEMETRY_CLASSES: readonly ProbeClassification[] = ["live", "removed", "not_found", "blocked", "unknown"];
export const TELEMETRY_LAYERS = ["json_ld", "meta", "state", "pattern", "url"] as const;

export type ParserTelemetry = {
  portal: string;
  parserVersion: string;
  classification: ProbeClassification;
  layer: string | null;
  errorCode: string | null;
  partial: boolean;
};

const VERSION_RE = /^[A-Za-z0-9._@-]{1,40}$/;
const PORTAL_RE = /^[a-z0-9-]{2,40}$/;
const CODE_RE = /^[a-z0-9_]{1,40}$/;

/** Eklenti tarafı: yanıttan telemetri (sürüm yoksa null: ayrıştırıcı çalışmadı, örn. `url_not_allowed`). */
export function buildTelemetry(portal: string, reply: ProbeReply): ParserTelemetry | null {
  if (!reply.parserVersion || !VERSION_RE.test(reply.parserVersion) || !PORTAL_RE.test(portal)) return null;
  const error = reply.error ? String(reply.error).toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 40) : null;
  return {
    portal,
    parserVersion: reply.parserVersion,
    classification: classifyReply(reply),
    layer: reply.layer && (TELEMETRY_LAYERS as readonly string[]).includes(reply.layer) ? reply.layer : null,
    errorCode: error && CODE_RE.test(error) ? error : null,
    partial: reply.partial === true,
  };
}

/** Sunucu tarafı: istemciden gelen ham değeri doğrular (geçersizse null). */
export function sanitizeTelemetry(raw: unknown): ParserTelemetry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const portal = typeof o.portal === "string" ? o.portal : "";
  const parserVersion = typeof o.parserVersion === "string" ? o.parserVersion : "";
  const cls = o.classification as ProbeClassification;
  if (!PORTAL_RE.test(portal) || !VERSION_RE.test(parserVersion) || !TELEMETRY_CLASSES.includes(cls)) return null;
  const layer = typeof o.layer === "string" && (TELEMETRY_LAYERS as readonly string[]).includes(o.layer) ? o.layer : null;
  const errorCode = typeof o.errorCode === "string" && CODE_RE.test(o.errorCode) ? o.errorCode : null;
  return { portal, parserVersion, classification: cls, layer, errorCode, partial: o.partial === true };
}

export type TelemetryRow = { portal: string; parser_version: string; classification: string; layer: string; error_code: string; partial: boolean; n: number };
export type ParserVersionSummary = {
  portal: string;
  parserVersion: string;
  total: number;
  unreadable: number;
  unreadableRate: number;
  drift: number;
  partial: number;
};

/** Sunucu özeti: portal + sürüm başına toplam, okunamayan ("kontrol edilemedi") oranı, seçici kayması ve kısmi okuma. */
export function summarizeParserTelemetry(rows: readonly TelemetryRow[]): ParserVersionSummary[] {
  const map = new Map<string, ParserVersionSummary>();
  for (const r of rows) {
    const key = `${r.portal}|${r.parser_version}`;
    const s = map.get(key) ?? { portal: r.portal, parserVersion: r.parser_version, total: 0, unreadable: 0, unreadableRate: 0, drift: 0, partial: 0 };
    const n = Math.max(0, Math.floor(r.n));
    s.total += n;
    if (!isReadable(r.classification as ProbeClassification)) s.unreadable += n;
    if (r.error_code === "unexpected_structure") s.drift += n;
    if (r.partial) s.partial += n;
    map.set(key, s);
  }
  return [...map.values()]
    .map((s) => ({ ...s, unreadableRate: s.total > 0 ? s.unreadable / s.total : 0 }))
    .sort((a, b) => a.portal.localeCompare(b.portal) || b.parserVersion.localeCompare(a.parserVersion));
}
