import type { CollectorResult as GoogleResult } from "@/lib/google/collector";
import type { CollectorResult as MeasureResult } from "@/lib/measure/collector";
import type { AfterPublishHook as SeoHook, FixExecutor, FixRisk, FixTarget } from "@/lib/seo/contracts";
import type { AfterPublishHook as StaticHook } from "@/lib/static-home/after-publish-hook";
import type { CollectorResult as SpeedResult } from "@/lib/static-home/collector";
import type { ExecutorRisk as StaticRisk, IssueExecutor as StaticExecutor } from "@/lib/static-home/executors";
import type {
  AfterPublishHook,
  CollectorResult,
  ExecutorRisk,
  IssueExecutor,
  IssueInput,
  IssueStatus,
  PlannedFix,
  SiteIssue,
} from "./types";

/**
 * KAYIT BAĞDAŞTIRICILARI (S2/S3/S4 dikişleri; SAF). Paketler Kokpit sözleşmesini (types.ts K1/K2/K3) paralel
 * geliştirme sırasında KOPYA tiplerle yazdı; biçimler yer yer farklıdır (ör. `collect()` ↔ `run()`, `FixTarget` ↔
 * `SiteIssue`, `surfaceId` ↔ `surface`). Burada her paketin kendi nesnesi Kokpit biçimine çevrilir; paketlerin kendi
 * ekranları (SEO merkezi, Hız, Bağlantılar) aynı nesneleri değişmeden kullanmaya devam eder.
 * Kayıt listeleri: collectors.ts (COLLECTORS), executors.ts (EXECUTORS), publishing/after-publish.ts (HOOKS).
 */

/* ---------------------------------------- K1: toplayıcılar ---------------------------------------- */

export const SPEED_COLLECTOR = "speed";
export const MEASURE_COLLECTOR = "olcum";
export const GOOGLE_GSC_COLLECTOR = "google-gsc";
export const GOOGLE_ADS_COLLECTOR = "google-ads";

const STATIC_REFRESH_SUMMARY = (path: string) => `${path} hızlı (statik) sürümü yeniden üretilir; içerik değişmez`;

/** Hız toplayıcısı → Kokpit. Veri yoksa (süreç yeni başladı, koşu yok) kaynak tarihi boş: kutucuk "veri birikiyor" der. */
export function speedResultToCollector(r: SpeedResult, atIso: string): CollectorResult {
  const issues: IssueInput[] = r.issues.map((i) => ({
    area: "hiz",
    url: i.url,
    code: i.code,
    severity: i.severity,
    title: i.title,
    explain: i.explain,
    evidence: i.evidence ?? null,
    proposal: i.proposal && !i.manualOnly ? { kind: i.proposal.kind, summary: STATIC_REFRESH_SUMMARY(i.proposal.target.url), params: { url: i.proposal.target.url } } : null,
    href: i.href ?? "/admin/site/hiz",
    manualOnly: Boolean(i.manualOnly),
  }));
  const hasData = r.scanned === "all" || r.scanned.length > 0;
  return {
    collector: SPEED_COLLECTOR,
    area: "hiz",
    scanned: r.scanned,
    issues,
    sourceAt: hasData ? atIso : null,
    note: hasData ? undefined : "Hız verisi birikiyor (bu süreçte henüz statik çizim ya da ölçüm yok).",
  };
}

/** Ölçüm sağlığı → Kokpit (bulgular yalnız ayar/kurulum işidir: manualOnly, öneri yok). */
export function measureResultToCollector(r: MeasureResult, atIso: string): CollectorResult {
  return {
    collector: MEASURE_COLLECTOR,
    area: "olcum",
    scanned: r.scanned,
    issues: r.issues.map((i) => ({
      area: "olcum",
      url: i.url,
      code: i.code,
      severity: i.severity,
      title: i.title,
      explain: i.explain,
      evidence: i.evidence ?? null,
      proposal: null,
      href: i.href,
      manualOnly: true,
    })),
    sourceAt: atIso,
  };
}

const isAdsKey = (k: string) => k === "google:ads" || k.startsWith("ads:");

/**
 * Google sonucu iki Kokpit toplayıcısına ayrılır: Search Console (alan seo) ve Google Ads (alan reklam). Hizmet bağlı
 * değilse o alanın kaynak tarihi boştur (kutucuk sahte "sorunsuz" notu göstermez). Google önerileri (CTR) elle yapılır:
 * öneri taşınmaz, "Düzelt" SEO kaydına gider.
 */
export function googleResultToCollector(r: GoogleResult, area: "seo" | "reklam", atIso: string): CollectorResult {
  const ads = area === "reklam";
  const service = ads ? "ads" : "gsc";
  const scanned = r.scanned === "all" ? "all" : r.scanned.filter((k) => isAdsKey(k) === ads);
  const connected = r.services ? r.services[service] !== "bagli_degil" : true;
  return {
    collector: ads ? GOOGLE_ADS_COLLECTOR : GOOGLE_GSC_COLLECTOR,
    area,
    scanned,
    issues: r.issues
      .filter((i) => i.area === area)
      .map((i) => ({
        area,
        url: i.url,
        code: i.code,
        severity: i.severity,
        title: i.title,
        explain: i.explain,
        evidence: i.evidence ?? null,
        proposal: null,
        href: i.href,
        manualOnly: i.manualOnly ?? true,
      })),
    sourceAt: connected ? atIso : null,
    note: connected ? undefined : ads ? "Google Ads bağlı değil." : "Search Console bağlı değil.",
  };
}

/* ---------------------------------------- K2: yürütücüler ---------------------------------------- */

