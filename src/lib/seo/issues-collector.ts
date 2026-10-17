import { now } from "@/lib/clock";
import type { Finding } from "./audit-rules";
import type { CollectorMode, CollectorResult, IssueCollector, IssueInput, IssueProposal, IssueSeverity } from "./contracts";
import { effectivePageView } from "./metadata";
import { getSeoPage } from "./registry";
import { ruleSuggestion } from "./rule-suggest";
import { canAutoOptimize, isManualOnly, pathOfUrl } from "./scope";
import type { AuditRun, SeoSettings } from "./store";

/**
 * SEO TOPLAYICISI (K1, area "seo"). Kokpit kaydı `site-issues/collectors.ts` (dönüşüm: site-issues/builtin-seo-latest.ts).
 *  - "read": son robot koşusunu (`seo.audit.latest`) okur; ağ çağrısı YOK.
 *  - "audit": robotu çalıştırır (keşif + kurallar), sonra aynı dönüşümü uygular.
 * `scanned`: o koşuda taranan adresler (eski kayıtlarda h1 anahtarları). Her bulguda Türkçe `explain` ve ilgili
 * `/admin/site/seo?sekme=…` ekranı (`href`) vardır. Kapsam dışı/üyelik/ofis sayfası bulguları `manualOnly`: eylem ALMAZ.
 */

const SEVERITY: Record<Finding["severity"], IssueSeverity> = { critical: "kritik", warning: "uyari", info: "bilgi" };

