/**
 * Sunucu süre ölçümü SAF tarafı (vitest kapsamında). Biçim W3C `Server-Timing` girdisiyle aynı: `ad;dur=12.3`.
 * Ad yalnız [a-z0-9-] (kullanıcı/kayıt kimliği, yol parametresi vb. GİREMEZ → PII yok).
 */
export function sanitizeTimingName(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return s.slice(0, 40) || "olcum";
}

export function formatServerTiming(name: string, ms: number): string {
  const dur = Number.isFinite(ms) && ms >= 0 ? ms : 0;
  return `${sanitizeTimingName(name)};dur=${dur.toFixed(1)}`;
}

/** Ortam bayrağı: `EMLAKSOFT_SERVER_TIMING=1` iken ölçüm satırı yazılır; kapalıyken ölçüm sıfır maliyet. */
export function serverTimingEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.EMLAKSOFT_SERVER_TIMING === "1";
}
