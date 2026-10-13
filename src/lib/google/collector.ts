import { NEVER_INDEX_PREFIXES, seoPages } from "@/lib/seo/registry";
import { adsRecommendations, type AdsMetricRow } from "./ads-rules";
import { pathOfPage } from "./gsc";
import { GOOGLE_SERVICES, GOOGLE_SERVICE_LABELS, type GoogleService } from "./keys";
import { areaOf, computeServiceStatus, isBroken } from "./status";
import type { GoogleStoreSnapshot } from "./token-store";

/**
 * Google toplayıcısı (K1 sözleşmesi; tipler SP1 `site-issues/types.ts`'ten KOPYALANIR, import edilmez).
 * Saf çekirdek `buildGoogleIssues` (testli) + sunucu sarmalayıcı `googleCollector` (yalnız tabloları/ayarı okur, Google
 * API'si ÇAĞIRMAZ). Bulgular:
 *  - google-baglanti-kopuk (kritik): hizmet "yeniden bağla" durumunda (invalid_grant).
 *  - gsc-not-indexed: URL Inspection sonucu PASS değil (FAIL kritik, diğerleri uyarı).
 *  - gsc-canonical-mismatch: Google'ın seçtiği kanonik bizimkinden farklı.
 *  - gsc-ctr-opportunity: 28 günde pozisyon 4–15, gösterim yüksek, CTR beklenenin yarısından düşük; YALNIZ otomatik
 *    iyileştirilebilir (canAutoOptimize) sayfa, href SEO kaydına gider.
 *  - ads-*: kural önerileri (ads-rules.ts), href Google Ads arayüzü (değişiklik orada yapılır; manualOnly).
 * `scanned`: yalnız gerçekten değerlendirilen adresler (bağlı olmayan hizmetin eski bulgusu "doğrulandı" sayılmasın).
 */

// ---- K1 tip kopyası ----
export type IssueArea = "seo" | "hiz" | "olcum" | "reklam" | "icerik";
export type IssueSeverity = "kritik" | "uyari" | "bilgi";
export type IssueInput = {
  area: IssueArea;
  code: string;
  url: string;
  severity: IssueSeverity;
  title: string;
  explain: string;
  href: string;
  evidence?: Record<string, unknown>;
  proposal?: Record<string, unknown> | null;
  manualOnly?: boolean;
};
export type CollectorResult = { collector: string; scanned: string[] | "all"; issues: IssueInput[] };
export type IssueCollector = { id: string; areas: IssueArea[]; collect(): Promise<CollectorResult> };

export const CTR_RULE = {
  minImpressions: 100,
  minPosition: 4,
  maxPosition: 15,
  /** Beklenen CTR'nin bu oranının altı "düşük". */
  lowRatio: 0.5,
} as const;

/** Pozisyona göre kabaca beklenen organik CTR (sektör ortalaması; yalnız eşik için, ekranda "tahmini" yazılır). */
export function expectedCtr(position: number): number {
  if (position < 5) return 0.06;
  if (position < 6) return 0.05;
  if (position < 8) return 0.035;
  if (position < 11) return 0.025;
  return 0.01;
}

/**
 * Otomatik iyileştirilebilir mi (S0 `scope.ts` main'de yokken YEREL kopya): SEO envanterinde, indekslenebilir,
 * hesap grubunda değil (/kayit, /giris dönüşüm/hesap sayfaları elle yönetilir) ve asla-indeks öneklerinin dışında.
 */
