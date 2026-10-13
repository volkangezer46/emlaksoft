import type { AuditRun } from "@/lib/seo/store";
import { canAutoOptimize, isInPublicScope, normalizeUrlForFingerprint } from "./fingerprint";
import type { CollectorResult, IssueInput, IssueSeverity } from "./types";

/**
 * Yerleşik SEO toplayıcısı (K1, area "seo"): SEO robotunun SON denetimini (`seo.audit.latest`, mevcut okuma işlevi
 * `readAuditLatest`) bulgu kuyruğuna çevirir. Robotu çalıştırmaz, SEO deposuna yazmaz. Kapsam "all": robotun son
 * TAM taramasında görünmeyen bulgu doğrulanmış sayılır; tarama kısmiyse (`truncated`) kapsam boştur, hiçbir şey kapanmaz. Kapsam dışı yollar (oturum, portal) hiç alınmaz; üyelik yolları
 * (`/kayit`) `manualOnly` olur ve hiçbir zaman "Taslağa al" önerisi taşımaz.
 */

export const BUILTIN_SEO_COLLECTOR = "builtin-seo-latest";

const SEVERITY: Record<"critical" | "warning" | "info", IssueSeverity> = { critical: "kritik", warning: "uyari", info: "bilgi" };

/** Teknik olmayan başlık; listede olmayan kod robotun kendi mesajını kullanır. */
const TITLES: Record<string, string> = {
  "missing-title": "Sayfanın arama sonucu başlığı yok",
  "long-title": "Arama sonucu başlığı çok uzun, kesiliyor",
  "missing-description": "Arama sonucunda görünen açıklama yok",
  "long-description": "Arama sonucu açıklaması çok uzun, kesiliyor",
  "missing-canonical": "Sayfanın asıl adresi belirtilmemiş",
  "canonical-mismatch": "Sayfa başka bir adresi asıl adres gösteriyor",
  "canonical-host-mismatch": "Sayfa farklı bir alan adını asıl adres gösteriyor",
  "missing-og-image": "Paylaşımda görsel çıkmıyor",
  "missing-og-title": "Paylaşım başlığı yok",
  "missing-h1": "Sayfanın ana başlığı yok",
  "multiple-h1": "Sayfada birden çok ana başlık var",
  "noindex-in-sitemap": "Arama motoruna kapalı sayfa site haritasında",
  "http-error": "Site haritasındaki sayfa açılmıyor",
  "sitemap-redirect": "Site haritasındaki adres başka yere yönleniyor",
  "sitemap-unreachable": "Site haritası okunamıyor",
  "broken-link": "Sayfada kırık bağlantı var",
  "jsonld-parse": "Yapılandırılmış veri okunamıyor",
};

/** Otomatik hazırlanabilen öneri türleri (yürütücüleri SP2 dikişinde bağlanır; Otopilot izin listesiyle aynı adlar). */
const AUTO_PROPOSALS: Record<string, (path: string, message: string) => { summary: string; before: string | null; after: string | null }> = {
  "long-description": (path, message) => {
    const n = /(\d+)\s*karakter/.exec(message)?.[1] ?? null;
    return { summary: `${path} açıklaması ${n ? `${n}→155` : "155"} karakter`, before: n ? `${n} karakter` : null, after: "≤155 karakter" };
  },
  "missing-og-title": (path) => ({ summary: `${path} için paylaşım başlığı eklenir`, before: null, after: "Sayfa başlığından üretilir" }),
};

const seoHref = (path: string) => `/admin/seo?sekme=sayfalar&sayfa=${encodeURIComponent(path)}#editor`;

export function auditRunToCollectorResult(run: AuditRun | null): CollectorResult {
  if (!run) return { collector: BUILTIN_SEO_COLLECTOR, area: "seo", scanned: [], issues: [], sourceAt: null, note: "SEO robotu henüz çalışmadı." };
  const issues: IssueInput[] = [];
  for (const f of run.findings ?? []) {
    const path = normalizeUrlForFingerprint(f.url);
    if (!isInPublicScope(path)) continue;
    const auto = canAutoOptimize(path);
    const make = AUTO_PROPOSALS[f.code];
    const p = auto && make ? make(path, f.message) : null;
    issues.push({
      area: "seo",
      url: path,
      code: f.code,
      severity: SEVERITY[f.severity] ?? "bilgi",
      title: TITLES[f.code] ?? f.message,
      explain: `${f.message} ${f.fix}`.trim(),
      evidence: { message: f.message, auditAt: run.at },
      proposal: p ? { kind: `seo_meta_draft:${f.code}`, ...p } : null,
      href: path.endsWith(".xml") || path.endsWith(".txt") ? "/admin/seo?sekme=robot" : seoHref(path),
      manualOnly: !auto,
    });
  }
  // Kısmi tarama (sayfa sınırı, zaman bütçesi ya da depoda kırpılan bulgular): görünmeyen bulgunun düzeldiği
  // BİLİNEMEZ, bu turda hiçbir şey kapanmaz (taranmayan URL'nin bulgusu kapanmaz).
  if (run.truncated) {
    return { collector: BUILTIN_SEO_COLLECTOR, area: "seo", scanned: [], issues, sourceAt: run.at, note: "SEO robotunun son taraması kısmi; bu turda bulgu kapatılmadı." };
  }
  return { collector: BUILTIN_SEO_COLLECTOR, area: "seo", scanned: "all", issues, sourceAt: run.at };
}
