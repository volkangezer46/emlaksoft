import type { SeoGlobal } from "./schema";

/** Arama sonucu görünümü için pratik sınırlar (karakter; piksel kesin değildir). */
export const TITLE_MAX = 60;
export const TITLE_MIN = 15;
export const DESC_MAX = 160;
export const DESC_MIN = 70;

/** Başlık şablonu uygular ("%s | EmlakSoft"). Boş başlıkta varsayılan başlık. */
export function renderTitle(template: string, title: string | null | undefined, fallback: string): string {
  const t = (title ?? "").trim();
  if (!t) return fallback;
  return template.replace("%s", t);
}

export type Verdict = "ok" | "warn" | "fail";

export function titleVerdict(rendered: string): { verdict: Verdict; message: string } {
  const n = rendered.trim().length;
  if (n === 0) return { verdict: "fail", message: "Başlık boş." };
  if (n > TITLE_MAX) return { verdict: "warn", message: `Başlık ${n} karakter; ${TITLE_MAX} üstü arama sonuçlarında kesilebilir.` };
  if (n < TITLE_MIN) return { verdict: "warn", message: `Başlık ${n} karakter; çok kısa.` };
  return { verdict: "ok", message: `Başlık ${n} karakter.` };
}

export function descriptionVerdict(desc: string | null | undefined): { verdict: Verdict; message: string } {
  const n = (desc ?? "").trim().length;
  if (n === 0) return { verdict: "fail", message: "Açıklama yok." };
  if (n > DESC_MAX) return { verdict: "warn", message: `Açıklama ${n} karakter; ${DESC_MAX} üstü kesilebilir.` };
  if (n < DESC_MIN) return { verdict: "warn", message: `Açıklama ${n} karakter; en az ${DESC_MIN} önerilir.` };
  return { verdict: "ok", message: `Açıklama ${n} karakter.` };
}

function stripQueryHash(v: string): string {
  return v.replace(/[?#].*$/, "");
}

/** Mutlak canonical üretir. base ve path birleşir; zaten mutlak https ise aynen döner. Sorgu/parça atılır. */
export function canonicalUrl(base: string, pathOrUrl: string): string {
  const b = base.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(pathOrUrl)) return stripQueryHash(pathOrUrl);
  const p = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  const clean = stripQueryHash(p);
  return clean === "/" ? b : `${b}${clean}`;
}

/** İki adresin aynı sitede olup olmadığı (tam host karşılaştırılır; www/apex farkı yakalanır). */
export function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host.toLowerCase() === new URL(b).host.toLowerCase();
  } catch {
    return false;
  }
}

export function effectiveOgImage(global: SeoGlobal, pageOgImage: string | undefined): string {
  return pageOgImage || global.ogImage || "/opengraph-image";
}

export type ChecklistItem = { id: string; label: string; verdict: Verdict; detail: string };

export type ChecklistInput = {
  renderedTitle: string;
  description: string | null;
  canonical: string | null;
  base: string;
  ogImage: string | null;
  indexable: boolean;
  inSitemap: boolean;
  jsonLdErrors: string[] | null;
  /** Robot son denetiminden: sayfadaki h1 sayısı (null: henüz denetlenmedi). */
  h1Count: number | null;
};

/** Kural tabanlı geçti/kaldı listesi — SAHTE PUAN YOK; her madde somut bir kuraldır. */
export function pageChecklist(i: ChecklistInput): ChecklistItem[] {
  const t = titleVerdict(i.renderedTitle);
  const d = descriptionVerdict(i.description);
  const canonicalOk = i.canonical ? sameHost(canonicalUrl(i.base, i.canonical), i.base) : false;
  const items: ChecklistItem[] = [
    { id: "title", label: "Başlık uzunluğu", verdict: t.verdict, detail: t.message },
    { id: "description", label: "Açıklama", verdict: d.verdict, detail: d.message },
    {
      id: "canonical",
      label: "Canonical adres",
      verdict: i.canonical ? (canonicalOk ? "ok" : "warn") : "fail",
      detail: i.canonical
        ? canonicalOk
          ? canonicalUrl(i.base, i.canonical)
          : "Canonical başka bir alan adına işaret ediyor."
        : "Canonical tanımlı değil.",
    },
    {
      id: "og-image",
      label: "Paylaşım görseli (OG)",
      verdict: i.ogImage ? "ok" : "fail",
      detail: i.ogImage ? "Paylaşım görseli var." : "Paylaşım görseli yok.",
    },
    {
      id: "robots-sitemap",
      label: "Robots ve sitemap tutarlılığı",
      verdict: !i.indexable && i.inSitemap ? "fail" : "ok",
      detail:
        !i.indexable && i.inSitemap
          ? "noindex sayfa sitemap'te; ikisinden birini kapatın."
          : i.indexable
            ? "İndekslenebilir."
            : "noindex ve sitemap dışında.",
    },
  ];
  if (i.jsonLdErrors) {
    items.push({
      id: "jsonld",
      label: "Yapılandırılmış veri",
      verdict: i.jsonLdErrors.length === 0 ? "ok" : "fail",
      detail: i.jsonLdErrors.length === 0 ? "Zorunlu alanlar tam." : i.jsonLdErrors.slice(0, 3).join(" · "),
    });
  }
  items.push({
    id: "h1",
    label: "Tek h1",
    verdict: i.h1Count === null ? "warn" : i.h1Count === 1 ? "ok" : "fail",
    detail: i.h1Count === null ? "Robot henüz denetlemedi." : `Sayfada ${i.h1Count} adet h1 var.`,
  });
  return items;
}
