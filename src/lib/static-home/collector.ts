import { PSI_DROP_THRESHOLD, STATIC_HTML_BUDGET, checkStaticHtmlBudget } from "@/lib/perf/budgets";
import type { CompressionResult } from "@/lib/perf/compression";
import { STATIC_ROUTES } from "@/lib/static-home/registry";
import type { StaticRouteMode } from "@/lib/static-home/settings";

/**
 * K1 — BULGU TOPLAYICI `speedCollector` (alan `hiz`). Sözleşme tipleri SP1 `src/lib/site-issues/types.ts`'ten KOPYALANIR
 * (import edilmez); Kokpit kaydı `src/lib/site-issues/collectors.ts` (bağdaştırıcı: site-issues/adapters.ts). Bulgular:
 *  - statik HTML bütçe aşımı (gzip ≤80 KB / ham ≤360 KB),
 *  - PSI puanında 5 puandan fazla düşüş (cihaz başına, son iki koşu),
 *  - açık statik sayfanın normal sürüme (yedek) düşmesi → öneri `static_refresh`,
 *  - sıkıştırmada Brotli yok (bilgi; operasyon onayı gerektirir → yalnız elle).
 * Her bulgunun teknik olmayan Türkçe `explain` cümlesi vardır. `scanned` yalnız gerçekten veri olan yolları içerir
 * (süreç yeni başladıysa bellek durumu boştur; o yolların açık bulguları yanlışlıkla "doğrulandı" sayılmaz).
 */
export type IssueSeverity = "kritik" | "uyari" | "bilgi";
export type IssueInput = {
  area: "hiz";
  url: string;
  code: string;
  severity: IssueSeverity;
  title: string;
  explain: string;
  evidence?: Record<string, unknown>;
  proposal?: { kind: string; target: { url: string } } | null;
  href?: string;
  manualOnly?: boolean;
};
export type CollectorResult = { area: "hiz"; scanned: string[] | "all"; issues: IssueInput[] };
export type IssueCollector = { id: string; area: "hiz"; label: string; collect(): Promise<CollectorResult> };

export type SpeedRouteInput = {
  id: string;
  path: string;
  label: string;
  mode: StaticRouteMode;
  lastRenderAt: number | null;
  lastStatic: boolean | null;
  rawBytes: number | null;
  gzipBytes: number | null;
  lastFallbackReason: string | null;
};
export type SpeedLabInput = { day: string; path: string; device: "mobile" | "desktop"; source: string; score: number | null; created_at?: string };
export type SpeedInput = { routes: SpeedRouteInput[]; labRuns: SpeedLabInput[]; compression: CompressionResult | null };

const HIZ_HREF = "/admin/site/hiz";
const LAB_HREF = "/admin/site/hiz/lab";
const DEVICE_TR = { mobile: "Mobil", desktop: "Masaüstü" } as const;
const kb = (b: number) => `${(b / 1024).toLocaleString("tr-TR", { maximumFractionDigits: 0 })} KB`;

