import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPublicPricing } from "@/lib/billing/public-pricing";
import { extraSeatTexts } from "@/lib/billing/seat-calculator-model";
import { now } from "@/lib/clock";
import { fetchExternal } from "@/lib/external-fetch";
import { incrementStaticRev, readStaticRev, readStaticToggles } from "@/lib/perf/store";
import {
  createStaticCache,
  createWarmLock,
  mapWithConcurrency,
  type CachedPage,
  type RenderOutcome,
  type StaticCache,
} from "@/lib/static-home/cache";
import { STATIC_ROUTES, staticRouteById, type StaticRouteDef, type StaticRouteId } from "@/lib/static-home/registry";
import { STATIC_PROBE_HEADER, hasValidStaticProbe } from "@/lib/static-home/internal-token";
import { STATIC_HOME_SOURCE_HEADER } from "@/lib/static-home/request";
import { staticRouteMode } from "@/lib/static-home/settings";
import { buildStaticHome } from "@/lib/static-home/transform";

/**
 * STATİK SAYFA ÇİZİMİ (sunucu): kayıt defterindeki bir sayfanın normal Next HTML'i KENDİ sürecinden çekilir
 * (`http://127.0.0.1:$PORT<yol>`, sorgu dizesi yok; ISR önbellekli, yönetimden düzenlenen içerik aynen), Next/React
 * çalışma zamanı ayıklanır, kullanılan CSS gömülür, düz JS + adacık verisi eklenir. Dönüşüm beklenmeyen biçim görürse
 * normal Next HTML'i sunulur (öz testte `X-Static: fallback`) ve nedeni yönetim ekranında görünür.
 *
 * Önbellek süreç başına TEK örnektir (globalThis): rota işleyicisi, yönetim eylemleri ve yayın kancası aynı nesneyi
 * görür (Next her rotayı ayrı paketlese de modül durumu çoğalmaz).
 */

type Manifest = { runtime: string; islands: Record<string, string>; classTokens: string[] };
let manifest: Manifest | null = null;
let runtimeJs: string | null = null;

