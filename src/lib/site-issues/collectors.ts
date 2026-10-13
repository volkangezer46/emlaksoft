import "server-only";
import { after } from "next/server";
import { now } from "@/lib/clock";
import { googleCollector } from "@/lib/google/collector";
import { measureCollector } from "@/lib/measure/collector";
import { readAuditLatest, readSeoSettingsFresh, type AuditRun } from "@/lib/seo/store";
import { speedCollector } from "@/lib/static-home/collector";
import { GOOGLE_ADS_COLLECTOR, GOOGLE_GSC_COLLECTOR, MEASURE_COLLECTOR, SPEED_COLLECTOR, googleResultToCollector, measureResultToCollector, speedResultToCollector } from "./adapters";
import { BUILTIN_SEO_COLLECTOR, auditRunToCollectorResult } from "./builtin-seo-latest";
import { recordOptimizerAction, upsertCollectorResult } from "./store";
import type { CollectorResult, IssueArea, IssueCollector, OptimizerSource, SyncMode } from "./types";

/**
 * TOPLAYICI KAYDI (K1; S4 dikişi tamam). Paketlerin toplayıcıları `adapters.ts` ile Kokpit biçimine çevrilip burada
 * kaydedilir: SEO robotu (seo), Search Console (seo), Hız (hiz), Ölçüm sağlığı (olcum), Google Ads (reklam).
 * Kokpit kutucuğu toplayıcısı olmayan alanı "Henüz bağlı değil" gösterir.
 */

const nowIso = () => new Date(now()).toISOString();

/** "Siteyi şimdi denetle": son robot koşusu bundan yeniyse robot yeniden çalıştırılmaz (ağır tarama + IndexNow). */
export const SEO_AUDIT_FRESH_MS = 15 * 60_000;

/**
 * SEO robotu: "cron" modunda son koşuyu okur (gece robotu az önce çalıştı); "audit" modunda son koşu 15 dk'dan eskiyse
 * robotu çalıştırır. SEO ayarları kural önerileri (gerçek açıklama metni) için okunur; okunamazsa öneri üretilmez.
 */
export const seoIssueCollector: IssueCollector = {
  id: BUILTIN_SEO_COLLECTOR,
  area: "seo",
  label: "SEO robotu",
  async run(ctx) {
    let run: AuditRun | null = await readAuditLatest();
    if (ctx.mode === "audit" && (!run || now() - Date.parse(run.at) > SEO_AUDIT_FRESH_MS)) {
      const { executeSeoRobot } = await import("@/lib/seo/robot");
      run = (await executeSeoRobot("manual")).run;
    }
    const settings = run ? await readSeoSettingsFresh().catch(() => null) : null;
    return auditRunToCollectorResult(run, settings);
  },
};

export const speedIssueCollector: IssueCollector = {
  id: SPEED_COLLECTOR,
  area: "hiz",
  label: "Hız",
  run: async () => speedResultToCollector(await speedCollector.collect(), nowIso()),
};

export const measureIssueCollector: IssueCollector = {
  id: MEASURE_COLLECTOR,
  area: "olcum",
  label: "Ölçüm sağlığı",
  run: async () => measureResultToCollector(await measureCollector.collect(), nowIso()),
};

/** Google tabloları iki toplayıcı (Search Console, Ads) için tek kez okunur (aynı denetim turunda 30 sn paylaşılır). */
let googleMemo: { at: number; p: ReturnType<typeof googleCollector.collect> } | null = null;
function loadGoogle(): ReturnType<typeof googleCollector.collect> {
  const t = now();
  if (!googleMemo || t - googleMemo.at > 30_000) {
    const p = googleCollector.collect();
    googleMemo = { at: t, p };
    p.catch(() => {
      if (googleMemo?.p === p) googleMemo = null;
    });
  }
  return googleMemo.p;
}

export const googleGscIssueCollector: IssueCollector = {
  id: GOOGLE_GSC_COLLECTOR,
  area: "seo",
  label: "Google Search Console",
  run: async () => googleResultToCollector(await loadGoogle(), "seo", nowIso()),
};

export const googleAdsIssueCollector: IssueCollector = {
  id: GOOGLE_ADS_COLLECTOR,
  area: "reklam",
  label: "Google Ads",
  run: async () => googleResultToCollector(await loadGoogle(), "reklam", nowIso()),
};

export const COLLECTORS: readonly IssueCollector[] = [seoIssueCollector, googleGscIssueCollector, speedIssueCollector, measureIssueCollector, googleAdsIssueCollector];