const SEO_RISK: Record<FixRisk, ExecutorRisk> = { guvenli: "guvenli", dikkat: "orta", riskli: "yuksek" };
const STATIC_RISK: Record<StaticRisk, ExecutorRisk> = { guvenli: "guvenli", orta: "orta", riskli: "yuksek" };

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
const isFixRisk = (v: unknown): v is FixRisk => v === "guvenli" || v === "dikkat" || v === "riskli";

/** Kuyruk satırı → SEO düzelticisinin hedefi (öneri parametreleri `seoProposalToIssue` ile yazılmıştır). */
export function issueToFixTarget(issue: Pick<SiteIssue, "url" | "code" | "manual_only" | "proposal" | "evidence">): FixTarget {
  const p = issue.proposal;
  const params = p?.params ?? {};
  return {
    url: issue.url,
    code: issue.code,
    manualOnly: issue.manual_only,
    ...(issue.evidence ? { evidence: issue.evidence } : {}),
    proposal: p
      ? {
          rule: str(params.rule) ?? issue.code,
          summary: p.summary,
          field: str(params.field),
          before: p.before ?? null,
          after: p.after ?? null,
          action: { kind: p.kind.split(":")[0]!, risk: isFixRisk(params.risk) ? params.risk : "dikkat" },
        }
      : null,
  };
}

/**
 * SEO düzelticisi (FixExecutor) → Kokpit yürütücüsü. `kind` Kokpit türüdür (ör. "seo_meta_draft:long-description");
 * plan kuru çalışmadır, hedef plan parametresinde taşınır. Başarılı taslakta yüzey (`draftSurface`) ve durum döner.
 */
export function fromSeoExecutor(
  kind: string,
  ex: FixExecutor,
  opts: { label?: string; draftSurface: string | null; status: IssueStatus | null },
): IssueExecutor {
  return {
    kind,
    label: opts.label ?? ex.label,
    risk: "guvenli",
    mode: opts.status === "taslakta" ? "draft" : "direct",
    async plan(issue): Promise<PlannedFix | null> {
      const target = issueToFixTarget(issue);
      if (!ex.canHandle(target)) return null;
      const p = await ex.plan(target);
      if (!p) return null;
      return { issueId: issue.id, kind, target: p.target, summary: p.summary, before: p.before, after: p.after, risk: SEO_RISK[p.risk], params: { fixTarget: target } };
    },
    async apply(fix, ctx) {
      const target = fix.params?.fixTarget as FixTarget | undefined;
      if (!target) return { issueId: fix.issueId, ok: false, message: "Plan eksik; düzeltmeyi yeniden hazırlayın.", before: fix.before, after: fix.after };
      const r = await ex.apply(target, { actorId: ctx.actorId, source: ctx.source });
      if (!r.ok) return { issueId: fix.issueId, ok: false, message: r.error, before: fix.before, after: fix.after };
      return {
        issueId: fix.issueId,
        ok: true,
        message: r.message,
        before: r.before,
        after: r.after,
        draftSurface: opts.draftSurface,
        publishRef: r.publishRef ?? null,
        ...(opts.status ? { status: opts.status } : {}),
      };
    },
  };
}

/** Statik sayfa durumu → kısa Türkçe özet ("statik · 42 KB"). */
export function describeStaticState(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  const s = v as { isStatic?: boolean | null; gzipBytes?: number | null };
  const kind = s.isStatic === true ? "statik" : s.isStatic === false ? "normal sürüm" : "önbellek boş";
  return typeof s.gzipBytes === "number" ? `${kind} · ${Math.round(s.gzipBytes / 1024)} KB` : kind;
}

/** Statik tazeleme yürütücüsü → Kokpit (doğrudan uygular; içerik değişmez, bulgu "yayında, doğrulama bekliyor" olur). */
export function fromStaticExecutor(ex: StaticExecutor): IssueExecutor {
  return {
    kind: ex.kind,
    label: ex.label,
    risk: STATIC_RISK[ex.risk],
    mode: "direct",
    async plan(issue): Promise<PlannedFix | null> {
      const url = str(issue.proposal?.params?.url) ?? issue.url;
      const p = await ex.plan({ url, issueId: issue.id });
      if (!p.canApply) return null;
      return { issueId: issue.id, kind: ex.kind, target: url, summary: p.summary, before: describeStaticState(p.before), after: "yeniden çizilir", risk: STATIC_RISK[ex.risk], params: { url } };
    },
    async apply(fix, ctx) {
      const url = str(fix.params?.url) ?? fix.target;
      const r = await ex.apply({ url, issueId: fix.issueId }, { actorId: ctx.actorId });
      return {
        issueId: fix.issueId,
        ok: r.ok,
        message: r.message,
        before: describeStaticState(r.before) ?? fix.before,
        after: describeStaticState(r.after),
        draftSurface: null,
        ...(r.ok ? { status: "yayinda" as const } : {}),
      };
    },
  };
}

/* ---------------------------------------- K3: yayın sonrası kancaları ---------------------------------------- */

export function fromStaticHook(h: StaticHook): AfterPublishHook {
  return {
    id: h.id,
    order: h.order,
    run: (ev) => h.run({ surfaceId: ev.surface, livePaths: ev.livePaths, actorId: ev.actorId, source: ev.source }),
  };
}

export function fromSeoHook(h: SeoHook, nowIso: () => string): AfterPublishHook {
  return {
    id: h.id,
    order: h.order,
    run: (ev) => h.run({ surfaceId: ev.surface, livePaths: ev.livePaths, actorId: ev.actorId, source: ev.source, at: nowIso() }),
  };
}
