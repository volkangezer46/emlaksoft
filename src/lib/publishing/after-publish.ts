import { createHash } from "node:crypto";
import { getBaseUrl } from "@/lib/base-url";
import { now, trParts } from "@/lib/clock";
import { fetchOwnOriginInspect, readExternalText } from "@/lib/external-fetch";
import { logPlatformActivity } from "@/lib/platform-activity";
import { readActions, recordOptimizerAction } from "@/lib/site-issues/store";
import type { AfterPublishEvent, AfterPublishHook, AfterPublishHookResult } from "@/lib/site-issues/types";

/**
 * YAYIN SONRASI ZİNCİRİ (K3): her başarılı yayın, geri dönüş ve toplu yayından sonra HOOKS `order` sırasıyla çalışır.
 * Her kanca try/catch + 10 sn zaman aşımıyla yalıtılır; biri hata verse de sonrakiler sürer ve YAYIN SONUCU ASLA
 * etkilenmez (`runAfterPublish` hiçbir durumda fırlatmaz). Sonuç `site_optimizer_actions` (kind "after_publish") ve
 * denetim izine (`publishing.after_publish`) yazılır.
 * Çağrı: server action'da başarılı yayından sonra tek satır `after(() => runAfterPublish(...))`; cron'da `await` + süre sınırı.
 * Yerleşik kanca `verify` (order 20). Diğer paketler kendi kancalarını (statik tazeleme order 10, IndexNow ...) S2/S4
 * dikişinde HOOKS'a ekler.
 */

export const HOOK_TIMEOUT_MS = 10_000;
const VERIFY_MAX_PATHS = 5;
const VERIFY_FETCH_TIMEOUT_MS = 6_000;
const VERIFY_MAX_BYTES = 1_500_000;

const pad = (n: number) => String(n).padStart(2, "0");
/** Türkiye saatiyle ss:dd:sn (clock yardımcıları; Date.now yok). */
export function trClock(ms: number): string {
  const p = trParts(ms);
  return `${pad(p.hour)}:${pad(p.minute)}:${pad(Math.floor((ms / 1000) % 60))}`;
}

/**
 * Gövde özeti: istekten isteğe değişen parçalar (CSP nonce, betik içerikleri, derleme kimliği) atılır; yalnız görünen
 * işaretleme özetlenir. Yayın gerçekten yansıdıysa özet yayın öncesinden farklı olur.
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

type VerifyDeps = {
  fetchPage(path: string): Promise<{ status: number; body: string } | null>;
  previousDigests(surface: string): Promise<Record<string, string>>;
  nowMs(): number;
};

async function fetchOwnPage(path: string): Promise<{ status: number; body: string } | null> {
  try {
    const res = await fetchOwnOriginInspect(
      new URL(path, getBaseUrl()).toString(),
      { method: "GET", cache: "no-store", headers: { "User-Agent": "EmlakSoftYayinDogrulama/1.0", Accept: "text/html" } },
      { timeoutMs: VERIFY_FETCH_TIMEOUT_MS },
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

type VerifyDetail = { paths?: VerifyPath[]; baseline?: Record<string, string> };

/**
 * Yayın öncesi canlının özeti yerine geçen taban: aynı yüzeyin son doğrulaması başarılıysa onun özetleri (o anki canlı);
 * "henüz yansımadı" ise onun kullandığı taban (tekrar denemede karşılaştırma yine yayın öncesine göre yapılır).
 */
async function lastDigests(surface: string): Promise<Record<string, string>> {
  const r = await readActions({ kinds: ["after_publish"], limit: 20 });
  const hit = r.data.find((a) => a.target === surface);
  const verify = ((hit?.after as { hooks?: { id: string; ok: boolean; detail?: VerifyDetail }[] } | null)?.hooks ?? []).find((h) => h.id === "verify");
  if (!verify) return {};
  if (!verify.ok && verify.detail?.baseline) return verify.detail.baseline;
  return Object.fromEntries((verify.detail?.paths ?? []).filter((p) => p.digest).map((p) => [p.path, p.digest!]));
}

const defaultVerifyDeps: VerifyDeps = { fetchPage: fetchOwnPage, previousDigests: lastDigests, nowMs: now };

/** Canlı doğrulama: her yol HTTP 200 dönmeli ve gövde özeti yayın öncesinden farklı olmalı. */
export function createVerifyHook(deps: VerifyDeps = defaultVerifyDeps): AfterPublishHook {
  return {
    id: "verify",
    order: 20,
    async run(ev) {
      const paths = [...new Set(ev.livePaths)].slice(0, VERIFY_MAX_PATHS);
      if (!paths.length) return { ok: true, message: "Doğrulanacak herkese açık yol yok." };
      const before = ev.beforeDigests ?? (await deps.previousDigests(ev.surface).catch(() => ({}) as Record<string, string>));
      const results: VerifyPath[] = await Promise.all(
        paths.map(async (path) => {
          const page = await deps.fetchPage(path);
          if (!page) return { path, status: 0, digest: null, changed: null };
          const digest = page.status === 200 ? bodyDigest(page.body) : null;
          const prev = before[path];
          return { path, status: page.status, digest, changed: digest && prev ? digest !== prev : null };
        }),
      );
      // Önceki özet yoksa yalnız HTTP 200 aranır (ilk doğrulama); varsa en az bir yol değişmiş olmalı.
      const all200 = results.every((r) => r.status === 200);
      const known = results.filter((r) => r.changed !== null);
      const reflected = known.length === 0 || known.some((r) => r.changed);
      const ok = all200 && reflected;
      return {
        ok,
        message: ok ? `Canlıda doğrulandı ${trClock(deps.nowMs())}` : "Henüz yansımadı — tekrar dene",
        detail: { paths: results, baseline: before },
      };
    },
  };
}

export const HOOKS: AfterPublishHook[] = [createVerifyHook()];

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