function publicFile(rel: string): string {
  return readFileSync(join(process.cwd(), "public", rel.replace(/^\//, "")), "utf8");
}

function loadAssets(): { manifest: Manifest; runtime: string } {
  if (!manifest || !runtimeJs) {
    manifest = JSON.parse(publicFile("statik/manifest.json")) as Manifest;
    runtimeJs = publicFile(manifest.runtime);
  }
  return { manifest, runtime: runtimeJs };
}

export function readBuiltStylesheet(href: string, nextDir = join(process.cwd(), ".next")): string | null {
  const path = href.split("?")[0];
  if (!path.startsWith("/_next/static/") || path.includes("..")) return null;
  try {
    return readFileSync(join(nextDir, "static", path.slice("/_next/static/".length)), "utf8");
  } catch {
    return null;
  }
}

/** JSON'u <script> içine güvenle gömer. */
export function jsonForScript(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/** Yalnız rotanın adacıkları (manifest sırası korunur → ana sayfa çıktısı eskisiyle birebir aynı). */
export function islandsFor(route: Pick<StaticRouteDef, "islands">, all: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(all).filter(([k]) => (route.islands as readonly string[]).includes(k)));
}

/** `</body>` öncesi: veri + çalışma zamanı betiği. Fiyat verisi yalnız fiyat/koltuk adacığı olan sayfaya girer. */
export async function bodyEndFor(route: StaticRouteDef, m: Manifest, runtime: string): Promise<string> {
  const data: Record<string, unknown> = { islands: islandsFor(route, m.islands) };
  if (route.islands.includes("pricing") || route.islands.includes("seat")) {
    const { plans, trialDays, offers, founders, efValuationCost, efLive } = await getPublicPricing();
    data.pricing = { plans, trialDays, offers, founders, extraSeats: extraSeatTexts(plans), efValuationCost, efLive };
    data.seat = { plans, offers, trialDays };
  }
  return `<script type="application/json" id="mk-static">${jsonForScript(data)}</script><script>${runtime}</script>`;
}

export function selfOrigin(): string {
  return `http://127.0.0.1:${process.env.PORT || "3000"}`;
}

/** Tek sayfa çizimi. Kaynak alınamazsa FIRLATIR (önbellekte eski sürüm varsa o sunulmaya devam eder). */
export async function renderStaticRoute(route: StaticRouteDef, origin = selfOrigin()): Promise<RenderOutcome> {
  // Merkezi fetch sınırı: yönlendirme reddedilir (bakım modu vb. → normal HTML yedeğine düşülmez, hata), 15 sn üst sınır.
  const res = await fetchExternal(
    `${origin}${route.path}`,
    { headers: { [STATIC_HOME_SOURCE_HEADER]: "1", accept: "text/html" }, cache: "no-store" },
    { timeoutMs: 15_000 },
  );
  if (!res.ok) throw new Error(`kaynak ${res.status}`);
  const source = await res.text();
  try {
    const { manifest: m, runtime } = loadAssets();
    const html = buildStaticHome({
      html: source,
      readStylesheet: (href) => readBuiltStylesheet(href),
      purge: { keepPrefixes: route.keepPrefixes, extraClasses: m.classTokens },
      bodyEnd: await bodyEndFor(route, m, runtime),
    });
    if (html) return { html, isStatic: true };
    console.error(`[statik:${route.id}] dönüşüm beklenmeyen biçim; normal HTML sunuluyor`);
    return { html: source, isStatic: false, reason: "Beklenmeyen HTML biçimi (akış sınırı, stil dosyası ya da </head>/</body> bulunamadı)" };
  } catch (e) {
    console.error(`[statik:${route.id}] dönüşüm hatası; normal HTML sunuluyor`, e);
    return { html: source, isStatic: false, reason: `Dönüşüm hatası: ${e instanceof Error ? e.message.slice(0, 160) : "bilinmiyor"}` };
  }
}

const GLOBAL_KEY = Symbol.for("emlaksoft.static-pages.cache");
type GlobalWithCache = typeof globalThis & { [GLOBAL_KEY]?: StaticCache };

/** Süreç başına tek önbellek. */
export function staticCache(): StaticCache {
  const g = globalThis as GlobalWithCache;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = createStaticCache({
      render: (id) => {
        const route = staticRouteById(id);
        if (!route) return Promise.reject(new Error(`bilinmeyen statik kimlik: ${id}`));
        return renderStaticRoute(route);
      },
      nowMs: now,
      readRev: readStaticRev,
    });
  }
  return g[GLOBAL_KEY]!;
}

/** `statik.rev` artırımı: diğer süreçler ≤5 sn içinde kendi önbelleklerini düşürür (başarısızsa null). */
export async function bumpStaticRev(staffId?: string): Promise<number | null> {
  const next = await incrementStaticRev(staffId);
  if (next !== null) staticCache().noteRev(next);
  return next;
}

/** Tek kimliği (ya da hepsini) düşürür ve rev'i artırır. */
export async function invalidateStatic(id: string | "all", staffId?: string): Promise<number | null> {
  staticCache().invalidate(id);
  return bumpStaticRev(staffId);
}

export type WarmResult = { id: string; ok: boolean; isStatic: boolean | null; ms: number; gzipBytes: number | null; error?: string };

/** Isıtma: kimliği yeniden çizer (hata fırlatmaz; sonuç satırı döner). */
export async function warmStatic(id: string): Promise<WarmResult> {
  const t0 = now();
  try {
    const page = await staticCache().warm(id);
    return { id, ok: true, isStatic: page.isStatic, ms: now() - t0, gzipBytes: page.gzipBytes };
  } catch (e) {
    return { id, ok: false, isStatic: null, ms: now() - t0, gzipBytes: null, error: e instanceof Error ? e.message : "bilinmeyen hata" };
  }
}

/** Etkin (açık) kimlikler: DB anahtarı + env üstünlüğü (okuma hatası FIRLATIR). */
export async function enabledIdsNow(): Promise<StaticRouteId[]> {
  const toggles = await readStaticToggles();
  return STATIC_ROUTES.filter((r) => staticRouteMode(r, toggles) === "on").map((r) => r.id);
}

const LOCK_KEY = Symbol.for("emlaksoft.static-pages.warm-lock");
type GlobalWithLock = typeof globalThis & { [LOCK_KEY]?: ReturnType<typeof createWarmLock> };

/** Süreç başına tek "temizle ve ısıt" kilidi (dakikada 1). */
export function staticWarmLock() {
  const g = globalThis as GlobalWithLock;
  if (!g[LOCK_KEY]) g[LOCK_KEY] = createWarmLock({ nowMs: now });
  return g[LOCK_KEY]!;
}

/** Verilen kimlikleri düşürür, rev'i bir kez artırır ve paralellik 2 ile yeniden çizer (kilit çağıranda). */
export async function purgeAndWarm(ids: readonly string[], staffId?: string): Promise<{ rev: number | null; rows: WarmResult[] }> {
  for (const id of ids) staticCache().invalidate(id);
  const rev = await bumpStaticRev(staffId);
  const rows = await mapWithConcurrency(ids, 2, warmStatic);
  return { rev, rows };
}

const NOT_FOUND_HEADERS ={ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } as const;

export function staticNotFound(): Response {
  return new Response("Bulunamadı", { status: 404, headers: NOT_FOUND_HEADERS });
}

/** Önbellekli yanıt (ETag/304). Yanıt başlıkları burada verilir (next.config.ts'e dokunulmaz). */
export async function respondStatic(route: StaticRouteDef, request: Request): Promise<Response> {
  let c: CachedPage;
  try {
    c = await staticCache().get(route.id);
  } catch (e) {
    console.error(`[statik:${route.id}] kaynak alınamadı`, e);
    return new Response("Sayfa şu an hazırlanıyor, lütfen birkaç saniye sonra yenileyin.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "5", "Cache-Control": "no-store" },
    });
  }
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=0, must-revalidate",
    ETag: c.etag,
  });
  // Tanı başlığı yalnız iç jetonlu öz test isteğine (herkese açık yanıtta x-static / x-static-home yok).
  // Probe yanıtı paylaşımlı önbelleğe girmesin (X-Static herkese sızmasın): private + no-store; Vary her yanıtta.
  headers.set("Vary", STATIC_PROBE_HEADER);
  if (await hasValidStaticProbe(request.headers)) {
    headers.set("X-Static", c.isStatic ? "1" : "fallback");
    headers.set("Cache-Control", "private, no-store");
  }
  if (request.headers.get("if-none-match") === c.etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : c.html, { status: 200, headers });
}

/** Yönetim ekranı için tüm rotaların bellek durumu (bu süreç). */
export function staticSnapshots() {
  const cache = staticCache();
  return STATIC_ROUTES.map((r) => ({ id: r.id, ...cache.snapshot(r.id) }));
}
