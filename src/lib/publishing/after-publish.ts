import { createHash } from "node:crypto";
import { getBaseUrl } from "@/lib/base-url";
import { now, trParts } from "@/lib/clock";
import { fetchOwnOriginInspect, readExternalText } from "@/lib/external-fetch";
import { logPlatformActivity } from "@/lib/platform-activity";
import { seoAfterPublishHook } from "@/lib/seo/after-publish-hook";
import { fromSeoHook, fromStaticHook } from "@/lib/site-issues/adapters";
import { readActions, recordOptimizerAction } from "@/lib/site-issues/store";
import { staticAfterPublishHook } from "@/lib/static-home/after-publish-hook";
import type { AfterPublishEvent, AfterPublishHook, AfterPublishHookResult } from "@/lib/site-issues/types";

/**
 * YAYIN SONRASI ZİNCİRİ (K3): her başarılı yayın, geri dönüş, varsayılana dönüş, yayından kaldırma ve toplu yayından sonra HOOKS `order` sırasıyla çalışır.
 * Her kanca try/catch + 10 sn zaman aşımıyla yalıtılır; biri hata verse de sonrakiler sürer ve YAYIN SONUCU ASLA
 * etkilenmez (`runAfterPublish` hiçbir durumda fırlatmaz). Sonuç `site_optimizer_actions` (kind "after_publish") ve
 * denetim izine (`publishing.after_publish`) yazılır.
 * Çağrı: server action'da yazımdan önce `captureLiveDigests` (taban), başarılı yayından sonra
 * `afterSafe(() => runAfterPublish(...), "yayın sonrası zinciri")`; cron'da yazımdan önce `createBaselineRecorder`
 * tabanı + `await` + süre sınırı.
 * Yerleşik kanca `verify` (order 20); paket kancaları (statik tazeleme 10, SEO 30) HOOKS listesindedir.
 */

export const HOOK_TIMEOUT_MS = 10_000;
const VERIFY_MAX_PATHS = 5;
const VERIFY_FETCH_TIMEOUT_MS = 6_000;
/** Yayın öncesi taban yayını bekletir: kısa tutulur. */
const BASELINE_FETCH_TIMEOUT_MS = 2_500;
const VERIFY_MAX_BYTES = 1_500_000;

