/**
 * CSP ihlal raporu ayrıştırıcı (SAF; G/Ç yok). İki biçim kabul edilir:
 *  - Eski `report-uri`: `application/csp-report`, gövde `{"csp-report": {...}}` (kebab-case alanlar).
 *  - Reporting API `report-to`: `application/reports+json`, gövde `[{type: "csp-violation", body: {...}}]` (camelCase).
 * Çıktı error_logs satırına dönüşecek KÜÇÜK ve KARARLI bir özettir: aynı ihlal her sayfa açılışında aynı mesajı üretir
 * (sürüm özetli parça adları, UUID ve uzun sayılar maskelenir), böylece tablo tek satırda sayaç artırır.
 * Tarayıcı eklentisi kaynaklı ihlaller ve başka siteden gelen raporlar atılır (ölçümü kirletmesin).
 */

export type CspViolation = {
  directive: string;
  /** "inline" | "eval" | "wasm-eval" | kaynak (origin + yol, sorgusuz) */
  blocked: string;
  documentPath: string;
  sourceFile: string | null;
  line: number | null;
  column: number | null;
  sample: string | null;
};

/** İstek başına işlenen en çok rapor (fazlası atılır). */
export const MAX_REPORTS_PER_REQUEST = 20;

const EXTENSION_RE = /^(chrome|moz|safari|safari-web|ms-browser)-extension:/i;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Rapor modu politikası (csp-report-only.ts) yalnız betik yükleme modelini ölçer: script-src (+ ondan türeyen -elem/-attr
 * ve worker-src yedeği), object-src, base-uri. Başka yönerge adı gerçek bir tarayıcı raporu olamaz; uydurma raporla
 * (uç oturumsuzdur) error_logs'ta sınırsız farklı satır açılmasın diye atılır.
 */
const KNOWN_DIRECTIVES: ReadonlySet<string> = new Set([
  "script-src",
  "script-src-elem",
  "script-src-attr",
  "worker-src",
  "object-src",
  "base-uri",
]);

type Raw = Record<string, unknown>;

const str = (v: unknown, max = 300): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);