/** Teknik olmayan Türkçe açıklamalar (≤240). Bilinmeyen kod: genel cümle. */
const EXPLAIN: Record<string, string> = {
  "http-error": "Arama motorlarına bildirdiğimiz bir sayfa açılmıyor; ziyaretçi ve Google hata görüyor.",
  "sitemap-redirect": "Sitemap'te başka adrese yönlenen bir sayfa var; arama motoru boşuna dolaşıyor.",
  "sitemap-unreachable": "Site haritası okunamıyor; arama motorları yeni sayfaları geç öğrenir.",
  "sitemap-foreign-host": "Site haritasında başka alan adına ait adres var; bu adresler yok sayılır.",
  "sitemap-disallowed": "Site haritasındaki bir sayfa robots.txt ile taramaya kapalı; çelişki var.",
  "robots-unreachable": "robots.txt açılmıyor; arama motorları hangi bölümleri tarayacağını bilemez.",
  "robots-no-sitemap": "robots.txt site haritasını göstermiyor.",
  "robots-missing-guard": "Panel gibi gizli kalması gereken bir bölüm taramaya açık görünüyor.",
  "missing-title": "Sayfanın arama sonucunda görünecek başlığı yok.",
  "long-title": "Sayfa başlığı uzun; arama sonucunda kesilerek görünür.",
  "missing-description": "Sayfanın arama sonucundaki açıklaması yok; Google kendi seçtiği metni gösterir.",
  "long-description": "Açıklama uzun; arama sonucunda yarıda kesilir.",
  "missing-canonical": "Sayfa hangi adresin asıl olduğunu söylemiyor; kopya adresler sıralamayı bölebilir.",
  "relative-canonical": "Asıl adres bilgisi eksik yazılmış; arama motoru yanlış yorumlayabilir.",
  "canonical-host-mismatch": "Sayfa asıl adres olarak başka bir alan adını gösteriyor; sıralama oraya gider.",
  "canonical-mismatch": "Sayfa asıl adres olarak başka bir sayfayı gösteriyor.",
  "missing-og-image": "Paylaşıldığında görsel çıkmıyor; sosyal medyada daha az tıklanır.",
  "missing-og-title": "Paylaşım başlığı yok; sosyal medyada sayfa adı kötü görünebilir.",
  "missing-h1": "Sayfada ana başlık yok; konusu arama motoruna net değil.",
  "multiple-h1": "Sayfada birden çok ana başlık var; konu dağınık görünür.",
  "noindex-in-sitemap": "Gizli işaretli bir sayfa site haritasında; arama motoruna çelişkili sinyal gidiyor.",
  "jsonld-parse": "Sayfadaki yapılandırılmış veri bozuk; zengin sonuç gösterilmez.",
  "jsonld-fields": "Yapılandırılmış veride zorunlu bir alan eksik.",
  "jsonld-forbidden": "Yapılandırılmış veride sahte puan/yorum var; ceza riski.",
  "duplicate-title": "Birden çok sayfa aynı başlığı taşıyor; arama motoru hangisini göstereceğini seçemez.",
  "duplicate-description": "Birden çok sayfa aynı açıklamayı taşıyor.",
  "broken-link": "Sayfada açılmayan bir iç bağlantı var; ziyaretçi hata sayfasına düşüyor.",
  "indexable-not-in-sitemap": "Aranabilir bir sayfa site haritasında yok; Google onu geç ya da hiç bulmayabilir.",
  "noindex-linked-from-index": "Gizli işaretli bir sayfaya açık sayfalardan bağlantı veriliyor (bilgi).",
  "img-missing-alt": "Bazı görsellerin açıklaması yok; görme engelli ziyaretçi ve görsel arama için eksik.",
  "heading-skip": "Ara başlıklar sıra atlıyor; sayfanın yapısı daha zor anlaşılır.",
  "thin-content": "Sayfada çok az yazı var; arama motoru sayfanın neyi anlattığını anlamakta zorlanır.",
  "slow-ttfb": "Sunucu bu sayfaya geç yanıt veriyor; ziyaretçi ilk görüntüyü geç görür.",
  "html-too-large": "Sayfa kodu çok büyük; telefonda yavaş açılır.",
  "meta-not-in-head": "Başlık ve açıklama sayfanın sonunda basılıyor; bazı arama motorları görmeyebilir.",
  "og-image-unreachable": "Paylaşım görseli açılmıyor; sosyal medyada görselsiz görünür.",
  "og-image-external": "Paylaşım görseli başka sitede; erişimi denetlenmedi (bilgi).",
  "internal-link-nofollow": "Kendi sayfalarımıza verdiğimiz bazı bağlantılar arama motoruna 'izleme' diyor.",
  "mixed-content": "Güvenli sayfada güvensiz (http) kaynak var; tarayıcı engelleyebilir.",
  "orphan-page": "Hiçbir sayfa bu sayfaya bağlantı vermiyor; ziyaretçi ve arama motoru zor bulur.",
  "broken-image": "Sayfadaki bir görsel açılmıyor; ziyaretçi boş kutu görür, görsel aramada çıkmaz.",
  "internal-link-redirect": "Bir iç bağlantı önce başka adrese yönleniyor; arama motoru boşuna dolaşıyor (bilgi).",
  "redirect-chain": "Bir iç bağlantı birden çok kez yönleniyor ya da döngüye giriyor; arama motoru takip etmeyi bırakabilir.",
};

const SITEMAP_CODES = new Set(["sitemap-unreachable", "sitemap-foreign-host", "sitemap-disallowed", "sitemap-redirect", "robots-unreachable", "robots-no-sitemap", "robots-missing-guard", "noindex-in-sitemap", "indexable-not-in-sitemap", "noindex-linked-from-index"]);
const PAGE_EDIT_CODES = new Set(["missing-title", "long-title", "missing-description", "long-description", "missing-canonical", "relative-canonical", "canonical-host-mismatch", "canonical-mismatch", "missing-og-image", "missing-og-title", "duplicate-title", "duplicate-description", "og-image-unreachable"]);