const pad = (n: number) => String(n).padStart(2, "0");
/** Türkiye saatiyle ss:dd:sn (clock yardımcıları; Date.now yok). */
export function trClock(ms: number): string {
  const p = trParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(Math.floor((ms / 1000) % 60))}`;
}

/**
 * Gövde özeti: istekten isteğe değişen parçalar (CSP nonce, betik içerikleri, derleme kimliği) atılır; yalnız görünen
 * işaretleme özetlenir. Yayın gerçekten yansıdıysa özet yayın öncesinden farklı olur. Sınır: sayfada zamana bağlı
 * görünür içerik varsa özet yayından bağımsız da değişebilir.
 */
export function bodyDigest(html: string): string {
  const stable = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\snonce="[^"]*"/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(stable).digest("hex").slice(0, 32);
}

export type VerifyPath = { path: string; status: number; digest: string | null; changed: boolean | null };

type FetchPage = (path: string) => Promise<{ status: number; body: string } | null>;

type VerifyDeps = {
  fetchPage: FetchPage;
  nowMs(): number;
};

async function fetchOwnPage(path: string, timeoutMs = VERIFY_FETCH_TIMEOUT_MS): Promise<{ status: number; body: string } | null> {
  try {
    const res = await fetchOwnOriginInspect(
      new URL(path, getBaseUrl()).toString(),
      { method: "GET", cache: "no-store", headers: { "User-Agent": "EmlakSoftYayinDogrulama/1.0", Accept: "text/html" } },
      { timeoutMs },
    );
    let body = "";
    try {
      body = await readExternalText(res, VERIFY_MAX_BYTES);
    } catch {
      body = "";
    }
    return { status: res.status, body };
  } catch {
    return null;
  }
}

/**
 * YAYIN ÖNCESİ TABAN: canlı yolların gövde özeti, yayın yazımından HEMEN ÖNCE alınır ve olaya `beforeDigests` olarak
 * eklenir. Kısa süre sınırlı (yayını bekletmesin); alınamayan yol tabansız kalır ve doğrulama bunu dürüstçe söyler.
 * ASLA fırlatmaz.
 */
export async function captureLiveDigests(paths: readonly string[], fetchPage: FetchPage = (p) => fetchOwnPage(p, BASELINE_FETCH_TIMEOUT_MS)): Promise<Record<string, string>> {
  const uniq = [...new Set(paths)].slice(0, VERIFY_MAX_PATHS);
  const pairs = await Promise.all(
    uniq.map(async (path) => {
      try {
        const page = await fetchPage(path);
        return page && page.status === 200 ? ([path, bodyDigest(page.body)] as const) : null;
      } catch {
        return null;
      }
    }),
  );
  return Object.fromEntries(pairs.filter((x): x is readonly [string, string] => x !== null));
}

/** Cron koşusu boyunca taban yakalamaya harcanabilecek en çok süre (maxDuration 120 sn; zincir bütçesi ayrı 30 sn). */
export const SCHEDULED_BASELINE_BUDGET_MS = 20_000;
/** Tek yüzeyin taban yakalaması için kesin üst sınır (yol başına 2,5 sn zaman aşımının üstünde güvenlik payı). */
const SCHEDULED_BASELINE_HARD_CAP_MS = BASELINE_FETCH_TIMEOUT_MS + 1_000;

export type BaselineRecorder = {
  /** Yüzeyin canlı yollarının tabanını yazımdan HEMEN önce alır (yüzey başına koşuda bir kez). ASLA fırlatmaz. */
  before(surface: string, paths: readonly string[]): Promise<void>;
  /** Yakalanan taban; hiç denenmediyse (bütçe bitti) undefined → doğrulama tabansız olduğunu söyler. */
  get(surface: string): Record<string, string> | undefined;
};

/**
 * ZAMANLI YAYIN TABANI (cron): her zamanlı kaydın yüzeyi için canlı yolların gövde özeti, yayın/geri dönüş yazımından
 * HEMEN önce alınır (elle yayındaki `captureLiveDigests` ile aynı özet). Yüzey başına koşuda yalnız İLK yazımdan önce
 * alınır (koşunun net değişikliği ölçülür). Süre güvenliği: yol başına 2,5 sn, yüzey başına kesin üst sınır ve koşu
 * toplam bütçesi; bütçe bitince taban alınmaz (yayın asla bekletilmez/engellenmez, doğrulama "tabansız" der).
 */
export function createBaselineRecorder(
  opts: {
    capture?: (paths: readonly string[]) => Promise<Record<string, string>>;
    budgetMs?: number;
    hardCapMs?: number;
    nowMs?: () => number;
  } = {},
): BaselineRecorder {
  const capture = opts.capture ?? ((paths) => captureLiveDigests(paths));
  const budget = opts.budgetMs ?? SCHEDULED_BASELINE_BUDGET_MS;
  const hardCap = opts.hardCapMs ?? SCHEDULED_BASELINE_HARD_CAP_MS;
  const clock = opts.nowMs ?? now;
  const baselines = new Map<string, Record<string, string>>();
  let spent = 0;
  return {
    async before(surface, paths) {
      if (baselines.has(surface) || !paths.length || spent >= budget) return;
      const started = clock();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const digests = await Promise.race([
          Promise.resolve().then(() => capture(paths)),
          new Promise<Record<string, string>>((resolve) => {
            timer = setTimeout(() => resolve({}), Math.min(hardCap, budget - spent));
          }),
        ]);
        baselines.set(surface, digests);
      } catch {
        baselines.set(surface, {});
      } finally {
        clearTimeout(timer);
        spent += Math.max(0, clock() - started);
      }
    },
    get: (surface) => baselines.get(surface),
  };
}

type VerifyDetail = { paths?: VerifyPath[]; baseline?: Record<string, string> };

/**
 * "Tekrar dene" için taban: aynı yüzeyin SON doğrulamasının kaydettiği yayın öncesi taban (o yayının gerçek öncesi).
 * Başka yüzeyin doğrulama özeti ya da sonraki bir canlı özet taban olarak KULLANILMAZ.
 */
export async function lastBaseline(surface: string): Promise<Record<string, string>> {
  try {
    const r = await readActions({ kinds: ["after_publish"], target: surface, limit: 5 });
    for (const a of r.data) {
      const verify = ((a.after as { hooks?: { id: string; detail?: VerifyDetail }[] } | null)?.hooks ?? []).find((h) => h.id === "verify");
      if (verify) return verify.detail?.baseline ?? {};
    }
  } catch {
    /* taban okunamazsa tabansız doğrulama */
  }
  return {};
}

const defaultVerifyDeps: VerifyDeps = { fetchPage: (p) => fetchOwnPage(p), nowMs: now };

/**
 * Canlı doğrulama: her yol HTTP 200 dönmeli ve en az bir yolun gövde özeti yayın öncesi tabandan (`beforeDigests`)
 * farklı olmalı. Taban yoksa "doğrulandı" DENMEZ; yalnız HTTP 200 olduğu, karşılaştırma yapılamadığı söylenir.
 */
export function createVerifyHook(deps: VerifyDeps = defaultVerifyDeps): AfterPublishHook {
  return {
    id: "verify",
    order: 20,
    async run(ev) {
      const paths = [...new Set(ev.livePaths)].slice(0, VERIFY_MAX_PATHS);
      if (!paths.length) return { ok: true, message: "Doğrulanacak herkese açık yol yok." };
      const before = ev.beforeDigests ?? {};
      const results: VerifyPath[] = await Promise.all(
        paths.map(async (path) => {
          const page = await deps.fetchPage(path);
          if (!page) return { path, status: 0, digest: null, changed: null };
          const digest = page.status === 200 ? bodyDigest(page.body) : null;
          const prev = before[path];
          return { path, status: page.status, digest, changed: digest && prev ? digest !== prev : null };
        }),
      );
      const detail = { paths: results, baseline: before };
      // Yayından kaldırma: yol artık 404/410 dönmeli.
      if (ev.kind === "unpublish") {
        const gone = results.every((r) => r.status === 404 || r.status === 410);
        return { ok: gone, message: gone ? `Canlıdan kaldırıldı ${trClock(deps.nowMs())}` : "Henüz yansımadı — tekrar dene", detail };
      }
      if (!results.every((r) => r.status === 200)) return { ok: false, message: "Henüz yansımadı — tekrar dene", detail };
      const known = results.filter((r) => r.changed !== null);
      if (known.length === 0) return { ok: true, message: `HTTP 200 (karşılaştırma tabanı yok) ${trClock(deps.nowMs())}`, detail };
      const ok = known.some((r) => r.changed);
      return { ok, message: ok ? `Canlıda doğrulandı ${trClock(deps.nowMs())}` : "Henüz yansımadı — tekrar dene", detail };
    },
  };
}

/**
 * Kayıtlı kancalar (S2/S3 dikişi tamam): statik tazeleme (10) → canlı doğrulama (20) → SEO: IndexNow + yeniden denetim (30).
 * Paket kancaları kendi tip kopyalarıyla yazıldı; `site-issues/adapters.ts` Kokpit olayına çevirir.
 */
export const HOOKS: AfterPublishHook[] = [
  fromStaticHook(staticAfterPublishHook),
  createVerifyHook(),
  fromSeoHook(seoAfterPublishHook, () => new Date(now()).toISOString()),
];

export type HookRun = { id: string; order: number; ok: boolean; message: string; ms: number; detail?: Record<string, unknown> };
export type AfterPublishRunResult = { hooks: HookRun[]; ok: boolean };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`zaman aşımı (${Math.round(ms / 1000)} sn)`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

type RunDeps = {
  hooks?: readonly AfterPublishHook[];
  record?: typeof recordOptimizerAction;
  log?: typeof logPlatformActivity;
  timeoutMs?: number;
};

/** Zinciri çalıştırır; ASLA fırlatmaz. */
export async function runAfterPublish(ev: AfterPublishEvent, deps: RunDeps = {}): Promise<AfterPublishRunResult> {
  const hooks = [...(deps.hooks ?? HOOKS)].sort((a, b) => a.order - b.order);
  const out: HookRun[] = [];
  for (const h of hooks) {
    const started = now();
    let r: AfterPublishHookResult;
    try {
      r = await withTimeout(Promise.resolve().then(() => h.run(ev)), deps.timeoutMs ?? HOOK_TIMEOUT_MS);
    } catch (e) {
      r = { ok: false, message: `Kanca hata verdi: ${e instanceof Error ? e.message.slice(0, 120) : "bilinmiyor"}` };
    }
    out.push({ id: h.id, order: h.order, ok: r.ok, message: r.message, ms: now() - started, ...(r.detail ? { detail: r.detail } : {}) });
  }
  const ok = out.every((h) => h.ok);
  try {
    await (deps.record ?? recordOptimizerAction)({
      kind: "after_publish",
      source: ev.source,
      target: ev.surface,
      status: ok ? "ok" : "kismi",
      before: { kind: ev.kind, livePaths: ev.livePaths },
      after: { hooks: out },
      publishRef: ev.publishRef ?? null,
      actor: ev.actorId,
    });
  } catch {
    /* kayıt yazılamasa da zincir tamamlandı */
  }
  try {
    await (deps.log ?? logPlatformActivity)({
      actorId: ev.actorId,
      action: "publishing.after_publish",
      entityType: ev.surface,
      entityId: ev.publishRef ?? null,
      meta: { kind: ev.kind, source: ev.source, ok, hooks: out.map((h) => ({ id: h.id, ok: h.ok, message: h.message })) },
    });
  } catch {
    /* denetim izi yazılamasa da yayın etkilenmez */
  }
  return { hooks: out, ok };
}

/** Kokpit/Yayın masası rozeti için: yüzey başına son doğrulama. */
export type VerifyBadge = { ok: boolean; message: string; at: string };

export async function readVerifyBadges(): Promise<Record<string, VerifyBadge>> {
  const r = await readActions({ kinds: ["after_publish"], limit: 40 });
  const out: Record<string, VerifyBadge> = {};
  for (const a of r.data) {
    if (out[a.target]) continue;
    const v = ((a.after as { hooks?: HookRun[] } | null)?.hooks ?? []).find((h) => h.id === "verify");
    if (v) out[a.target] = { ok: v.ok, message: v.message, at: a.created_at };
  }
  return out;
}