/** Sayfa yolu: sorgu/parça atılır, UUID ve 4+ haneli sayılar maskelenir. */
export function maskPath(pathname: string): string {
  return (pathname.split(/[?#]/)[0] || "/").replace(UUID_RE, "<id>").replace(/\/\d{4,}(?=\/|$)/g, "/<n>").slice(0, 200);
}

/**
 * Betik örneği (`'report-sample'`, tarayıcı en çok 40 karakter gönderir): hangi satır içi betiğin kırılacağını ayırt eder.
 * Kişisel veri izi bırakmasın: UUID, e-posta ve 4+ haneli sayılar (telefon, TC, tutar) maskelenir.
 */
function maskSample(sample: string): string {
  return sample
    .replace(UUID_RE, "<id>")
    .replace(/[^\s"'`<>()@]+@[^\s"'`<>()@]+/g, "<e>")
    .replace(/\d{4,}/g, "<n>")
    .replace(/\s+/g, " ")
    .slice(0, 40);
}

/** URL → yalnız `origin + yol` (aynı site için yalnız yol); sürüm özetli Next parçaları sabit ada iner. */
function resourceLabel(raw: string, siteOrigin: string): string {
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/_next\/static\/chunks\/[^/]+\.(js|css)$/, "/_next/static/chunks/*.$1");
    return (u.origin === siteOrigin ? path : `${u.origin}${path}`).slice(0, 200);
  } catch {
    return raw.slice(0, 60);
  }
}

function normalizeOne(r: Raw, siteOrigin: string): CspViolation | null {
  const pick = (...keys: string[]) => {
    for (const k of keys) if (r[k] !== undefined) return r[k];
    return undefined;
  };
  const disposition = str(pick("disposition"));
  if (disposition && disposition !== "report") return null;
  const documentUrl = str(pick("document-uri", "documentURL"), 2000);
  if (!documentUrl) return null;
  let doc: URL;
  try {
    doc = new URL(documentUrl);
  } catch {
    return null;
  }
  if (doc.origin !== siteOrigin) return null;
  const directive = (str(pick("effective-directive", "effectiveDirective")) ?? str(pick("violated-directive", "violatedDirective")) ?? "")
    .split(/\s+/)[0]!
    .toLowerCase();
  if (!KNOWN_DIRECTIVES.has(directive)) return null;
  const blockedRaw = str(pick("blocked-uri", "blockedURL"), 2000) ?? "";
  const sourceRaw = str(pick("source-file", "sourceFile"), 2000);
  if (EXTENSION_RE.test(blockedRaw) || (sourceRaw && EXTENSION_RE.test(sourceRaw))) return null;
  const blocked = ["inline", "eval", "wasm-eval", "trusted-types-policy", "trusted-types-sink"].includes(blockedRaw)
    ? blockedRaw
    : blockedRaw
      ? resourceLabel(blockedRaw, siteOrigin)
      : "inline";
  const sample = str(pick("script-sample", "sample"), 80);
  // Satır içi betikte kaynak belgenin kendisidir: yol ve satır sayfaya göre değişir, parmak izine girmez (örnek metin ayırır).
  let sourceFile = sourceRaw ? resourceLabel(sourceRaw, siteOrigin) : null;
  if (sourceFile && sourceFile === resourceLabel(doc.href, siteOrigin)) sourceFile = null;
  return {
    directive,
    blocked,
    documentPath: maskPath(doc.pathname),
    sourceFile,
    line: sourceFile ? num(pick("line-number", "lineNumber")) : null,
    column: sourceFile ? num(pick("column-number", "columnNumber")) : null,
    sample: sample ? maskSample(sample) : null,
  };
}

/**
 * Gövdeyi ayrıştırır. Bozuk/beklenmeyen gövde boş liste döner (hata fırlatmaz).
 * `siteOrigin`: yalnız bu kökten gelen belge raporları kabul edilir (ör. https://emlaksoft.com.tr).
 */
export function parseCspReports(body: string, siteOrigin: string): CspViolation[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    return [];
  }
  const raws: Raw[] = [];
  if (Array.isArray(data)) {
    for (const item of data.slice(0, MAX_REPORTS_PER_REQUEST)) {
      if (item && typeof item === "object" && (item as Raw).type === "csp-violation") {
        const b = (item as Raw).body;
        if (b && typeof b === "object") raws.push(b as Raw);
      }
    }
  } else if (data && typeof data === "object") {
    const r = (data as Raw)["csp-report"];
    if (r && typeof r === "object") raws.push(r as Raw);
  }
  const out: CspViolation[] = [];
  for (const r of raws) {
    const v = normalizeOne(r, siteOrigin);
    if (v) out.push(v);
  }
  return out;
}

/** error_logs mesajı: sayfadan bağımsız (aynı ihlal = aynı satır). */
export function violationMessage(v: CspViolation): string {
  const where = v.sourceFile ? ` @ ${v.sourceFile}${v.line != null ? `:${v.line}` : ""}` : "";
  const sample = v.sample ? ` «${v.sample}»` : "";
  return `CSP (rapor modu) ${v.directive}: ${v.blocked}${where}${sample}`.slice(0, 500);
}

/** error_logs ayrıntısı (yığın alanı): örnek sayfa ve konum. */
export function violationDetail(v: CspViolation): string {
  return [
    `örnek sayfa: ${v.documentPath}`,
    `yönerge: ${v.directive}`,
    `engellenecek: ${v.blocked}`,
    v.sourceFile ? `kaynak: ${v.sourceFile}${v.line != null ? `:${v.line}${v.column != null ? `:${v.column}` : ""}` : ""}` : null,
    v.sample ? `örnek: ${v.sample}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
