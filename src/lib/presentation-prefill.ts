/**
 * Sunum ön dolgusu (SAF): `/app/portfoyler/sunumlar/yeni?portfoy=a,b,c` — virgüllü (ve/veya tekrarlı) portföy kimlikleri.
 * Yalnız biçimi geçerli UUID'ler, sırası korunarak tekillenir; en fazla `PRESENTATION_PREFILL_CAP` kimlik okunur.
 * Sunum en fazla `PRESENTATION_MAX_PROPERTIES` portföy taşır (createPresentation ile aynı sınır); fazlası ön seçime girmez.
 */
export const PRESENTATION_PREFILL_CAP = 20;
/** createPresentation (MAX_PRESENTATION_PROPERTIES) ve presentation-form (MAX_SELECT) ile aynı. */
export const PRESENTATION_MAX_PROPERTIES = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePortfoyParam(raw: string | string[] | null | undefined, cap: number = PRESENTATION_PREFILL_CAP): string[] {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: string[] = [];
  for (const v of values) {
    for (const part of String(v).split(",")) {
      const id = part.trim().toLowerCase();
      if (!UUID_RE.test(id) || out.includes(id)) continue;
      out.push(id);
      if (out.length >= cap) return out;
    }
  }
  return out;
}

/** Çoklu sunum bağlantısı: `?portfoy=a,b,c[&musteri=x]` (kimlikler tekillenir, en fazla sunum sınırı kadar). */
export function presentationHref(propertyIds: readonly string[], customerId?: string | null): string {
  const ids = parsePortfoyParam(propertyIds.join(","), PRESENTATION_MAX_PROPERTIES);
  const q = new URLSearchParams();
  if (ids.length) q.set("portfoy", ids.join(","));
  if (customerId && UUID_RE.test(customerId)) q.set("musteri", customerId);
  const s = q.toString().replace(/%2C/g, ",");
  return s ? `/app/portfoyler/sunumlar/yeni?${s}` : "/app/portfoyler/sunumlar/yeni";
}

/** Sunuma girebilen (yayındaki) portföy durumları — createPresentation ve sunum ön dolgusuyla aynı çizgi. */
const PRESENTABLE_STATUSES = new Set(["live", "Yayında"]);

/** En iyi eşleşmelerden sunuma girebilecek (yayındaki, tekil) portföy kimlikleri; skor sırası korunur. */
export function topPresentableIds(
  pairs: readonly { property: { id: string; status?: string | null } }[],
  max: number = PRESENTATION_MAX_PROPERTIES,
): string[] {
  const out: string[] = [];
  for (const p of pairs) {
    if (out.length >= max) break;
    if (!PRESENTABLE_STATUSES.has(String(p.property.status ?? "")) || out.includes(p.property.id)) continue;
    out.push(p.property.id);
  }
  return out;
}
