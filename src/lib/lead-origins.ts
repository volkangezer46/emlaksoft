/**
 * Talep formu uç noktası (`/api/leads/[token]`) için tarayıcı kaynak (CORS origin) izin listesi (SAF; sunucu, istemci ve
 * test ortak).
 *
 * Kaynaklar birleşir: ortam (`LEAD_CORS_ORIGINS`, operatör) + platformun kendi adresi + ofisin kendi ayarı
 * `lead.allowed_origins` (Ayarlar > Aday yakalama; en çok 5 https kaynak). Ofis listesi YALNIZ o ofisin token'ı için
 * geçerlidir: bir ofisin sitesi başka ofisin formuna tarayıcıdan gönderim yapamaz.
 *
 * Ayrıştırma SIKI: yalnız `https://alan.adı[:port]` biçimi (yol, sorgu, kimlik bilgisi, joker, IP/localhost yok).
 * Yazmada geçersiz öğe hata verir; okumada depodaki bozuk değer boş liste sayılır (güvenli taraf: ek izin yok).
 */

export const LEAD_ALLOWED_ORIGINS_KEY = "lead.allowed_origins";
export const LEAD_ALLOWED_ORIGINS_MAX = 5;
/** Depoda saklanan metnin üst sınırı (5 kaynak × makul alan adı). */
export const LEAD_ALLOWED_ORIGINS_MAX_LENGTH = 1200;

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Tek bir öğeyi kesin biçimde https origin'e çevirir; uymazsa null. */
export function normalizeLeadOrigin(entry: string): string | null {
  const v = entry.trim();
  if (!v || v.length > 260) return null;
  // Yalnız şema + ana bilgisayar (+ isteğe bağlı port) ve en çok tek sondaki eğik çizgi.
  const m = /^https:\/\/([^/?#@\s]+?)\/?$/i.exec(v);
  if (!m) return null;
  let url: URL;
  try {
    url = new URL(`https://${m[1]}`);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (!HOST_RE.test(host)) return null; // IP, localhost, joker, tek etiketli adlar reddedilir
  return url.origin.toLowerCase();
}

const splitEntries = (raw: string) =>
  raw
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);

/** Yazma doğrulaması: her öğe geçerli olmalı, en çok 5 (tekrarlar birleşir). Sonuç virgüllü saklama metnidir. */
export function parseLeadOriginsStrict(raw: string): { ok: true; origins: string[]; formatted: string } | { ok: false; error: string } {
  const out: string[] = [];
  for (const p of splitEntries(raw)) {
    const o = normalizeLeadOrigin(p);
    if (!o) return { ok: false, error: `Geçersiz site adresi: “${p.slice(0, 80)}”. Yalnız https://ornek.com biçiminde, yol içermeyen adresler kabul edilir.` };
    if (!out.includes(o)) out.push(o);
  }
  if (out.length > LEAD_ALLOWED_ORIGINS_MAX) return { ok: false, error: `En çok ${LEAD_ALLOWED_ORIGINS_MAX} site adresi eklenebilir.` };
  return { ok: true, origins: out, formatted: out.join(",") };
}

/** Okuma: depodaki değer; bozuksa boş liste (ek izin verilmez). */
export function parseLeadOriginsStored(raw: string | null | undefined): string[] {
  if (raw == null) return [];
  const r = parseLeadOriginsStrict(String(raw));
  return r.ok ? r.origins : [];
}

/** Ortam + platform + ofis kaynaklarını tekrarsız birleştirir (sıra korunur). */
export function mergeLeadOrigins(...lists: readonly (readonly string[])[]): string[] {
  const out: string[] = [];
  for (const list of lists) for (const o of list) if (o && !out.includes(o)) out.push(o);
  return out;
}
