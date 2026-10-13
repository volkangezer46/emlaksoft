import { extractDeepFacts, extractFacts } from "./audit-rules";
import { followableUrl } from "./discovery";
import { DESC_MAX, TITLE_MAX } from "./rules";
import { normalizePath } from "./scope";

/**
 * YAYIN KAPISI (SAF): bir sayfa yayınlanmadan önce SEO açısından yayınlanabilir mi?
 * Girdi: işlenmiş HTML ve/veya alanlar (alanlar HTML'den çıkanı ezer). Kurallar: başlık ve açıklama uzunluğu, tek H1,
 * başlık hiyerarşisi, görsel alt metni, noindex ile sitemap çelişkisi, iç bağlantı çözümü (bilinen yollar verilirse).
 * `errors` yayını durdurur, `warnings` yalnız gösterilir. Yayın akışlarına kaydı (dikiş) sonraki turdadır.
 */

export type SeoGateIssue = { code: string; message: string };
export type SeoGateResult = { ok: boolean; errors: SeoGateIssue[]; warnings: SeoGateIssue[] };

export type SeoGateInput = {
  html?: string;
  fields?: { title?: string | null; description?: string | null; h1Count?: number; noindex?: boolean; inSitemap?: boolean };
  /** Sayfanın kendi adresi (iç bağlantı çözümü için). */
  url?: string;
  /** Site kökü (https://alan.adi). */
  origin?: string;
  /** Var olan public yollar (normalize). Verilmezse iç bağlantı denetimi atlanır. */
  knownPaths?: ReadonlySet<string>;
};

export function checkSeoPublishable(input: SeoGateInput): SeoGateResult {
  const errors: SeoGateIssue[] = [];
  const warnings: SeoGateIssue[] = [];
  const origin = input.origin ?? (input.url ? new URL(input.url).origin : "https://site.invalid");
  const url = input.url ?? `${origin}/`;
  const facts = input.html !== undefined ? extractFacts(url, 200, input.html) : null;
  const deep = input.html !== undefined ? extractDeepFacts(url, input.html, origin) : null;

  const title = (input.fields?.title ?? facts?.title ?? "").trim();
  const description = (input.fields?.description ?? facts?.description ?? "").trim();
  const h1Count = input.fields?.h1Count ?? facts?.h1Count;
  const noindex = input.fields?.noindex ?? facts?.noindex ?? false;

  if (!title) errors.push({ code: "missing-title", message: "Sayfa başlığı boş." });
  else if (title.length > TITLE_MAX) warnings.push({ code: "long-title", message: `Başlık ${title.length} karakter (en çok ${TITLE_MAX} önerilir).` });

  if (!description) warnings.push({ code: "missing-description", message: "Açıklama boş; arama motoru kendi seçtiği metni gösterir." });
  else if (description.length > DESC_MAX) warnings.push({ code: "long-description", message: `Açıklama ${description.length} karakter (en çok ${DESC_MAX} önerilir).` });

  if (h1Count !== undefined) {
    if (h1Count === 0) errors.push({ code: "missing-h1", message: "Sayfada ana başlık (H1) yok." });
    else if (h1Count > 1) errors.push({ code: "multiple-h1", message: `Sayfada ${h1Count} ana başlık (H1) var; tek olmalı.` });
  }
  if (deep?.headingSkip) warnings.push({ code: "heading-skip", message: `Başlık sırası atlıyor (${deep.headingSkip}).` });
  if (deep && deep.imgsMissingAlt > 0) warnings.push({ code: "img-missing-alt", message: `${deep.imgsMissingAlt} görselde alt metni yok.` });

  if (noindex && input.fields?.inSitemap) errors.push({ code: "noindex-in-sitemap", message: "Sayfa gizli (noindex) ama sitemap'e girecek; birini düzeltin." });

  if (facts && input.knownPaths) {
    const broken = new Set<string>();
    for (const href of facts.links) {
      const target = followableUrl(href, url, origin);
      if (!target) continue;
      const path = normalizePath(new URL(target).pathname || "/");
      if (!input.knownPaths.has(path)) broken.add(path);
    }
    for (const p of broken) errors.push({ code: "unresolved-link", message: `İç bağlantı çözülmüyor: ${p}` });
  }

  return { ok: errors.length === 0, errors, warnings };
}