/** İlgili düzeltme ekranı (SAF). Yönetilebilir sayfa bulgusu sayfa editörüne, diğerleri ilgili sekmeye gider. */
export function seoIssueHref(code: string, url: string): string {
  const path = pathOfUrl(url);
  if (code === "broken-link" || code === "redirect-chain" || code === "internal-link-redirect") return "/admin/site/seo?sekme=tarama&bolum=yonlendirme";
  if (PAGE_EDIT_CODES.has(code) && path && getSeoPage(path)) return `/admin/site/seo?sekme=sayfalar&sayfa=${encodeURIComponent(path)}#editor`;
  if (SITEMAP_CODES.has(code)) return "/admin/site/seo?sekme=tarama&bolum=sitemap";
  if (code.startsWith("jsonld")) return "/admin/site/seo?sekme=tarama&bolum=veri";
  return "/admin/site/seo?sekme=tarama";
}

/** Kural önerisi (uzun/eksik başlık-açıklama, eksik paylaşım başlığı; yönetilebilir sayfada). manualOnly ise eylemsiz. */
const PROPOSAL_CODES = new Set(["long-description", "missing-og-title", "long-title", "missing-description"]);

function proposalFor(f: Finding, settings: SeoSettings | null, manualOnly: boolean): IssueProposal | null {
  if (!settings || !PROPOSAL_CODES.has(f.code)) return null;
  const path = pathOfUrl(f.url);
  const def = path ? getSeoPage(path) : undefined;
  if (!path || !def) return null;
  const view = effectivePageView(def, settings.pages[path], settings.global);
  const autoAction = !manualOnly && canAutoOptimize(path);
  if (f.code === "long-title") {
    const core = (settings.pages[path]?.title ?? def.title ?? "").trim();
    return core ? ruleSuggestion({ rule: "long-title", path, core, template: settings.global.titleTemplate, autoAction }) : null;
  }
  if (f.code === "missing-description") {
    return ruleSuggestion({ rule: "missing-description", path, fallback: def.description ?? null, autoAction });
  }
  if (f.code === "long-description") {
    return view.description ? ruleSuggestion({ rule: "long-description", path, description: view.description, autoAction }) : null;
  }
  return ruleSuggestion({ rule: "missing-og-title", path, renderedTitle: view.renderedTitle, siteName: settings.global.siteName, autoAction });
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Robot koşusu → K1 sonucu (SAF; testli). `settings` verilmezse öneri üretilmez. */
export function auditRunToIssues(run: AuditRun, settings: SeoSettings | null): CollectorResult {
  const issues: IssueInput[] = run.findings.map((f) => {
    const manualOnly = isManualOnly(f.url);
    return {
      area: "seo",
      url: f.url,
      code: f.code,
      severity: SEVERITY[f.severity],
      title: clip(f.message, 160),
      explain: clip(EXPLAIN[f.code] ?? "Arama motoru görünürlüğünü etkileyen bir sorun bulundu.", 240),
      href: seoIssueHref(f.code, f.url),
      manualOnly,
      evidence: { fix: f.fix },
      proposal: proposalFor(f, settings, manualOnly),
    };
  });
  const scanned = run.scanned && run.scanned.length > 0 ? run.scanned : Object.keys(run.h1);
  return { area: "seo", at: run.at, scanned, issues, note: run.truncated ? "Tarama kısmi (bütçe sınırı)." : undefined };
}

export const seoCollector: IssueCollector = {
  id: "seo",
  area: "seo",
  label: "SEO robotu",
  async collect(mode: CollectorMode): Promise<CollectorResult> {
    const { readAuditLatest, readSeoSettingsFresh } = await import("./store");
    let run: AuditRun | null;
    if (mode === "audit") {
      const { executeSeoRobot } = await import("./robot");
      run = (await executeSeoRobot("manual")).run;
    } else {
      run = await readAuditLatest();
    }
    if (!run) return { area: "seo", at: new Date(now()).toISOString(), scanned: [], issues: [], note: "Robot henüz çalışmadı." };
    const settings = await readSeoSettingsFresh().catch(() => null);
    return auditRunToIssues(run, settings);
  },
};
