import type { Finding } from "./audit-rules";

/**
 * İÇ BAĞLANTI YÖNLENDİRMESİ ve KIRIK GÖRSEL kuralları (SAF). Robot yalnız kendi kökenini çeker; burası adres
 * ayrıştırma ve bulgu üretimidir.
 */

/** Yönlendirme zinciri en çok kaç atlama izlenir. */
export const MAX_REDIRECT_HOPS = 5;

/**
 * İç bağlantının hedefi yönlendiriyorsa bulgu. `hops`: ilk hedef dahil sırayla ziyaret edilen adresler (son öğe nihai
 * adres ya da döngü/sınır). 1 atlama: "internal-link-redirect"; ≥2 atlama ya da döngü: "redirect-chain".
 */
export function redirectLinkFinding(pageUrl: string, hops: readonly string[], loop: boolean): Finding | null {
  if (hops.length < 2) return null;
  const path = (u: string) => {
    try {
      return new URL(u).pathname;
    } catch {
      return u;
    }
  };
  const chain = hops.map(path).join(" → ");
  if (loop) {
    return { code: "redirect-chain", severity: "critical", url: pageUrl, message: `İç bağlantı yönlendirme döngüsüne giriyor: ${chain}.`, fix: "Döngüdeki yönlendirme kuralını kaldırın ve bağlantıyı çalışan adrese verin." };
  }
  if (hops.length > 2) {
    return { code: "redirect-chain", severity: "warning", url: pageUrl, message: `İç bağlantı ${hops.length - 1} kez yönleniyor: ${chain}.`, fix: "Bağlantıyı doğrudan son adrese verin; ara yönlendirmeleri tek adıma indirin." };
  }
  return { code: "internal-link-redirect", severity: "info", url: pageUrl, message: `İç bağlantı yönlendiriyor: ${chain}.`, fix: "Bağlantıyı doğrudan son adrese verin (gereksiz yönlendirme tarama bütçesini harcar)." };
}

/** Location başlığını mutlak adrese çevirir; başka kökene giderse null (izlenmez). */
export function resolveLocation(location: string | null, from: string, origin: string): string | null {
  if (!location) return null;
  try {
    const u = new URL(location, from);
    if (u.origin !== new URL(origin).origin) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Sayfadaki kendi kökenimize ait görsel adresleri (en çok `max`, tekil). `/_next/image?url=/x` sarmalayıcısı açılır
 * (iyileştirici ucunu yormamak için asıl kaynak denetlenir); data:, dış köken ve dosya olmayan adresler atlanır.
 */
export function ownImageSources(html: string, pageUrl: string, origin: string, max = 4): string[] {
  const out = new Set<string>();
  const clean = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ");
  for (const m of clean.matchAll(/<img\b[^>]*>/gi)) {
    if (out.size >= max) break;
    const src = /\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[0]);
    const raw = (src?.[2] ?? src?.[3] ?? "").replace(/&amp;/g, "&").trim();
    if (!raw || /^data:/i.test(raw)) continue;
    let u: URL;
    try {
      u = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (u.origin !== new URL(origin).origin) continue;
    if (u.pathname === "/_next/image") {
      const inner = u.searchParams.get("url");
      if (!inner || !inner.startsWith("/") || inner.startsWith("//")) continue;
      try {
        u = new URL(inner, origin);
      } catch {
        continue;
      }
    }
    u.hash = "";
    out.add(u.toString());
  }
  return [...out];
}

export function brokenImageFinding(pageUrl: string, imageUrl: string, status: number): Finding | null {
  if (status >= 200 && status < 400) return null;
  let path = imageUrl;
  try {
    path = new URL(imageUrl).pathname;
  } catch {
    /* ham */
  }
  return {
    code: "broken-image",
    severity: "warning",
    url: pageUrl,
    message: `Görsel açılmıyor: ${path} (${status === 0 ? "yanıt yok" : `HTTP ${status}`}).`,
    fix: "Görseli yeniden yükleyin ya da sayfadan kaldırın.",
  };
}
