import { formatServerTiming, serverTimingEnabled } from "../server-timing-core";

/**
 * Supabase istemcileri için korumalı `fetch` (sunucu).
 *
 * NEDEN: Canlıda sayfaların küçük bir kısmı (~1/25) 40-80 sn sürüyordu; başlık hızlı gelip gövde akışı takılıyordu.
 * Vercel logunda `app-shell;dur=64401` (kabuk modeli 64 sn) görüldü: kabuk modelindeki Supabase çağrılarından biri
 * (Auth/PostgREST) yanıt alamıyordu (donup çözülen Fluid instance'ta ölü keep-alive soketi / takılan bağlantı) ve
 * istek zaman aşımsızdı; ayrıca auth-js süreç kilidi aynı instance'taki diğer istemcileri de bu çağrının arkasına dizer.
 * Suspense ile akan bölümler (kabuk, sayfa) bu yüzden tamamlanamıyordu.
 *
 * ÇÖZÜM:
 *  - Salt-okunur istekler (GET/HEAD ve izinli salt-okunur RPC): yanıt başlığı `HEDGE_MS` içinde gelmezse AYNI istek yeni
 *    bağlantıyla paralel yinelenir (en çok `MAX_ATTEMPTS`), ilk gelen kazanır, kaybedenler iptal edilir. Ağ hatasında
 *    beklemeden yinelenir. Üst sınır `READ_DEADLINE_MS`.
 *  - Mutasyon (POST/PATCH/DELETE ...): ASLA yinelenmez (çift yazma riski); yalnız `WRITE_DEADLINE_MS` zaman aşımı.
 *  - Yavaş (> SLOW_LOG_MS) ya da yinelenen her istek tek satır uyarı olarak loglanır (yalnız yol, sorgu dizgisi yok).
 *  - `EMLAKSOFT_SERVER_TIMING=1` iken her istek `[server-timing] db-<tablo>;dur=` olarak ölçülür (bölüm ölçümü).
 */
/** Yanıt başlığı bu sürede gelmezse okuma yeni bağlantıyla yinelenir (kimlik + kabuk RPC'si küçük ve hızlı: daha kısa). */
export const HEDGE_MS = 1800;
export const HEDGE_FAST_MS = 800;
export const READ_DEADLINE_MS = 12_000;
export const WRITE_DEADLINE_MS = 25_000;
const MAX_ATTEMPTS = 3;
const SLOW_LOG_MS = 1500;

/** Yan etkisiz, yinelemesi güvenli RPC'ler (POST ama okuma). */
const SAFE_RPC = new Set(["app_shell_bootstrap"]);

type FetchFn = typeof fetch;

function pathOf(input: RequestInfo | URL): string | null {
  if (typeof input === "string" || input instanceof URL) {
    try {
      return new URL(String(input)).pathname;
    } catch {
      return null;
    }
  }
  return null;
}

export function isRetrySafe(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return true;
  if (m === "POST") {
    const rpc = /\/rest\/v1\/rpc\/([a-z0-9_]+)$/i.exec(path);
    return Boolean(rpc && SAFE_RPC.has(rpc[1]!));
  }
  return false;
}

function hedgeDelay(path: string): number {
  return path.startsWith("/auth/v1/") || path.endsWith("/rpc/app_shell_bootstrap") ? HEDGE_FAST_MS : HEDGE_MS;
}

/** `EMLAKSOFT_SERVER_TIMING=1` iken her DB isteği için `[server-timing] db-<tablo>;dur=` (yalnız tablo/RPC adı). */
function logTiming(path: string, ms: number) {
  if (!serverTimingEnabled()) return;
  const m = /\/(?:rest\/v1\/(?:rpc\/)?|auth\/v1\/)([a-z0-9_]+)/i.exec(path);
  // bitis= süreç başlangıcından ms: aynı istekteki turların art arda mı yan yana mı gittiğini gösterir.
  console.info(`[server-timing] ${formatServerTiming(`db-${m?.[1] ?? "diger"}`, ms)} bitis=${performance.now().toFixed(0)}`);
}

