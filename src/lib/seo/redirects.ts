import { NEVER_INDEX_PREFIXES, seoPages } from "./registry";
import type { SeoRedirectRule } from "./schema";

/**
 * Yönlendirme kuralları (SAF): normalizasyon, çözümleme, döngü/zincir tespiti.
 * Çözücü yalnız hiçbir sayfayla eşleşmeyen (404'e düşecek) yollarda çalışır
 * (src/app/[...slug]/page.tsx); mevcut sayfaların performansına dokunmaz.
 * Durumlar: 308 (kalıcı) ve 307 (geçici) — Next sayfa API'si bunları verir; Google 308'i 301 gibi işler.
 */

const PROTECTED_FROM = [...NEVER_INDEX_PREFIXES, "/vitrin", "/danisman", "/araclar", "/brand-asset", "/site-menu-asset", "/_next"];

/** Karşılaştırma anahtarı: sorgu/parça atılır, küçük harf, sondaki '/' atılır. */
export function normalizeRedirectPath(p: string): string {
  const noQuery = p.replace(/[?#].*$/, "");
  let s = noQuery.trim();
  try {
    s = decodeURI(s);
  } catch {
    // kötü kodlanmış yol: ham haliyle devam
  }
  s = s.toLowerCase();
  if (s.length > 1) s = s.replace(/\/+$/, "");
  return s || "/";
}

export function isProtectedFrom(from: string): boolean {
  const n = normalizeRedirectPath(from);
  return PROTECTED_FROM.some((p) => n === p || n.startsWith(`${p}/`));
}

export type RedirectMap = Map<string, SeoRedirectRule>;

/**
 * Yerleşik (kodla gelen) kalıcı yönlendirmeler — kaldırılan public sayfaların eski adresleri. Admin kuralları
 * (/admin/seo) bunların ÖNÜNE geçer (aynı kaynak için admin kuralı varsa o kazanır). `next.config.ts` aynı listeyi
 * ayrıca kenarda uygular (sayfa akışına hiç girmeden 308); burası sayfa dosyası silinince çalışan güvenlik ağıdır.
 * Sözleşme testi iki yerin tutarlılığını doğrular (src/lib/seo/seo-legacy-redirects.test.ts).
 */
export const LEGACY_REDIRECTS: readonly SeoRedirectRule[] = [
  // Satış demosu talebi akışı kaldırıldı (2026-10-06): tek yol self-servis kurulum sihirbazı.
  { id: "legacydemo", from: "/demo", to: "/kayit", status: 308, enabled: true, note: "Demo talebi sayfası kaldırıldı; kurulum sihirbazı" },
];

/** Admin kuralları + yerleşikler (admin önce; aynı kaynakta ilk kazanır). */
export function withLegacyRedirects(rules: readonly SeoRedirectRule[]): SeoRedirectRule[] {
  return [...rules, ...LEGACY_REDIRECTS];
}

export function buildRedirectMap(rules: readonly SeoRedirectRule[]): RedirectMap {
  const map: RedirectMap = new Map();
  for (const r of rules) {
    if (!r.enabled) continue;
    const key = normalizeRedirectPath(r.from);
    if (!map.has(key)) map.set(key, r);
  }
  return map;
}

export const MAX_REDIRECT_HOPS = 5;

/** Zinciri sona kadar izler (en çok 5 adım). Döngü ya da eşleşme yoksa null. */
export function resolveRedirect(map: RedirectMap, path: string): { to: string; status: 307 | 308 } | null {
  let current = normalizeRedirectPath(path);
  const first = map.get(current);
  if (!first) return null;
  const seen = new Set<string>([current]);
  let rule: SeoRedirectRule = first;
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
    const to = rule.to;
    if (!to.startsWith("/")) return { to, status: first.status }; // dış hedef: zincir biter
    const key = normalizeRedirectPath(to);
    if (seen.has(key)) return null; // döngü
    const next = map.get(key);
    if (!next) return { to, status: first.status };
    seen.add(key);
    current = key;
    rule = next;
  }
  return null; // çok uzun zincir
}

export type RedirectIssue = { ruleId: string; kind: "loop" | "chain" | "duplicate" | "self" | "protected" | "shadowed"; message: string };

/** Kural listesinde döngü, zincir, yinelenen kaynak ve gölgelenen (zaten var olan sayfa) kuralları bulur. */
export function analyzeRedirects(rules: readonly SeoRedirectRule[]): RedirectIssue[] {
  const issues: RedirectIssue[] = [];
  const enabled = rules.filter((r) => r.enabled);
  const map = buildRedirectMap(rules);
  const existing = new Set(seoPages().map((p) => normalizeRedirectPath(p.path)));
  const seenFrom = new Map<string, string>();

  for (const r of enabled) {
    const from = normalizeRedirectPath(r.from);
    const toKey = r.to.startsWith("/") ? normalizeRedirectPath(r.to) : null;
    if (seenFrom.has(from)) issues.push({ ruleId: r.id, kind: "duplicate", message: `'${r.from}' için birden fazla kural var; yalnız ilki çalışır.` });
    else seenFrom.set(from, r.id);

    if (toKey === from) {
      issues.push({ ruleId: r.id, kind: "self", message: "Kaynak ve hedef aynı." });
      continue;
    }
    if (isProtectedFrom(r.from)) issues.push({ ruleId: r.id, kind: "protected", message: "Bu yol korumalı alandadır; yönlendirme çalışmaz." });
    if (existing.has(from)) issues.push({ ruleId: r.id, kind: "shadowed", message: "Bu yolda zaten bir sayfa var; yönlendirme hiç çalışmaz." });

    if (toKey) {
      const next = map.get(toKey);
      if (next) {
        // döngü mü, zincir mi?
        if (resolveRedirect(map, r.from) === null) {
          issues.push({ ruleId: r.id, kind: "loop", message: `'${r.from}' → '${r.to}' yönlendirme döngüsüne giriyor.` });
        } else {
          issues.push({ ruleId: r.id, kind: "chain", message: `'${r.to}' de başka bir yere yönleniyor (zincir); doğrudan son hedefi yazın.` });
        }
      }
    }
  }
  return issues;
}

/** Yeni kural eklenmeden önce hızlı denetim; hata varsa Türkçe mesaj döner. */
export function validateNewRule(existing: readonly SeoRedirectRule[], rule: SeoRedirectRule): string | null {
  const from = normalizeRedirectPath(rule.from);
  if (isProtectedFrom(rule.from)) return "Korumalı bir yol (uygulama, yönetim, portal, vitrin, araçlar) yönlendirilemez.";
  if (seoPages().some((p) => normalizeRedirectPath(p.path) === from)) return "Bu yolda zaten bir sayfa var; yönlendirme çalışmazdı.";
  if (rule.to.startsWith("/") && normalizeRedirectPath(rule.to) === from) return "Kaynak ve hedef aynı olamaz.";
  if (existing.some((r) => r.id !== rule.id && normalizeRedirectPath(r.from) === from)) return "Bu kaynak yol için zaten bir kural var.";
  const next = [...existing.filter((r) => r.id !== rule.id), rule];
  const issues = analyzeRedirects(next).filter((i) => i.ruleId === rule.id || i.kind === "loop");
  const loop = issues.find((i) => i.kind === "loop");
  if (loop) return loop.message;
  return null;
}
