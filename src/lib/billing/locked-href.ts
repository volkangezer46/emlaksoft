/**
 * Menü / şerit / palet kilit denetimi (bağımlılıksız; istemci paketine plan tanımları girmez). `locked` listesi
 * `lockedHrefs()` çıktısıdır: kilitli yol önekleri + kilidin İSTİSNA alt yolları `!` önekiyle (ör. `/app/finans` kilitli,
 * `!/app/finans/komisyon` açık). Önek eşleşmesi tam bölüm sınırındadır.
 */
function under(href: string, prefix: string): boolean {
  const path = (href.split(/[?#]/)[0] ?? href).replace(/(.)\/+$/, "$1");
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function isHrefLocked(href: string, locked: readonly string[]): boolean {
  if (locked.length === 0) return false;
  if (locked.some((l) => l.startsWith("!") && under(href, l.slice(1)))) return false;
  return locked.some((l) => !l.startsWith("!") && under(href, l));
}