function logSlow(path: string, ms: number, hedged: boolean, outcome: string) {
  logTiming(path, ms);
  if (ms < SLOW_LOG_MS && !hedged) return;
  const safe = path.replace(/[^a-zA-Z0-9/_.-]/g, "").slice(0, 80);
  console.warn(`[supabase-slow] dur=${ms.toFixed(0)} hedged=${hedged ? 1 : 0} sonuc=${outcome} yol=${safe}`);
}

function withDeadline(signal: AbortSignal | null | undefined, ms: number): AbortSignal {
  const t = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, t]) : t;
}

export function createGuardedFetch(base: FetchFn = (...args) => Reflect.apply(globalThis.fetch, globalThis, args)): FetchFn {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathOf(input);
    // Request nesnesi / çözülemeyen hedef: yalnız üst sınır.
    if (path === null) return base(input, { ...init, signal: withDeadline(init?.signal, READ_DEADLINE_MS) });
    const method = (init?.method ?? "GET").toUpperCase();
    const t0 = performance.now();

    if (!isRetrySafe(method, path)) {
      try {
        const res = await base(input, { ...init, signal: withDeadline(init?.signal, WRITE_DEADLINE_MS) });
        logSlow(path, performance.now() - t0, false, String(res.status));
        return res;
      } catch (e) {
        logSlow(path, performance.now() - t0, false, "hata");
        throw e;
      }
    }

    const hedgeMs = hedgeDelay(path);
    return new Promise<Response>((resolve, reject) => {
      const ctrls: AbortController[] = [];
      let settled = false;
      let pending = 0;
      let attempts = 0;
      let lastErr: unknown;
      let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
      const parent = init?.signal ?? undefined;

      const finish = (fn: () => void, outcome: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(hedgeTimer);
        clearTimeout(deadlineTimer);
        logSlow(path, performance.now() - t0, attempts > 1, outcome);
        fn();
      };
      const scheduleHedge = () => {
        clearTimeout(hedgeTimer);
        if (attempts >= MAX_ATTEMPTS) return;
        hedgeTimer = setTimeout(() => {
          if (!settled) launch();
        }, hedgeMs);
      };
      const launch = () => {
        const c = new AbortController();
        ctrls.push(c);
        pending += 1;
        attempts += 1;
        scheduleHedge();
        const signal = parent ? AbortSignal.any([c.signal, parent]) : c.signal;
        base(input, { ...init, signal }).then(
          (res) => {
            pending -= 1;
            if (settled) {
              void res.body?.cancel().catch(() => undefined);
              return;
            }
            finish(() => {
              for (const o of ctrls) if (o !== c) o.abort();
              resolve(res);
            }, String(res.status));
          },
          (err) => {
            pending -= 1;
            lastErr = err;
            if (settled) return;
            if (parent?.aborted) return finish(() => reject(err), "iptal");
            if (attempts < MAX_ATTEMPTS) {
              // Ağ hatası: beklemeden yeni bağlantıyla yinele.
              launch();
            } else if (pending === 0) {
              finish(() => reject(err), "hata");
            }
          },
        );
      };
      const deadlineTimer = setTimeout(() => {
        for (const c of ctrls) c.abort();
        finish(() => reject(lastErr ?? new Error("Supabase isteği zaman aşımına uğradı")), "zaman-asimi");
      }, READ_DEADLINE_MS);
      launch();
    });
  }) as FetchFn;
}

