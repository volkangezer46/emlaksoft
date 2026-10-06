import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Sunucu önbelleği TENANT İZOLASYONU sözleşmesi (HIZ_OLCUM_RAPORU_5, HAFIZA §27).
 *
 * Kural: istekler arası paylaşılan bir önbelleğe (unstable_cache, "use cache", "use cache: remote") kişisel/ofis verisi
 * ancak önbellek anahtarı o ofisi (tenantId) içeriyorsa girer. Oturum çerezine bağlı istemci (`createClient` →
 * RLS'li kullanıcı JWT'si), `cookies()`/`headers()` ve oturum yardımcıları paylaşılan önbelleğin İÇİNDE kullanılmaz;
 * anahtarı tenant içermeyen bir girdiye kullanıcı verisi yazılırsa başka ofise sızar.
 *
 * - `"use cache"` / `"use cache: remote"` direktifli dosyalar oturum/istek modülü içe aktaramaz (direktif dosyada
 *   yalnız `"use cache: private"` ise serbest: o sunucuda saklanmaz).
 * - Her `unstable_cache(` çağrısı aşağıdaki kayıtta sınıflandırılır: `platform` (ofisten bağımsız; çağrı metninde
 *   oturum istemcisi/çerez/başlık/tenant okuması yok) ya da `tenant` (çağrı metni anahtarda ya da argümanda
 *   `tenantId`/`tenant.id` taşır). Yeni kullanım kayda girmeden test kırılır: önce sınıflandır, gerekçe yaz.
 */
const SRC = join(process.cwd(), "src");

type Scope = "platform" | "tenant";
/** Dosya -> beklenen `unstable_cache(` çağrı sayısı + kapsam. Anahtarlar mevcut önbellek anahtarlarıdır (değiştirilmez). */
const UNSTABLE_CACHE_REGISTRY: Record<string, { calls: number; scope: Scope; why: string }> = {
  "src/app/admin/page.tsx": { calls: 1, scope: "platform", why: "platform paneli toplamları (service_role, ofis filtresi yok)" },
  "src/app/vitrin/[slug]/page.tsx": { calls: 1, scope: "tenant", why: "vitrin ilan listesi; anahtar tenant.id + filtreler, is_sample=false" },
  "src/components/app/ef-credit-badge.tsx": { calls: 1, scope: "tenant", why: "EF bakiyesi; tenantId argümanı anahtara girer" },
  "src/lib/admin-badges.ts": { calls: 1, scope: "platform", why: "platform rozet sayıları" },
  "src/lib/billing/plan-definitions.ts": { calls: 3, scope: "platform", why: "plan kataloğu / koltuk / EF tarifesi" },
  "src/lib/billing/plan-support.ts": { calls: 1, scope: "platform", why: "şema yetenek yoklaması" },
  "src/lib/billing/seat-purchase.ts": { calls: 1, scope: "platform", why: "şema yetenek yoklaması" },
  "src/lib/brand/store.ts": { calls: 2, scope: "platform", why: "platform markası" },
  "src/lib/definitions.ts": { calls: 1, scope: "tenant", why: "tanımlar; anahtar scope = tenantId ?? global" },
  "src/lib/ef-credits/credit-reader.ts": { calls: 2, scope: "platform", why: "EF hazır bayrağı + katalog" },
  "src/lib/ef-credits/public-state.ts": { calls: 1, scope: "platform", why: "EF genel durum" },
  "src/lib/geo/reader.ts": { calls: 3, scope: "platform", why: "il/ilçe/mahalle sözlüğü" },
  "src/lib/geo/resolve.ts": { calls: 1, scope: "platform", why: "coğrafya takma adları" },
  "src/lib/integrations/emlakfiyati/client.ts": { calls: 1, scope: "platform", why: "dış endeks verisi (bölge + tip argümanı)" },
  "src/lib/office-score.ts": { calls: 1, scope: "tenant", why: "ofis skoru; anahtar tenantId" },
  "src/lib/reporting/cache.ts": { calls: 1, scope: "tenant", why: "rapor toplamları; anahtar tenantId, RPC sonucu ofis geneli (kullanıcıya göre değişmez)" },
  "src/lib/seo/sitemap-data.ts": { calls: 1, scope: "platform", why: "sitemap girdileri (yalnız public)" },
  "src/lib/seo/store.ts": { calls: 1, scope: "platform", why: "SEO ayarları" },
  "src/lib/settings/read.ts": { calls: 1, scope: "platform", why: "platform ayar anlık görüntüsü (ofis satırları önbellek DIŞINDA)" },
  "src/lib/site-content/ef-status.ts": { calls: 1, scope: "platform", why: "ana sayfa EF durumu" },
  "src/lib/site-content/store.ts": { calls: 1, scope: "platform", why: "site içeriği" },
  "src/lib/site-menu/store.ts": { calls: 1, scope: "platform", why: "site menüsü" },
  "src/lib/try-credits/settings.ts": { calls: 1, scope: "platform", why: "TL kredi tavanı" },
};