/** SAF: girdiden bulgular + taranan yollar. */
export function speedIssues(input: SpeedInput): { issues: IssueInput[]; scanned: string[] } {
  const issues: IssueInput[] = [];
  const scanned = new Set<string>();

  for (const r of input.routes) {
    if (r.lastRenderAt === null) continue;
    scanned.add(r.path);
    if (r.mode === "on" && r.lastStatic === false) {
      issues.push({
        area: "hiz",
        url: r.path,
        code: "static_fallback",
        severity: "uyari",
        title: `${r.label} hızlı sürüm yerine normal sürümle sunuluyor`,
        explain: `${r.path} sayfası hafif (JS'siz) sürümü üretilemediği için ağır sürümle açılıyor; ziyaretçi sayfayı daha geç görür.`,
        evidence: { reason: r.lastFallbackReason },
        proposal: { kind: "static_refresh", target: { url: r.path } },
        href: HIZ_HREF,
      });
    }
    // Bütçe ana sayfa içindir (F1); yalnız statik çıktı ölçülür (yedek HTML Next betikleri taşır, ayrı bulgudur).
    if (r.id === "home" && r.lastStatic === true && r.rawBytes !== null && r.gzipBytes !== null) {
      const v = checkStaticHtmlBudget({ rawBytes: r.rawBytes, gzipBytes: r.gzipBytes });
      if (v.length) {
        issues.push({
          area: "hiz",
          url: r.path,
          code: "static_html_budget",
          severity: "uyari",
          title: "Ana sayfa boyutu hız bütçesini aşıyor",
          explain: `Ana sayfa ilk açılışta ${kb(r.gzipBytes)} indiriliyor (sınır ${STATIC_HTML_BUDGET.gzipKb} KB); yavaş bağlantıda sayfa geç açılır.`,
          evidence: { rawBytes: r.rawBytes, gzipBytes: r.gzipBytes, violations: v.map((x) => x.message) },
          href: HIZ_HREF,
          manualOnly: true,
        });
      }
    }
  }

  // PSI: yol|cihaz başına en yeni iki puanlı koşu.
  const groups = new Map<string, SpeedLabInput[]>();
  for (const run of input.labRuns) {
    if (run.source !== "psi" || run.score === null) continue;
    const k = `${run.path}|${run.device}`;
    const list = groups.get(k) ?? [];
    list.push(run);
    groups.set(k, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (b.day + (b.created_at ?? "")).localeCompare(a.day + (a.created_at ?? "")));
    const [latest, prev] = list;
    if (!latest) continue;
    scanned.add(latest.path);
    if (!prev || latest.score === null || prev.score === null) continue;
    const drop = prev.score - latest.score;
    if (drop > PSI_DROP_THRESHOLD) {
      issues.push({
        area: "hiz",
        url: latest.path,
        code: `psi_drop_${latest.device}`,
        severity: "uyari",
        title: `${DEVICE_TR[latest.device]} hız puanı düştü`,
        explain: `${latest.path} için ${DEVICE_TR[latest.device].toLocaleLowerCase("tr-TR")} hız puanı ${prev.score} iken ${latest.score} oldu; son değişiklik sayfayı yavaşlatmış olabilir.`,
        evidence: { prev: { day: prev.day, score: prev.score }, latest: { day: latest.day, score: latest.score } },
        href: LAB_HREF,
        manualOnly: true,
      });
    }
  }

  const c = input.compression;
  if (c && c.status !== null) {
    scanned.add("/");
    if (c.encoding !== "br" && c.encoding !== "zstd") {
      issues.push({
        area: "hiz",
        url: "/",
        code: "compression_no_br",
        severity: "bilgi",
        title: "Sayfalar Brotli ile sıkıştırılmıyor",
        explain:
          c.encoding === "gzip"
            ? "Sayfalar gzip ile gönderiliyor; Brotli açılırsa aynı sayfa yaklaşık %15 daha küçük iner (sunucu ayarı, operasyon onayı gerekir)."
            : "Sayfalar sıkıştırılmadan gönderiliyor; sıkıştırma açılırsa sayfalar birkaç kat küçük iner (sunucu ayarı).",
        evidence: { encoding: c.encoding, status: c.status },
        href: HIZ_HREF,
        manualOnly: true,
      });
    }
  }

  return { issues, scanned: [...scanned] };
}

export type SpeedCollectorDeps = { gather: () => Promise<SpeedInput> };

export function createSpeedCollector(deps: SpeedCollectorDeps): IssueCollector {
  return {
    id: "speed",
    area: "hiz",
    label: "Hız",
    async collect() {
      const { issues, scanned } = speedIssues(await deps.gather());
      return { area: "hiz", scanned, issues };
    },
  };
}

/** Gerçek veri: bellek durumu (bu süreç), son 30 günün laboratuvar koşuları, canlı sıkıştırma öz testi. */
export const speedCollector: IssueCollector = createSpeedCollector({
  gather: async () => {
    const [render, store, compression, settings, clock, base] = await Promise.all([
      import("@/lib/static-home/render"),
      import("@/lib/perf/store"),
      import("@/lib/perf/compression"),
      import("@/lib/static-home/settings"),
      import("@/lib/clock"),
      import("@/lib/public-redirect"),
    ]);
    const [toggles, lab, comp] = await Promise.all([
      store.readStaticToggles().catch(() => ({})),
      store.listLabRuns({ sinceDay: store.trDay(clock.now() - 30 * clock.DAY_MS), limit: 400 }).catch(() => ({ rows: [], tableMissing: true })),
      compression.selfTestCompression(base.publicOrigin()),
    ]);
    const snaps = new Map(render.staticSnapshots().map((s) => [s.id, s.stats]));
    return {
      routes: STATIC_ROUTES.map((r) => {
        const s = snaps.get(r.id);
        return {
          id: r.id,
          path: r.path,
          label: r.label,
          mode: settings.staticRouteMode(r, toggles),
          lastRenderAt: s?.lastRenderAt ?? null,
          lastStatic: s?.lastStatic ?? null,
          rawBytes: s?.rawBytes ?? null,
          gzipBytes: s?.gzipBytes ?? null,
          lastFallbackReason: s?.lastFallbackReason ?? null,
        };
      }),
      labRuns: lab.rows,
      compression: comp,
    };
  },
});