/**
 * PERF-3: sunucu tarafı Supabase çağrıları İÇ ağdan (isteğe bağlı). `SUPABASE_INTERNAL_URL` (yalnız sunucu, örn.
 * `http://supabase-kong:8000`) tanımlıysa genel köke (`NEXT_PUBLIC_SUPABASE_URL`, örn. https://api.emlaksoft.com.tr)
 * giden istekler YALNIZ taşıma katmanında iç köke çevrilir: app → Traefik TLS → Kong saç tokası (genel IP) yerine
 * doğrudan Kong. İstemci URL'i genel kalır, bu yüzden:
 *  - oturum çerezi adı değişmez (`sb-<genel-alt-alan>-auth-token`, supabase-js istemci URL'inden türetir),
 *  - Storage'ın ürettiği genel / imzalı dosya bağlantıları tarayıcının erişebildiği genel kökte kalır,
 *  - JWT `iss` denetimi (verified-request.ts, NEXT_PUBLIC_SUPABASE_URL) ve GoTrue'nun yazdığı `iss` aynen kalır.
 * Tanımsız / geçersizse hiçbir şey değişmez (genel kök). İç köke BAĞLANTI KURULAMAZSA (ağ bağlı değil, ad çözülmüyor)
 * istek genel köke düşer ve iç yol 30 sn devre dışı kalır: bağlantı hiç kurulmadığı için yazma da güvenle yinelenir.
 * Tarayıcıda hiç devreye girmez (değişken NEXT_PUBLIC değil; ayrıca `window` denetimi).
 */
export type InternalSupabaseRoute = { publicBase: string; internalBase: string };

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export function internalSupabaseRoute(env: Readonly<Record<string, string | undefined>> = process.env): InternalSupabaseRoute | null {
  if (typeof window !== "undefined") return null;
  const rawInternal = env.SUPABASE_INTERNAL_URL?.trim();
  const rawPublic = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!rawInternal || !rawPublic) return null;
  try {
    const pub = new URL(rawPublic);
    const internal = new URL(rawInternal);
    if (!/^https?:$/.test(internal.protocol) || !/^https?:$/.test(pub.protocol)) return null;
    if (internal.search || internal.hash) return null;
    const publicBase = trimSlash(`${pub.origin}${pub.pathname}`);
    const internalBase = trimSlash(`${internal.origin}${internal.pathname}`);
    if (publicBase === internalBase) return null;
    return { publicBase, internalBase };
  } catch {
    return null;
  }
}

/** Genel köke giden URL'i iç köke çevirir; başka hedefe dokunmaz. */
export function toInternalUrl(href: string, route: InternalSupabaseRoute): string | null {
  if (href === route.publicBase) return route.internalBase;
  for (const sep of ["/", "?"]) {
    if (href.startsWith(route.publicBase + sep)) return route.internalBase + href.slice(route.publicBase.length);
  }
  return null;
}

const CONNECT_ERRORS = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
/** Bağlantı hiç kurulamadı mı (istek karşıya ulaşmadı; yinelemesi yazmada da güvenli). */
export function isConnectFailure(e: unknown): boolean {
  const cause = (e as { cause?: { code?: unknown; errors?: { code?: unknown }[] } } | null)?.cause;
  const codes = [cause?.code, ...(cause?.errors ?? []).map((x) => x?.code)];
  return codes.some((c) => typeof c === "string" && CONNECT_ERRORS.has(c));
}

export const INTERNAL_COOLDOWN_MS = 30_000;

export function createInternalRoutingFetch(
  base: FetchFn,
  route: InternalSupabaseRoute | null,
  clock: () => number = () => performance.now(),
): FetchFn {
  if (!route) return base;
  let downUntil = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input !== "string" && !(input instanceof URL)) return base(input, init);
    const internal = toInternalUrl(String(input), route);
    if (!internal || clock() < downUntil) return base(input, init);
    try {
      return await base(internal, init);
    } catch (e) {
      if (init?.signal?.aborted || !isConnectFailure(e)) throw e;
      downUntil = clock() + INTERNAL_COOLDOWN_MS;
      console.warn("[supabase-internal] iç köke bağlanılamadı, genel köke düşüldü (30 sn)");
      return base(input, init);
    }
  }) as FetchFn;
}

const globalFetch: FetchFn = (...args) => Reflect.apply(globalThis.fetch, globalThis, args);

/** Süreç başına tek örnek (yalnız sunucu istemcileri: supabase/{server,admin,middleware}.ts). */
export const guardedFetch: FetchFn = createGuardedFetch(createInternalRoutingFetch(globalFetch, internalSupabaseRoute()));
