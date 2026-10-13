import { auditRunToIssues } from "@/lib/seo/issues-collector";
import type { AuditRun, SeoSettings } from "@/lib/seo/store";
import type { IssueProposal as SeoProposal } from "@/lib/seo/contracts";
import { canAutoOptimize, isInPublicScope, normalizeUrlForFingerprint } from "./fingerprint";
import type { CollectorResult, IssueInput, IssueProposal } from "./types";

/**
 * SEO toplayıcısının Kokpit dönüşümü (K1, area "seo"; S4 dikişi): SEO robotunun bir koşusunu (`seo.audit.latest`)
 * SP2'nin SEO toplayıcı dönüşümünden (`auditRunToIssues`: teknik olmayan açıklama, düzeltme ekranı, kural önerisi)
 * geçirip Kokpit sözleşmesine (types.ts) indirger. Toplayıcı kimliği eski yerleşik toplayıcıyla AYNI kalır (mevcut
 * kuyruk kayıtları sahipsiz kalmasın). Kapsam "all": robotun son TAM taramasında görünmeyen bulgu doğrulanmış sayılır;
 * tarama kısmiyse (`truncated`) kapsam boştur, hiçbir şey kapanmaz. Kapsam dışı yollar (oturum, portal) hiç alınmaz;
 * üyelik yolları (`/kayit`) `manualOnly` olur ve hiçbir zaman "Taslağa al" önerisi taşımaz.
 * Öneri yalnız SEO ayarları verilirse (gerçek açıklama metni ve kısaltılmış hâli) ve eylemi varsa üretilir; tür adı
 * Otopilot izin listesiyle aynıdır (`seo_meta_draft:<kod>`, `redirect_404_draft`).
 */

export const BUILTIN_SEO_COLLECTOR = "builtin-seo-latest";

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

/** SEO önerisi → Kokpit önerisi. Eylemsiz öneri (elle düzeltilecek) Kokpit'te öneri olarak taşınmaz, kanıta yazılır. */
export function seoProposalToIssue(code: string, p: SeoProposal | null | undefined): IssueProposal | null {
  if (!p?.action) return null;
  const kind = p.action.kind === "seo_meta_draft" ? `seo_meta_draft:${code}` : p.action.kind;
  return {
    kind,
    summary: p.summary,
    before: p.before ?? null,
    after: p.after ?? null,
    params: { rule: p.rule, field: p.field ?? null, risk: p.action.risk },
  };
}

export function auditRunToCollectorResult(run: AuditRun | null, settings: SeoSettings | null = null): CollectorResult {
  if (!run) return { collector: BUILTIN_SEO_COLLECTOR, area: "seo", scanned: [], issues: [], sourceAt: null, note: "SEO robotu henüz çalışmadı." };
  const seo = auditRunToIssues(run, settings);
  const issues: IssueInput[] = [];
  run.findings.forEach((f, i) => {
    const path = normalizeUrlForFingerprint(f.url);
    if (!isInPublicScope(path)) return;
    const s = seo.issues[i]!;
    const manualOnly = s.manualOnly || !canAutoOptimize(path);
    issues.push({
      area: "seo",
      url: path,
      code: f.code,
      severity: s.severity,
      title: TITLES[f.code] ?? s.title,
      explain: s.explain,
      evidence: { message: f.message, fix: f.fix, auditAt: run.at, ...(s.proposal && !s.proposal.action ? { suggestion: s.proposal.summary } : {}) },
      proposal: manualOnly ? null : seoProposalToIssue(f.code, s.proposal),
      href: s.href,
      manualOnly,
    });
  });
  // Kısmi tarama (sayfa sınırı, zaman bütçesi ya da depoda kırpılan bulgular): görünmeyen bulgunun düzeldiği
  // BİLİNEMEZ, bu turda hiçbir şey kapanmaz (taranmayan URL'nin bulgusu kapanmaz).
  if (run.truncated) {
    return { collector: BUILTIN_SEO_COLLECTOR, area: "seo", scanned: [], issues, sourceAt: run.at, note: "SEO robotunun son taraması kısmi; bu turda bulgu kapatılmadı." };
  }
  return { collector: BUILTIN_SEO_COLLECTOR, area: "seo", scanned: "all", issues, sourceAt: run.at };
}