/** Paylaşılan önbellek içinde yasak: oturum/istek okuması. */
const SESSION_READ = /\bcreateClient\(|\bcookies\(|\bheaders\(|\bgetRequestUser\(|\bgetRequestIdentity\(|\brequireModulePage\(|\brequirePermission\(|\brequireActiveTenant\(|\bcurrent_tenant_id\b/;
/** Direktifli dosyada yasak içe aktarmalar (oturum/istek modülleri). */
const SESSION_IMPORT = /from\s+["'](next\/headers|@\/lib\/supabase\/server|@\/lib\/supabase\/auth-cache|@\/lib\/cache\/request|@\/lib\/require-module-page|@\/lib\/require-active-tenant)["']/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (full: string) => full.slice(process.cwd().length + 1).split("\\").join("/");

/** `unstable_cache(` çağrılarının tam metni (dengeli parantez). */
function unstableCacheCalls(text: string): string[] {
  const calls: string[] = [];
  const re = /\bunstable_cache\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    calls.push(text.slice(m.index, i + 1));
  }
  return calls;
}

const ALL = sourceFiles(SRC).map((f) => ({ rel: rel(f), text: readFileSync(f, "utf8") }));

describe("önbellek tenant izolasyonu", () => {
  it('"use cache" / "use cache: remote" direktifli dosyalar oturum/istek okumaz (yalnız "use cache: private" serbest)', () => {
    const offenders: string[] = [];
    for (const { rel: file, text } of ALL) {
      const directives = [...text.matchAll(/["']use cache(?::\s*(\w+))?["']/g)].map((d) => d[1] ?? "default");
      const shared = directives.filter((d) => d !== "private");
      if (shared.length === 0) continue;
      if (SESSION_IMPORT.test(text) || SESSION_READ.test(text)) offenders.push(`${file} (${shared.join(",")})`);
    }
    expect(offenders, `Paylaşılan "use cache" kapsamında oturum/istek okuması (anahtar tenant içermiyorsa ofisler arası sızar):\n${offenders.join("\n")}`).toEqual([]);
  });

  it("her unstable_cache kullanımı kayıtta ve sayısı tutuyor (yeni kullanım önce sınıflandırılır)", () => {
    const found: Record<string, number> = {};
    for (const { rel: file, text } of ALL) {
      const n = unstableCacheCalls(text).length;
      if (n > 0) found[file] = n;
    }
    const expected = Object.fromEntries(Object.entries(UNSTABLE_CACHE_REGISTRY).map(([f, v]) => [f, v.calls]));
    expect(found).toEqual(expected);
  });

  it("platform kapsamlı önbellek çağrıları oturum istemcisi/çerez/tenant okuması içermez", () => {
    const offenders: string[] = [];
    for (const { rel: file, text } of ALL) {
      const entry = UNSTABLE_CACHE_REGISTRY[file];
      if (!entry || entry.scope !== "platform") continue;
      for (const call of unstableCacheCalls(text)) {
        if (SESSION_READ.test(call) || /\btenantId\b|\btenant\.id\b/.test(call)) offenders.push(`${file}: ${call.slice(0, 80)}…`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("tenant kapsamlı önbellek çağrıları anahtarda/argümanda ofis kimliği taşır ve çerez/başlık okumaz", () => {
    const offenders: string[] = [];
    for (const { rel: file, text } of ALL) {
      const entry = UNSTABLE_CACHE_REGISTRY[file];
      if (!entry || entry.scope !== "tenant") continue;
      for (const call of unstableCacheCalls(text)) {
        const keyed = /\btenantId\b|\btenant\.id\b|\bscope\b/.test(call);
        if (!keyed || /\bcookies\(|\bheaders\(|\bcreateClient\(/.test(call)) offenders.push(`${file}: ${call.slice(0, 80)}…`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("unstable_cache içindeki istemci `createClient` ile kurulmuşsa (RLS kapanışı) kayıtta tenant kapsamlıdır", () => {
    // Kapanışla taşınan oturum istemcisi (`supabase`) yalnız tenant anahtarlı girdide kabul edilir (reporting/cache.ts).
    const offenders: string[] = [];
    for (const { rel: file, text } of ALL) {
      const entry = UNSTABLE_CACHE_REGISTRY[file];
      if (!entry) continue;
      for (const call of unstableCacheCalls(text)) {
        if (/\bsupabase\b/.test(call) && entry.scope !== "tenant") offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("sözleşme yardımcısı", () => {
  it("unstableCacheCalls iç içe parantezi doğru keser", () => {
    const calls = unstableCacheCalls('const a = unstable_cache(async (x) => f(g(x)), ["k", id], { tags: [t(1)] });\nunstable_cache(() => 1, ["b"])();');
    expect(calls).toEqual(['unstable_cache(async (x) => f(g(x)), ["k", id], { tags: [t(1)] })', 'unstable_cache(() => 1, ["b"])']);
  });
});