/** Kutucukların kurulum/ayrıntı ekranları (her bağlantı GERÇEK bir sayfaya gider). */
export const AREA_META: Record<Exclude<IssueArea, "icerik">, { label: string; setupHref: string; setupLabel: string }> = {
  seo: { label: "SEO", setupHref: "/admin/seo", setupLabel: "SEO merkezi" },
  hiz: { label: "Hız", setupHref: "/admin/site/hiz", setupLabel: "Hız" },
  olcum: { label: "Ölçüm", setupHref: "/admin/site/reklam", setupLabel: "Huni ve ziyaret sayacı" },
  reklam: { label: "Reklam", setupHref: "/admin/site/baglantilar", setupLabel: "Google bağlantıları" },
};

export const collectorsFor = (area: IssueArea) => COLLECTORS.filter((c) => c.area === area);

/** "Siteyi şimdi denetle" toplam bütçesi: aşılırsa kalan iş yanıttan sonra `after()` ile tamamlanır. */
export const AUDIT_BUDGET_MS = 50_000;

export type SyncStep = {
  collector: string;
  label: string;
  area: IssueArea;
  ok: boolean;
  /** Arka planda sürüyor (bütçe aşıldı). */
  pending?: boolean;
  message: string;
  ms: number;
  counts?: { yeni: number; gorulen: number; dogrulandi: number; yenidenAcildi: number };
};

async function runOne(c: IssueCollector, mode: SyncMode, source: OptimizerSource, actor: string | null): Promise<SyncStep> {
  const started = now();
  const base = { collector: c.id, label: c.label, area: c.area };
  let result: CollectorResult;
  try {
    result = await c.run({ mode });
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 160) : "toplayıcı hata verdi";
    await recordOptimizerAction({ kind: "sync", source, target: c.id, status: "hata", after: { message }, actor });
    return { ...base, ok: false, message: `Okunamadı: ${message}`, ms: now() - started };
  }
  const up = await upsertCollectorResult(result);
  const ms = now() - started;
  if (!up.ok) {
    return { ...base, ok: false, message: up.missing ? "Kokpit tabloları henüz kurulmadı (kurulum bekliyor)." : `Kaydedilemedi: ${up.error}`, ms };
  }
  await recordOptimizerAction({
    kind: "sync",
    source,
    target: c.id,
    status: "ok",
    after: { counts: up.counts, issues: result.issues.length, sourceAt: result.sourceAt ?? null, note: result.note ?? null, ms },
    actor,
  });
  const { yeni, gorulen, dogrulandi, yenidenAcildi } = up.counts;
  const parts = [`${result.issues.length} bulgu`, yeni ? `${yeni} yeni` : "", dogrulandi ? `${dogrulandi} düzelmiş` : "", yenidenAcildi ? `${yenidenAcildi} yeniden açıldı` : ""].filter(Boolean);
  return { ...base, ok: true, message: result.note ? `${result.note} ${parts.join(" · ")}` : parts.join(" · "), ms, counts: { yeni, gorulen, dogrulandi, yenidenAcildi } };
}

/**
 * Toplayıcıları `Promise.allSettled` ile paralel çalıştırır ve sonuçlarını kuyruğa işler. "audit" modunda toplam
 * 50 sn bütçe vardır: süre aşılınca yanıt bitmeyen adımları "arka planda sürüyor" diye döner, iş `after()` ile tamamlanır.
 */
export async function syncSiteIssues(
  mode: SyncMode,
  opts: { only?: readonly string[]; source?: OptimizerSource; actor?: string | null; budgetMs?: number } = {},
): Promise<SyncStep[]> {
  const list = COLLECTORS.filter((c) => !opts.only || opts.only.includes(c.id));
  const source = opts.source ?? (mode === "cron" ? "cron" : "staff");
  const done = new Map<string, SyncStep>();
  const jobs = list.map((c) => runOne(c, mode, source, opts.actor ?? null).then((s) => (done.set(c.id, s), s)));
  const all = Promise.allSettled(jobs);
  if (mode !== "audit") return settledSteps(list, await all);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), opts.budgetMs ?? AUDIT_BUDGET_MS);
  });
  const first = await Promise.race([all, timeout]);
  clearTimeout(timer);
  if (first !== "timeout") return settledSteps(list, first);

  // Bütçe doldu: biten adımlar gösterilir, kalanlar yanıttan sonra tamamlanır (kendi kayıtlarını yazar).
  after(async () => {
    await all;
  });
  return list.map(
    (c) => done.get(c.id) ?? { collector: c.id, label: c.label, area: c.area, ok: true, pending: true, message: "Süre doldu; arka planda tamamlanıyor.", ms: opts.budgetMs ?? AUDIT_BUDGET_MS },
  );
}

function settledSteps(list: readonly IssueCollector[], settled: PromiseSettledResult<SyncStep>[]): SyncStep[] {
  return settled.map((s, i) =>
    s.status === "fulfilled" ? s.value : { collector: list[i]!.id, label: list[i]!.label, area: list[i]!.area, ok: false, message: "Beklenmeyen hata.", ms: 0 },
  );
}
