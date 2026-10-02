/**
 * Kullanıcı/tenant tarafından girilmiş dış bağlantıları render öncesi güvenli
 * bir HTTP(S) href'e indirger. Boş, göreli, script şemalı veya kullanıcı adı /
 * parola gömülü URL'ler tıklanabilir kontrol olarak gösterilmez.
 */
export function normalizeExternalHref(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
