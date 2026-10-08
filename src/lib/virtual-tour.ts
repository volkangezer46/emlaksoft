/**
 * 360° tur / video bağlantısı — TEK KAYNAK (SAF; sunucu/istemci güvenli).
 *
 * Depo: `properties.features.virtual_tour_url` (jsonb; yeni sütun yok). Yalnız https ve İZİNLİ alan adları kabul edilir
 * (Matterport, YouTube, Vimeo, Kuula). Kullanıcı bilgisi (user:pass@) ve özel port reddedilir.
 * Vitrinde `embedUrl` sandbox'lı iframe'de gösterilir; CSP `frame-src` listesi `VIRTUAL_TOUR_FRAME_HOSTS`ten türer
 * (next.config.ts) — iki liste ayrışırsa sözleşme testi kırılır.
 */

export const VIRTUAL_TOUR_FEATURE_KEY = "virtual_tour_url";
export const VIRTUAL_TOUR_MAX_LENGTH = 500;

export type VirtualTourProvider = "matterport" | "youtube" | "vimeo" | "kuula";
export type VirtualTour = { url: string; embedUrl: string; provider: VirtualTourProvider };

/** iframe'in yükleneceği alan adları (CSP frame-src). */
export const VIRTUAL_TOUR_FRAME_HOSTS = [
  "my.matterport.com",
  "www.youtube-nocookie.com",
  "player.vimeo.com",
  "kuula.co",
] as const;

export const VIRTUAL_TOUR_PROVIDER_LABEL: Record<VirtualTourProvider, string> = {
  matterport: "Matterport 360° tur",
  youtube: "YouTube video",
  vimeo: "Vimeo video",
  kuula: "Kuula 360° tur",
};

export type VirtualTourParse = { ok: true; value: VirtualTour | null } | { ok: false; error: string };

const BAD: VirtualTourParse = { ok: false, error: "Geçerli bir https bağlantısı girin (Matterport, YouTube, Vimeo veya Kuula)." };
const ID = /^[A-Za-z0-9_-]{6,20}$/;
const MATTERPORT_ID = /^[A-Za-z0-9]{6,20}$/;

function youtubeId(u: URL): string | null {
  const host = u.hostname.toLowerCase();
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com" || host === "www.youtube-nocookie.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else {
      const m = /^\/(?:embed|shorts|live)\/([^/]+)/.exec(u.pathname);
      id = m ? m[1] : null;
    }
  }
  return id && ID.test(id) ? id : null;
}

/** Ham girdiyi doğrular; boş = bağlantıyı sil (value: null). */
export function parseVirtualTourUrl(raw: unknown): VirtualTourParse {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: true, value: null };
  if (text.length > VIRTUAL_TOUR_MAX_LENGTH) return BAD;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return BAD;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return BAD;
  const host = u.hostname.toLowerCase();

  const yt = youtubeId(u);
  if (yt) {
    return { ok: true, value: { url: `https://www.youtube.com/watch?v=${yt}`, embedUrl: `https://www.youtube-nocookie.com/embed/${yt}`, provider: "youtube" } };
  }
  if (host === "my.matterport.com" || host === "matterport.com" || host === "www.matterport.com") {
    const m = u.pathname.startsWith("/show") ? u.searchParams.get("m") : null;
    if (!m || !MATTERPORT_ID.test(m)) return BAD;
    const link = `https://my.matterport.com/show/?m=${m}`;
    return { ok: true, value: { url: link, embedUrl: link, provider: "matterport" } };
  }
  if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
    const m = /^\/(?:video\/)?(\d{5,12})\/?$/.exec(u.pathname);
    if (!m) return BAD;
    return { ok: true, value: { url: `https://vimeo.com/${m[1]}`, embedUrl: `https://player.vimeo.com/video/${m[1]}`, provider: "vimeo" } };
  }
  if (host === "kuula.co" || host === "www.kuula.co") {
    const m = /^\/(?:share|post)\/(?:collection\/)?([A-Za-z0-9_-]{4,40})\/?$/.exec(u.pathname);
    if (!m) return BAD;
    const link = `https://kuula.co/share/${m[1]}`;
    return { ok: true, value: { url: link, embedUrl: link, provider: "kuula" } };
  }
  return BAD;
}

/** Kayıtlı features'tan okurken tekrar doğrular (elle yazılmış/eski değerler iframe'e GİRMEZ). */
export function readVirtualTour(features: unknown): VirtualTour | null {
  if (!features || typeof features !== "object" || Array.isArray(features)) return null;
  const p = parseVirtualTourUrl((features as Record<string, unknown>)[VIRTUAL_TOUR_FEATURE_KEY]);
  return p.ok && p.value ? p.value : null;
}

/** Mevcut features'a bağlantıyı birleştirir (diğer anahtarlar korunur; null = anahtar silinir). */
export function withVirtualTour(features: Record<string, unknown> | null | undefined, url: string | null): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(features ?? {}) };
  if (url === null) delete next[VIRTUAL_TOUR_FEATURE_KEY];
  else next[VIRTUAL_TOUR_FEATURE_KEY] = url;
  return next;
}
