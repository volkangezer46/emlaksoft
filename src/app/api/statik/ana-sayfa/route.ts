import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getPublicPricing } from "@/lib/billing/public-pricing";
import { extraSeatTexts } from "@/lib/billing/seat-calculator-model";
import { STATIC_HOME_SOURCE_HEADER } from "@/lib/static-home/request";
import { buildStaticHome } from "@/lib/static-home/transform";
import { fetchExternal } from "@/lib/external-fetch";

/**
 * STATİK ANA SAYFA: "/" belge istekleri proxy'de buraya yeniden yazılır (src/lib/static-home/request.ts).
 * Kaynak, normal Next ana sayfasının kendisidir (ISR önbellekli, yönetimden düzenlenen içerik aynen) — buradan
 * çekilir, Next/React çalışma zamanı ayıklanır, kullanılan CSS gömülür, düz JS + adacık verisi eklenir.
 * Sonuç bellekte tutulur (60 sn taze, sonra arka planda yenilenir). Herhangi bir sorunda normal Next HTML'i sunulur.
 * Kapatma: STATIC_HOME=off (yeniden başlatma gerekir).
 */
export const dynamic = "force-dynamic";

const FRESH_MS = 60_000;
const KEEP_PREFIXES = ["mk-sheet", "mk-pause", "mk-feat-sw", "js-"] as const;

type Cached = { html: string; etag: string; at: number; static: boolean };
let cache: Cached | null = null;
let inflight: Promise<Cached> | null = null;

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

function readStylesheet(href: string): string | null {
  const path = href.split("?")[0];
  if (!path.startsWith("/_next/static/") || path.includes("..")) return null;
  try {
    return readFileSync(join(process.cwd(), ".next", "static", path.slice("/_next/static/".length)), "utf8");
  } catch {
    return null;
  }
}

/** JSON'u <script> içine güvenle gömer. */
function jsonForScript(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

async function render(origin: string): Promise<Cached> {
  // Merkezi fetch sınırı: yönlendirme reddedilir (bakım modu vb. → normal HTML yedeğine düşülmez, hata), 15 sn üst sınır.
  const res = await fetchExternal(
    `${origin}/`,
    { headers: { [STATIC_HOME_SOURCE_HEADER]: "1", accept: "text/html" }, cache: "no-store" },
    { timeoutMs: 15_000 },
  );
  if (!res.ok) throw new Error(`kaynak ${res.status}`);
  const source = await res.text();
  const done = (html: string, isStatic: boolean): Cached => ({
    html,
    etag: `"${createHash("sha1").update(html).digest("base64url").slice(0, 20)}"`,
    at: Date.now(),
    static: isStatic,
  });
  try {
    const { manifest: m, runtime } = loadAssets();
    const pricing = await getPublicPricing();
    const { plans, trialDays, offers, founders, efValuationCost, efLive } = pricing;
    const data = {
      islands: m.islands,
      pricing: { plans, trialDays, offers, founders, extraSeats: extraSeatTexts(plans), efValuationCost, efLive },
      seat: { plans, offers, trialDays },
    };
    const html = buildStaticHome({
      html: source,
      readStylesheet,
      purge: { keepPrefixes: KEEP_PREFIXES, extraClasses: m.classTokens },
      bodyEnd: `<script type="application/json" id="mk-static">${jsonForScript(data)}</script><script>${runtime}</script>`,
    });
    if (html) return done(html, true);
    console.error("[statik-ana-sayfa] dönüşüm beklenmeyen biçim; normal HTML sunuluyor");
  } catch (e) {
    console.error("[statik-ana-sayfa] dönüşüm hatası; normal HTML sunuluyor", e);
  }
  return done(source, false);
}

function refresh(origin: string): Promise<Cached> {
  if (!inflight) {
    inflight = render(origin)
      .then((c) => (cache = c))
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function GET(request: Request) {
  const port = process.env.PORT || "3000";
  const origin = `http://127.0.0.1:${port}`;
  let c = cache;
  if (!c) {
    try {
      c = await refresh(origin);
    } catch (e) {
      console.error("[statik-ana-sayfa] kaynak alınamadı", e);
      return new Response("Sayfa şu an hazırlanıyor, lütfen birkaç saniye sonra yenileyin.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "5", "Cache-Control": "no-store" },
      });
    }
  } else if (Date.now() - c.at > FRESH_MS) void refresh(origin).catch(() => {});

  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=0, must-revalidate",
    ETag: c.etag,
    "X-Static-Home": c.static ? "1" : "fallback",
  });
  if (request.headers.get("if-none-match") === c.etag) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : c.html, { status: 200, headers });
}

export const HEAD = GET;