export function canAutoOptimize(path: string): boolean {
  const p = path.replace(/\/+$/, "") || "/";
  if (NEVER_INDEX_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`))) return false;
  const def = seoPages().find((d) => d.path === p);
  return Boolean(def && def.canIndex && def.group !== "hesap");
}

export function seoRecordHref(path: string): string {
  return `/admin/seo?sekme=sayfalar&sayfa=${encodeURIComponent(path)}#editor`;
}

function normUrl(u: string | null | undefined): string {
  if (!u) return "";
  try {
    const x = new URL(u);
    return `${x.protocol}//${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return u.trim();
  }
}

export type GoogleIssueInput = {
  snapshot: Pick<GoogleStoreSnapshot, "tokens" | "problems" | "adsAccount">;
  inspections: Array<{ url: string; verdict: string; coverage: string | null; google_canonical: string | null; user_canonical: string | null }>;
  pages28: Array<{ key: string; clicks: number; impressions: number; ctr: number; avg_position: number }>;
  adsRows: AdsMetricRow[];
};

const pct = (n: number) => `%${(n * 100).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}`;

export function buildGoogleIssues(input: GoogleIssueInput): CollectorResult {
  const issues: IssueInput[] = [];
  const scanned: string[] = [];

  const status: Record<GoogleService, ReturnType<typeof computeServiceStatus>> = {
    gsc: computeServiceStatus({ token: input.snapshot.tokens.gsc, unreadable: input.snapshot.problems.includes("google.oauth.gsc") }),
    ads: computeServiceStatus({ token: input.snapshot.tokens.ads, unreadable: input.snapshot.problems.includes("google.oauth.ads") }),
  };

  for (const s of GOOGLE_SERVICES) {
    const key = `google:${s}`;
    scanned.push(key);
    if (isBroken(status[s])) {
      issues.push({
        area: areaOf(s),
        code: "google-baglanti-kopuk",
        url: key,
        severity: "kritik",
        title: `${GOOGLE_SERVICE_LABELS[s]} bağlantısı koptu`,
        explain: `Google bu bağlantının iznini geri çekti; veri gelmiyor. Bağlantılar ekranından ${GOOGLE_SERVICE_LABELS[s]} hizmetini yeniden bağlayın.`,
        href: "/admin/site/baglantilar",
        evidence: { hizmet: s },
        manualOnly: true,
      });
    }
  }

  // Search Console bulguları yalnız hizmet bağlıyken (bağlı değilken eski sonuçlara dayanıp bulgu üretilmez).
  if (status.gsc === "bagli" || status.gsc === "kota") {
    for (const r of input.inspections) {
      scanned.push(r.url);
      const path = pathOfPage(r.url);
      const href = path && canAutoOptimize(path) ? seoRecordHref(path) : "/admin/seo/performans?sekme=inceleme";
      if (r.verdict !== "PASS") {
        issues.push({
          area: "seo",
          code: "gsc-not-indexed",
          url: r.url,
          severity: r.verdict === "FAIL" ? "kritik" : "uyari",
          title: `Google bu sayfayı dizine almamış: ${path ?? r.url}`,
          explain: `Google'ın son incelemesine göre sayfa arama sonuçlarında yok${r.coverage ? ` (${r.coverage})` : ""}.`,
          href,
          evidence: { verdict: r.verdict, coverage: r.coverage },
          manualOnly: true,
        });
      }
      if (r.google_canonical && r.user_canonical && normUrl(r.google_canonical) !== normUrl(r.user_canonical)) {
        issues.push({
          area: "seo",
          code: "gsc-canonical-mismatch",
          url: r.url,
          severity: "uyari",
          title: `Google başka bir adresi asıl sayfa seçmiş: ${path ?? r.url}`,
          explain: "Sayfada belirttiğimiz asıl adres (kanonik) ile Google'ın seçtiği farklı; arama sonuçlarında yanlış adres görünebilir.",
          href,
          evidence: { google: r.google_canonical, site: r.user_canonical },
          manualOnly: true,
        });
      }
    }

    for (const p of input.pages28) {
      const path = pathOfPage(p.key);
      if (!path) continue;
      scanned.push(p.key);
      if (!canAutoOptimize(path)) continue;
      if (p.impressions < CTR_RULE.minImpressions) continue;
      if (p.avg_position < CTR_RULE.minPosition || p.avg_position > CTR_RULE.maxPosition) continue;
      const expected = expectedCtr(p.avg_position);
      if (p.ctr >= expected * CTR_RULE.lowRatio) continue;
      issues.push({
        area: "seo",
        code: "gsc-ctr-opportunity",
        url: p.key,
        severity: "bilgi",
        title: `${path} aramada görünüyor ama az tıklanıyor`,
        explain: `Son 28 günde ${p.impressions.toLocaleString("tr-TR")} kez göründü, ortalama ${p.avg_position.toLocaleString("tr-TR", { maximumFractionDigits: 1 })}. sırada; tıklanma oranı ${pct(p.ctr)} (bu sıra için tahmini beklenen ${pct(expected)}). Başlığı ve açıklamayı daha çekici yazmak tıklamayı artırabilir.`,
        href: seoRecordHref(path),
        evidence: { gosterim: p.impressions, tiklama: p.clicks, ctr: p.ctr, pozisyon: p.avg_position, beklenen: expected },
        proposal: { kind: "seo_meta_draft", path },
      });
    }
  }

  if (status.ads === "bagli" || status.ads === "kota") {
    const cid = input.snapshot.adsAccount?.customerId ?? null;
    for (const r of adsRecommendations(input.adsRows, cid)) {
      const url = r.adGroupId ? `ads:adgroup:${r.adGroupId}` : `ads:campaign:${r.campaignId}`;
      issues.push({
        area: "reklam",
        code: r.code,
        url,
        severity: r.severity,
        title: r.title.slice(0, 160),
        explain: r.explain.slice(0, 240),
        href: r.adsUrl,
        evidence: r.evidence,
        manualOnly: true,
      });
    }
    // Tüm Ads satırları değerlendirildi: kampanya/grup anahtarları taranmış sayılır.
    for (const row of input.adsRows) {
      scanned.push(`ads:campaign:${row.campaign_id}`, `ads:adgroup:${row.ad_group_id}`);
    }
  }

  return { collector: "google", scanned: [...new Set(scanned)], issues };
}

/** Sunucu toplayıcısı: yalnız tablolar ve mühürlü ayar okunur (dış çağrı YOK). */
export const googleCollector: IssueCollector = {
  id: "google",
  areas: ["seo", "reklam"],
  async collect() {
    const [{ platformSettingsPort, readInspections, gscSummary, readAdsRows }, { readGoogleSnapshot }, { daysAgoIso }] = await Promise.all([
      import("./db"),
      import("./token-store"),
      import("@/lib/clock"),
    ]);
    const snapshot = await readGoogleSnapshot(platformSettingsPort);
    const [inspections, pages28, adsRows] = await Promise.all([
      readInspections(1000),
      gscSummary(28, "page", 500),
      readAdsRows(daysAgoIso(30).slice(0, 10)),
    ]);
    return buildGoogleIssues({ snapshot, inspections, pages28: pages28 ?? [], adsRows: adsRows ?? [] });
  },
};
